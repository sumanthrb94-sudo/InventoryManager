import { TEXT_PATTERNS, COLOR_SYNONYMS, GRADE_MAPPING, STORAGE_OPTIONS, BRAND_KEYWORDS } from './textPatterns';

export interface ExtractedField {
  value: string;
  confidence: number;
}

export interface ExtractedDevice {
  imei: ExtractedField;
  brand: ExtractedField;
  model: ExtractedField;
  storage: ExtractedField;
  grade: ExtractedField;
  colour: ExtractedField;
}

function calculateLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function validateIMEI(imei: string): boolean {
  const digits = imei.replace(/\D/g, '');
  if (digits.length !== 14 && digits.length !== 15) return false;

  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    let digit = parseInt(digits[i], 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[digits.length - 1], 10);
}

export function extractIMEI(text: string): ExtractedField {
  const matches = text.match(TEXT_PATTERNS.imei);
  if (!matches || matches.length === 0) {
    return { value: '', confidence: 0 };
  }

  const validIMEIs = matches.filter(validateIMEI);
  if (validIMEIs.length === 0) {
    // Return first match with lower confidence if IMEI validation fails
    const firstMatch = matches[0];
    return {
      value: firstMatch,
      confidence: 0.75, // Flagged as unvalidated
    };
  }

  // Return the first valid IMEI found
  return {
    value: validIMEIs[0],
    confidence: 0.95, // Valid IMEI
  };
}

export function extractStorage(text: string): ExtractedField {
  const matches = text.match(TEXT_PATTERNS.storage);
  if (!matches || matches.length === 0) {
    return { value: '', confidence: 0 };
  }

  const matched = matches[0].toUpperCase();
  const found = STORAGE_OPTIONS.find(
    (opt) => opt.toUpperCase() === matched
  );

  if (found) {
    return { value: found, confidence: 0.92 };
  }

  return { value: matched, confidence: 0.70 };
}

export function extractGrade(text: string): ExtractedField {
  const matches = text.match(TEXT_PATTERNS.grade);
  if (!matches || matches.length === 0) {
    return { value: '', confidence: 0 };
  }

  const matched = matches[0].toLowerCase();
  const gradeKey = Object.keys(GRADE_MAPPING).find(
    (key) => matched.includes(key) || key.includes(matched)
  );

  if (gradeKey) {
    return {
      value: GRADE_MAPPING[gradeKey],
      confidence: 0.88,
    };
  }

  return { value: '', confidence: 0 };
}

export function extractBrand(text: string): ExtractedField {
  const lowerText = text.toLowerCase();

  for (const [keyword, brand] of Object.entries(BRAND_KEYWORDS)) {
    if (lowerText.includes(keyword)) {
      return { value: brand, confidence: 0.85 };
    }
  }

  return { value: '', confidence: 0 };
}

// Common OCR misreads on phone labels. We apply these to a duplicate of the
// text so the original is still searched first — we don't want "S 21" to
// turn into "521" before we look for "S21" itself.
function normaliseForModelMatch(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ');
}

function tidyModel(raw: string): string {
  let out = raw
    .replace(/\s+/g, ' ')
    .replace(/\b([SA])\s+(\d)/i, '$1$2') // "S 21" -> "S21"
    .replace(/\bPROMAX\b/i, 'PRO MAX')
    .trim()
    .toUpperCase();
  // FE / 5G stay all-caps; Pro / Plus / Max / Mini / Ultra / Fold / Flip / Air / Note title-case.
  out = out
    .replace(/\b(PRO MAX|PRO|PLUS|MAX|MINI|ULTRA|FOLD|FLIP|AIR|NOTE)\b/g, m => titleCase(m))
    .replace(/^([SA])(\d+)/i, (_, l, d) => `${l.toUpperCase()}${d}`);
  return out.trim();
}

