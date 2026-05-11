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

export function extractModel(text: string, brand: string = ''): ExtractedField {
  const matches = text.match(TEXT_PATTERNS.deviceModel);
  if (!matches || matches.length === 0) {
    return { value: '', confidence: 0 };
  }

  const model = matches[0];
  // Model confidence higher if brand is also detected
  const confidence = brand ? 0.82 : 0.70;

  return { value: model, confidence };
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
