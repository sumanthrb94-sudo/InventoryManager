export const TEXT_PATTERNS = {
  // IMEI: 14-15 digits
  imei: /\b(\d{14,15})\b/g,

  // Storage patterns: GB or TB with optional space
  storage: /\b(?:(\d+)\s*(?:GB|TB))\b/gi,

  // Grade patterns
  grade: /\b(?:Grade\s*[A-C]|A\+|Excellent|Good|Fair|Refurbished|Brand\s+New|Like\s+New|ONU)\b/gi,

  // Color patterns (will be matched against COLOR_SYNONYMS)
  color: /(?:Color|Colour|Color:|Colour:|[Cc]olour?:?\s*)?([A-Za-z\s]+)/gi,

  // Device model patterns (iPhone, iPad, Galaxy, etc.)
  // Samsung wholesale labels commonly omit the "Galaxy" prefix
  // (e.g. "SAMSUNG S21 FE 5G", "S22 ULTRA", "A52 5G"), so we accept
  // bare S/A/Note/Z-Fold/Z-Flip designators too. Optional FE/PLUS/ULTRA/
  // MAX/MINI/5G suffixes pick up the SKU variants.
  deviceModel: /\b(?:iPhone\s*(?:SE|XR|XS|X|\d{1,3})(?:\s*(?:Pro|Plus|Max|Mini))*|iPad(?:\s*(?:Air|Pro|Mini))?(?:\s*\d{1,2})?|(?:Galaxy\s*)?(?:S|A|Note)\s*\d{1,3}(?:\s*(?:FE|Plus|Ultra|5G))*|(?:Galaxy\s*)?Z\s*(?:Flip|Fold)\s*\d{1,2}(?:\s*5G)?|Pixel\s*\d{1,2}(?:\s*(?:Pro|XL|a))?)\b/gi,
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

export const STORAGE_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB'];

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
