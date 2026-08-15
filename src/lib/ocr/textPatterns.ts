export const TEXT_PATTERNS = {
  // IMEI: 14-15 digits
  imei: /\b(\d{14,15})\b/g,

  // Storage patterns: GB or TB with optional space
  storage: /\b(?:(\d+)\s*(?:GB|TB))\b/gi,

  // Grade patterns.
  //
  // Two things this has to get right, both of which it previously did not:
  //
  //   A SEPARATOR IS NORMAL. Labels and OCR output write "Grade: A", not
  //   "Grade A". `Grade\s*[A-C]` has no room for the colon, so every
  //   punctuated label missed and the field came back blank.
  //
  //   "A+" NEEDS NO TRAILING \b. A word boundary needs a word character on
  //   one side, and "+" is not one — so `A\+\b` is unsatisfiable and A+ could
  //   never match anywhere, under any input. It is a negative lookahead now.
  //
  // A bare single letter still requires the "Grade" prefix: loose OCR text is
  // full of stray capitals, and reading one as a grade would misprice a unit.
  grade: /\bGrade\s*[:\-]?\s*(?:A\+|[A-C])(?![\w+])|\bA\+(?![\w+])|\b(?:Excellent|Very\s+Good|Good|Fair|Acceptable|Refurbished|Brand\s+New|Like\s+New|ONU)\b/gi,

  // Color patterns (will be matched against COLOR_SYNONYMS)
  color: /(?:Color|Colour|Color:|Colour:|[Cc]olour?:?\s*)?([A-Za-z\s]+)/gi,

  // Device model patterns (iPhone, iPad, Galaxy, etc.)
  //
  // Samsung wholesale labels commonly omit the "Galaxy" prefix
  // (e.g. "SAMSUNG S21 FE 5G", "S22 ULTRA", "A52 5G"), so we accept
  // bare S/A/Note designators too. Constraints to avoid false matches
  // on stray text like "Grade A 3":
  //   - digit must come immediately after the series letter (no space)
  //   - A-series requires at least 2 digits (A10+; no real "A 3" device)
  //   - S-series stays 1-2 digits (S6 .. S25)
  //   - Note-series stays 1-2 digits (Note 7+)
  // Optional FE/PLUS/ULTRA/MAX/MINI/5G suffixes pick up SKU variants.
  deviceModel: /\b(?:iPhone\s*(?:SE|XR|XS|X|\d{1,3})(?:\s*(?:Pro|Plus|Max|Mini))*|iPad(?:\s*(?:Air|Pro|Mini))?(?:\s*\d{1,2})?|(?:Galaxy\s*)?(?:S\d{1,2}|A\d{2,3}|Note\s*\d{1,2})(?:\s*(?:FE|Plus|Ultra|5G|\+))*|(?:Galaxy\s*)?Z\s*(?:Flip|Fold)\s*\d{1,2}(?:\s*5G)?|Pixel\s*\d{1,2}(?:\s*(?:Pro|XL|a))?)\b/gi,
};

export const COLOR_SYNONYMS: Record<string, string> = {
  // iPhone colors
  black: 'Black',
  'jet black': 'Black',
  'deep black': 'Black',
  'midnight black': 'Black',
  'phantom black': 'Phantom Black',

  white: 'White',
  'pure white': 'White',
  'pearl white': 'White',
  'phantom white': 'Phantom White',

  blue: 'Blue',
  'pacific blue': 'Pacific Blue',
  'sierra blue': 'Sierra Blue',
  'deep blue': 'Blue',

  gold: 'Gold',
  'rose gold': 'Rose Gold',
  'champagne gold': 'Gold',

  silver: 'Silver',
  'polished silver': 'Silver',

  gray: 'Space Grey',
  grey: 'Space Grey',
  'space grey': 'Space Grey',
  'space gray': 'Space Grey',
  'graphite': 'Graphite',

  green: 'Green',
  'alpine green': 'Alpine Green',
  'midnight green': 'Green',

  red: 'Red',
  'product red': 'Red',

  purple: 'Purple',
  'deep purple': 'Purple',

  pink: 'Pink',
  'coral': 'Coral',
  'peach': 'Coral',

  yellow: 'Yellow',
  'starlight': 'Starlight',

  titanium: 'Titanium',
  'natural titanium': 'Natural Titanium',
  'black titanium': 'Black Titanium',
  'white titanium': 'White Titanium',
  'desert titanium': 'Desert Titanium',

  // Generic
  other: 'Other',
  unknown: 'Other',
};