// Industrial-grade model extractor.
//
// Strategy (in priority order):
//   1. Apple iPhone / iPad / Watch — distinctive enough to anchor on the
//      word itself, no brand context needed.
//   2. Samsung — first try inside a window after SAMSUNG or GALAXY (high
//      confidence, lets us tolerate looser whitespace inside the window).
//      Then fall back to a stricter standalone match if the OCR dropped
//      the brand word.
//   3. Pixel / OnePlus.
//
// We always strip the brand prefix from the returned value so the Brand
// dropdown and the Model field stay orthogonal.
export function extractModel(text: string, brand: string = ''): ExtractedField {
  if (!text) return { value: '', confidence: 0 };

  const T = normaliseForModelMatch(text);
  const brandLower = brand.toLowerCase();

  // ── Apple ────────────────────────────────────────────────────────────
  const iphone = T.match(/IPHONE\s*(SE|XR|XS|X|\d{1,3})(?:\s*(PRO\s*MAX|PROMAX|PRO|PLUS|MAX|MINI))?/);
  if (iphone) {
    const num = iphone[1].toUpperCase().replace(/^\d/, m => m); // keep digits / SE/XR/XS/X
    const tier = iphone[2] ? ` ${titleCase(iphone[2].replace(/PROMAX/, 'Pro Max'))}` : '';
    return { value: `iPhone ${num}${tier}`.trim(), confidence: 0.92 };
  }
  if (/\bIPAD\b/.test(T)) {
    const ipad = T.match(/IPAD(?:\s*(AIR|MINI|PRO))?(?:\s*(\d{1,2}))?/);
    const tier = ipad?.[1] ? ` ${titleCase(ipad[1])}` : '';
    const gen = ipad?.[2] ? ` ${ipad[2]}` : '';
    return { value: `iPad${tier}${gen}`, confidence: 0.88 };
  }
  if (/APPLE\s*WATCH/.test(T)) {
    return { value: 'Apple Watch', confidence: 0.85 };
  }

  // ── Samsung ──────────────────────────────────────────────────────────
  // 1. Brand-anchored window: high confidence
  const brandAnchor = T.match(/(?:SAMSUNG|GALAXY)/);
  if (brandAnchor) {
    const start = (brandAnchor.index ?? 0) + brandAnchor[0].length;
    const window = T.slice(start, start + 50);
    const m = window.match(
      /\b(S\s?\d{1,2}|A\s?\d{2,3}|NOTE\s*\d{1,2}|Z\s*(?:FLIP|FOLD)\s*\d{1,2})((?:\s+(?:FE|PLUS|ULTRA|5G|\+))*)/,
    );
    if (m) {
      return { value: tidyModel(m[0]), confidence: 0.90 };
    }
  }

  // 2. Standalone Samsung-series match with strict constraints.
  //    Required: digit must immediately follow the series letter, A-series
  //    needs 2+ digits, and either the brand is already Samsung or the
  //    model carries a Samsung-specific suffix (FE/Ultra/Plus/5G).
  const standalone = T.match(
    /\b(S\d{1,2}|A\d{2,3}|NOTE\s*\d{1,2}|Z\s*(?:FLIP|FOLD)\s*\d{1,2})((?:\s+(?:FE|PLUS|ULTRA|5G|\+))*)/,
  );
  if (standalone) {
    const hasSamsungSuffix = !!standalone[2]?.trim();
    if (brandLower === 'samsung' || hasSamsungSuffix) {
      return { value: tidyModel(standalone[0]), confidence: 0.80 };
    }
  }

  // ── Pixel ────────────────────────────────────────────────────────────
  const pixel = T.match(/PIXEL\s*(\d{1,2})\s*(PRO|XL|A)?/);
  if (pixel) {
    const tier = pixel[2] ? ` ${titleCase(pixel[2])}` : '';
    return { value: `Pixel ${pixel[1]}${tier}`.trim(), confidence: 0.88 };
  }

  // ── Generic fallback via TEXT_PATTERNS (kept for back-compat) ────────
  const matches = text.match(TEXT_PATTERNS.deviceModel);
  if (matches && matches.length) {
    return { value: tidyModel(matches[0]), confidence: brand ? 0.72 : 0.60 };
  }
  return { value: '', confidence: 0 };
}

export function extractColour(text: string): ExtractedField {
  const lowerText = text.toLowerCase();

  // Search for color keywords in text
  for (const [synonym, standardColor] of Object.entries(COLOR_SYNONYMS)) {
    if (lowerText.includes(synonym)) {
      return { value: standardColor, confidence: 0.80 };
    }
  }

  return { value: '', confidence: 0 };
}

export function extractDeviceFromText(text: string): ExtractedDevice {
  const brand = extractBrand(text);
  const model = extractModel(text, brand.value);

  return {
    imei: extractIMEI(text),
    brand,
    model,
    storage: extractStorage(text),
    grade: extractGrade(text),
    colour: extractColour(text),
  };
}

export function mergeExtractedFields(
  previous: ExtractedDevice,
  current: ExtractedDevice
): ExtractedDevice {
  return {
    imei: current.imei.value ? current.imei : previous.imei,
    brand: current.brand.value ? current.brand : previous.brand,
    model: current.model.value ? current.model : previous.model,
    storage: current.storage.value ? current.storage : previous.storage,
    grade: current.grade.value ? current.grade : previous.grade,
    colour: current.colour.value ? current.colour : previous.colour,
  };
}