export const GRADE_MAPPING: Record<string, string> = {
  'a+': 'A',
  'a': 'A',
  'excellent': 'A',
  'like new': 'A',
  'brand new': 'A',

  'b': 'B',
  'good': 'B',
  'very good': 'B',

  'c': 'C',
  'fair': 'C',
  'acceptable': 'C',
  'refurbished': 'C',
  'onu': 'C',
};

export const STORAGE_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', 'Not Applicable'];

// Canonical list of model designators we consider valid output for the
// auto-fill. Used by the extractor to snap noisy OCR candidates (e.g.
// "S82" → "S22") to the closest known model when within edit-distance.
// Keep this conservative: a wrong-but-close snap is worse than no snap,
// so we only include the designators actually shipping in current SKUs.
export const KNOWN_MODELS: { brand: string; designator: string; suffixes: string[] }[] = [
  // Samsung Galaxy S-series (S20 .. S25), each with FE / + / Ultra variants
  ...['S20', 'S21', 'S22', 'S23', 'S24', 'S25'].flatMap(d => [
    { brand: 'Samsung', designator: d, suffixes: ['', '5G', 'FE', 'FE 5G', 'Plus', 'Plus 5G', 'Ultra', 'Ultra 5G'] },
  ]),
  // Samsung Galaxy A-series — the actual A-series numbers that have shipped
  ...['A04', 'A05', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A20', 'A21', 'A22',
      'A23', 'A24', 'A25', 'A30', 'A31', 'A32', 'A33', 'A34', 'A35', 'A50', 'A51',
      'A52', 'A53', 'A54', 'A55', 'A70', 'A71', 'A72', 'A73', 'A74', 'A75'].flatMap(d => [
    { brand: 'Samsung', designator: d, suffixes: ['', '5G'] },
  ]),
  // Samsung Galaxy Note — discontinued line but inventory is common
  ...['Note 8', 'Note 9', 'Note 10', 'Note 20'].flatMap(d => [
    { brand: 'Samsung', designator: d, suffixes: ['', 'Plus', 'Ultra', 'Ultra 5G'] },
  ]),
  // Samsung Z Fold / Z Flip
  ...['Z Fold 3', 'Z Fold 4', 'Z Fold 5', 'Z Fold 6',
      'Z Flip 3', 'Z Flip 4', 'Z Flip 5', 'Z Flip 6'].flatMap(d => [
    { brand: 'Samsung', designator: d, suffixes: ['', '5G'] },
  ]),
  // Apple iPhone (SE / X / XR / XS, then 11..17, each with Plus / Pro / Pro Max / Mini)
  ...['SE', 'X', 'XR', 'XS', '11', '12', '13', '14', '15', '16', '17'].flatMap(n => [
    { brand: 'Apple', designator: `iPhone ${n}`, suffixes: ['', 'Mini', 'Plus', 'Pro', 'Pro Max'] },
  ]),
];

export const BRAND_KEYWORDS: Record<string, string> = {
  iphone: 'Apple',
  ipad: 'Apple',
  'apple watch': 'Apple',
  galaxy: 'Samsung',
  samsung: 'Samsung',
  pixel: 'Google',
  motorola: 'Motorola',
  nokia: 'Nokia',
  oneplus: 'OnePlus',
  xiaomi: 'Xiaomi',
  huawei: 'Huawei',
  oppo: 'OPPO',
  vivo: 'Vivo',
};
