"""
convert_excel.py  —  Production-grade Excel → JSON converter

Reads the master inventory Excel workbook and converts it to a
structured JSON file ready for Firestore seeding or app import.

All parameters are resolved from (priority order):
  1. CLI arguments
  2. Environment variables
  3. client.config.js values (read via JSON if available)
  4. Sensible defaults

Usage:
  python convert_excel.py                                       # auto-discover master file
  python convert_excel.py --file SAMPLE_INVENTORY_REPORT_2026.xlsx
  python convert_excel.py --file data.xlsx --sheet "OG STOCK DATA"
  python convert_excel.py --file data.xlsx --output public/imported_inventory.json
  python convert_excel.py --file data.xlsx --dry-run --verbose
  python convert_excel.py --help
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ── Constants ─────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).parent

COLOUR_LIST = [
    'NATURAL TITANIUM', 'BLACK TITANIUM', 'WHITE TITANIUM', 'BLUE TITANIUM',
    'DESERT TITANIUM', 'PACIFIC BLUE', 'SIERRA BLUE', 'ALPINE GREEN',
    'STARLIGHT', 'MIDNIGHT', 'SPACE GREY', 'SPACE GRAY', 'GRAPHITE',
    'PHANTOM BLACK', 'PHANTOM WHITE', 'PHANTOM SILVER',
    'ROSE GOLD', 'PRODUCT RED', 'SILVER', 'GOLD',
    'BLACK', 'WHITE', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE',
    'CORAL', 'MINT', 'PINK', 'TEAL', 'ORANGE', 'RED', 'CREAM', 'LAVENDER',
]

SUPPLIER_ALIASES = {
    'NIHAL':      'Nihal',
    'ABC':        'ABC Trading',
    'RR STOCK':   'RR Stock',
    'RR':         'RR Stock',
    'NANAK':      'Nanak',
    'MHL':        'MHL',
    'IMAX':       'IMAX',
    'BUNTY':      'Bunty',
    'MOBILE KIT': 'Mobile Kit',
    'MHL-RR':     'MHL-RR',
    'UNKNOWN':    'Unknown',
}

PLATFORM_ALIASES = {
    'EBAY':        'eBay',
    'E-BAY':       'eBay',
    'AMAZON':      'Amazon',
    'BACK MARKET': 'Backmarket',
    'BACKMARKET':  'Backmarket',
    'ONBUY':       'OnBuy',
    'ON BUY':      'OnBuy',
}

SOLD_STATUS_VALUES = {'SOLD', 'SALE', 'COMPLETED'}
RETURNED_STATUS_VALUES = {'RETURNED', 'RETURN'}

COLUMN_ALIASES = {
    'dateIn':    ['Date In', 'Date Added', 'Stock In', 'Received Date', 'Date'],
    'model':     ['Model', 'Device', 'Description', 'Product'],
    'imei':      ['IMEI', 'IMEI/Serial', 'Serial', 'S/N', 'Serial Number'],
    'supplier':  ['Supplier', 'Source', 'From', 'Vendor'],
    'buyPrice':  ['Buy Price', 'BP', 'Cost', 'Purchase Price', 'Cost Price'],
    'status':    ['Status', 'Available', 'State', 'Stock Status'],
    'platform':  ['Platform', 'Sale Platform', 'Listed On', 'Marketplace'],
    'salePrice': ['Sale Price', 'SP', 'Price Sold', 'Sold For'],
    'saleDate':  ['Sale Date', 'Date Sold', 'Sold Date'],
    'colour':    ['Colour', 'Color', 'Colour/Color'],
    'storage':   ['Storage', 'Capacity', 'GB'],
    'condition': ['Condition', 'Grade', 'Condition Grade'],
    'notes':     ['Notes', 'Note', 'Comments', 'Remarks'],
    'orderNum':  ['Order Number', 'Order No', 'Order #', 'Order ID'],
    'customer':  ['Customer Name', 'Customer', 'Buyer'],
}

MASTER_FILE_HINTS = [
    'SAMPLE_INVENTORY_REPORT_2026.xlsx',
    'INVENTORY REPORT 2026.xlsx',
    'INVENTORY_QA_TEST_5000.xlsx',
    'inventory_10k_qa.xlsx',
]

SHEET_FALLBACKS = ['OG STOCK DATA', 'Sheet1', 'Data', 'Inventory']


# ── Argument Parser ───────────────────────────────────────────────────────────

def build_arg_parser():
    p = argparse.ArgumentParser(
        prog='convert_excel.py',
        description='MOBILEPHONEMARKET — Excel → JSON Inventory Converter v2.0',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python convert_excel.py
  python convert_excel.py --file SAMPLE_INVENTORY_REPORT_2026.xlsx
  python convert_excel.py --file data.xlsx --sheet "OG STOCK DATA" --verbose
  python convert_excel.py --file data.xlsx --output public/imported_inventory.json
  python convert_excel.py --file data.xlsx --dry-run
        """
    )
    p.add_argument('-f', '--file',
                   help='Path to Excel file (overrides auto-discovery)',
                   default=None)
    p.add_argument('-s', '--sheet',
                   help='Sheet name to import',
                   default=None)
    p.add_argument('-o', '--output',
                   help='Output JSON path (default: imported_inventory.json)',
                   default=None)
    p.add_argument('--public',
                   help='Also write a copy to public/ for app seeding',
                   default=None)
    p.add_argument('--dry-run', action='store_true',
                   help='Parse only — do not write any files')
    p.add_argument('-v', '--verbose', action='store_true',
                   help='Show detailed per-row logging')
    return p


# ── File Discovery ────────────────────────────────────────────────────────────

def resolve_excel_file(cli_file: str | None) -> Path | None:
    candidates = [
        cli_file,
        os.environ.get('MASTER_EXCEL_PATH'),
    ]

    # Add hints relative to project root
    for hint in MASTER_FILE_HINTS:
        candidates.append(str(PROJECT_ROOT / hint))

    # Also try cwd
    for hint in MASTER_FILE_HINTS:
        candidates.append(hint)

    for c in candidates:
        if c:
            p = Path(c)
            if p.exists():
                return p.resolve()
    return None


def resolve_sheet(xl_file: Any, cli_sheet: str | None) -> str:
    sheet = cli_sheet or os.environ.get('IMPORT_SHEET_NAME')
    if sheet and sheet in xl_file.sheet_names:
        return sheet
    for fallback in SHEET_FALLBACKS:
        if fallback in xl_file.sheet_names:
            return fallback
    return xl_file.sheet_names[0]


# ── Column Resolution ─────────────────────────────────────────────────────────

def resolve_columns(df_columns: list) -> dict:
    """Map internal field names → actual DataFrame column names."""
    upper_cols = {c.upper().strip(): c for c in df_columns}
    resolved = {}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias.upper().strip() in upper_cols:
                resolved[field] = upper_cols[alias.upper().strip()]
                break
        # Not found — will be None
        if field not in resolved:
            resolved[field] = None
    return resolved


# ── Normalisation Helpers ─────────────────────────────────────────────────────

def normalise_supplier(raw) -> str:
    if not raw or str(raw).strip().lower() in ('', 'nan', 'none'):
        return 'Unknown'
    key = str(raw).strip().upper()
    return SUPPLIER_ALIASES.get(key, str(raw).strip() or 'Unknown')


# B8 fix — INVENTORY-sheet QUANTITY is mixed-type (numbers, "SHS",
# "NO STOCK", blanks). Callers must keep the row regardless of type;
# this helper classifies the cell so downstream can branch sanely.
def parse_quantity_cell(v):
    """Return a dict:
       {'qty': <number>}                                 when numeric
       {'qty': None, 'flag': 'SHS'|'NO_STOCK'|'OTHER',   when non-numeric
        'raw': <original string>}
    """
    if isinstance(v, bool):
        # bool is a subclass of int — exclude to avoid True/False sneaking in.
        return {'qty': None, 'flag': 'OTHER', 'raw': str(v)}
    if isinstance(v, (int, float)):
        # NaN floats are not finite
        if isinstance(v, float) and v != v:
            return {'qty': None, 'flag': 'OTHER', 'raw': ''}
        return {'qty': v}

    raw   = '' if v is None else str(v).strip()
    upper = raw.upper()

    if upper == 'SHS':
        return {'qty': None, 'flag': 'SHS', 'raw': raw}
    if upper in ('NO STOCK', 'NOSTOCK'):
        return {'qty': None, 'flag': 'NO_STOCK', 'raw': raw}

    import re as _re
    if raw and _re.fullmatch(r'-?\d+(\.\d+)?', raw):
        try:
            return {'qty': float(raw)}
        except ValueError:
            pass
    return {'qty': None, 'flag': 'OTHER', 'raw': raw}


# B7 fix — INVENTORY-sheet SUPPLIER column may list multiple suppliers
# separated by " / " (e.g. "MHL / ABC / NIHAL"). Returns the primary
# (first) name and the full list with empties dropped.
def parse_supplier_cell(v):
    """Return {'primaryName': str, 'allNames': list[str]}."""
    raw = '' if v is None else str(v).strip()
    if not raw:
        return {'primaryName': '', 'allNames': []}
    all_names = [s.strip() for s in raw.split('/') if s and s.strip()]
    return {
        'primaryName': all_names[0] if all_names else '',
        'allNames':    all_names,
    }


def normalise_platform(raw) -> str:
    if not raw or str(raw).strip().lower() in ('', 'nan', 'none'):
        return ''
    key = str(raw).strip().upper()
    return PLATFORM_ALIASES.get(key, str(raw).strip())


# ── Storage extraction ───────────────────────────────────────────────────────
#
# Mirrors src/lib/modelStorage.ts (kept inline because this script is standalone
# Python and can't import the TS helper). Keep the regex + normalisation rules
# in sync.
#
#   "IPAD 7TH GEN 32GB W/C"                  -> ("IPAD 7TH GEN W/C", "32GB")
#   "iPad 7 32GB Wifi 2019 10.2 - WIFI + 4G" -> ("iPad 7 Wifi 2019 10.2 - WIFI + 4G", "32GB")
#   "iPhone 13 Pro Max"                      -> ("iPhone 13 Pro Max", None)
#   "Galaxy S22 Ultra 1TB"                   -> ("Galaxy S22 Ultra", "1TB")
STORAGE_REGEX = re.compile(r'\b(\d+\s?(?:GB|TB))\b', re.IGNORECASE)


def _collapse_whitespace(s: str) -> str:
    return re.sub(r'\s+', ' ', s).strip()


def extract_storage(raw):
    """Extract storage capacity from a model string.

    Returns a (model, storage) tuple where `storage` is normalised to upper-case
    with no internal whitespace (e.g. "32 gb" -> "32GB") or `None` if no storage
    pattern was found. The returned `model` has the matched substring removed
    and whitespace collapsed.
    """
    input_str = '' if raw is None else str(raw)
    if not input_str.strip():
        return input_str.strip(), None

    match = STORAGE_REGEX.search(input_str)
    if not match:
        return _collapse_whitespace(input_str), None

    storage = re.sub(r'\s+', '', match.group(1)).upper()
    start, end = match.span()
    stitched = input_str[:start] + ' ' + input_str[end:]
    stitched = re.sub(r'\s+,', ',', stitched)
    stitched = re.sub(r',\s*,', ',', stitched)
    stitched = re.sub(r'^\s*,\s*|\s*,\s*$', '', stitched)
    return _collapse_whitespace(stitched), storage


def parse_colour(model: str, raw_colour) -> str:
    rc = str(raw_colour).strip() if raw_colour else ''
    if rc and rc.lower() not in ('unknown', 'nan', 'none', ''):
        return rc
    upper = model.upper()
    for c in COLOUR_LIST:
        if c in upper:
            if c in ('SPACE GREY', 'SPACE GRAY'):
                return 'Space Grey'
            return c[0] + c[1:].lower()
    return 'Unknown'


def parse_category(model: str) -> str:
    m = model.upper()
    if 'IPAD' in m:
        return 'iPad'
    if 'APPLE WATCH' in m or 'WATCH ULTRA' in m or 'WATCH SE' in m:
        return 'Apple Watch'
    if 'IPHONE' in m:
        return 'iPhone'
    if 'GALAXY TAB' in m or 'TAB A' in m or 'TAB S' in m:
        return 'Tablet'
    import re
    if re.search(r'GALAXY S\d|S2[0-5]', m):
        return 'Samsung S Series'
    if re.search(r'GALAXY A\d|A\d{2}', m):
        return 'Samsung A Series'
    if 'SAMSUNG' in m or 'GALAXY' in m:
        return 'Samsung A Series'
    return 'Other'


def parse_brand(category: str) -> str:
    if category in ('iPhone', 'iPad', 'Apple Watch'):
        return 'Apple'
    if 'Samsung' in category:
        return 'Samsung'
    return 'Other'


def is_sold(raw_status) -> bool:
    return str(raw_status).strip().upper() in SOLD_STATUS_VALUES


def is_returned(raw_status) -> bool:
    return str(raw_status).strip().upper() in RETURNED_STATUS_VALUES


def safe_date(val) -> str:
    if val is None or str(val).strip().lower() in ('', 'nan', 'none', 'nat'):
        return datetime.now(timezone.utc).date().isoformat()
    if hasattr(val, 'date'):  # pandas Timestamp
        return str(val.date())
    try:
        return str(val)[:10]
    except Exception:
        return datetime.now(timezone.utc).date().isoformat()


def safe_float(val) -> float:
    try:
        f = float(val)
        return f if not (f != f) else 0.0   # NaN check
    except (TypeError, ValueError):
        return 0.0


def safe_str(val, default='') -> str:
    s = str(val).strip()
    return default if s.lower() in ('', 'nan', 'none', 'nat') else s


# Preserve IMEIs verbatim: client data includes alphanumeric Apple serials
# (e.g. "NL6CMQCYTD", "SKC9P3QVP6F"), so we MUST NOT strip non-digits.
def normalize_imei(val) -> str:
    if val is None:
        return ''
    # openpyxl reads numeric IMEIs as float; format as integer to avoid scientific notation.
    if isinstance(val, float):
        if val != val:  # NaN
            return ''
        if val.is_integer():
            return format(int(val), 'd')
        return repr(val)
    if isinstance(val, int):
        return format(val, 'd')
    s = str(val).strip()
    if s.lower() in ('nan', 'none', 'nat'):
        return ''
    # strip surrounding whitespace and quotes only
    return s.strip().strip('"').strip("'").strip()


def build_unit_id(imei: str, model: str, date_in: str, supplier_id: str,
                  buy_price: float, status: str) -> str:
    key = '|'.join([imei or model, date_in, supplier_id, str(buy_price), status])
    return 'u_' + hashlib.md5(key.encode()).hexdigest()[:16]


# ── Core Parser ───────────────────────────────────────────────────────────────

def parse_sheet(df, cols: dict, verbose: bool) -> dict:
    """Convert a DataFrame → {suppliers, units, stats}."""
    now = datetime.now(timezone.utc).isoformat()
    supplier_map = {}
    unit_map     = {}
    skipped      = 0
    duplicates   = 0

    def get(row, field, default=''):
        col = cols.get(field)
        if col is None:
            return default
        val = row.get(col, default)
        return safe_str(val, default)

    for idx, row in df.iterrows():
        raw_model = get(row, 'model')
        if not raw_model:
            skipped += 1
            continue
        # Strip embedded storage (e.g. "iPad 7 32GB Wifi" -> "iPad 7 Wifi" + "32GB").
        # The cleaned model is what we persist; storage falls back to the value
        # in the dedicated Storage column when present.
        model, model_storage = extract_storage(raw_model)

        # Use the raw cell value (not safe_str'd) so normalize_imei can detect
        # floats from openpyxl and format them as ints (avoids 1.23e+14 scientific notation).
        imei_col = cols.get('imei')
        raw_imei = row.get(imei_col) if imei_col is not None else ''
        imei     = normalize_imei(raw_imei)
        raw_supplier  = get(row, 'supplier', 'Unknown')
        # B7 fix: a single cell may carry multiple suppliers ("MHL / ABC / NIHAL").
        # primaryName drives the legacy supplierId; the full list is preserved on the unit.
        sup_parsed    = parse_supplier_cell(raw_supplier)
        supplier_name = normalise_supplier(sup_parsed['primaryName'] or raw_supplier)
        supplier_names_all = (
            [normalise_supplier(n) for n in sup_parsed['allNames']]
            if sup_parsed['allNames']
            else [supplier_name]
        )
        buy_price     = safe_float(get(row, 'buyPrice', '0'))
        raw_status    = get(row, 'status')
        sold          = is_sold(raw_status)
        returned      = is_returned(raw_status) and not sold
        raw_platform  = get(row, 'platform')
        platform      = normalise_platform(raw_platform)
        sale_price    = safe_float(get(row, 'salePrice', '0'))
        raw_date_in   = row.get(cols.get('dateIn')) if cols.get('dateIn') else None
        date_in       = safe_date(raw_date_in)
        raw_sale_date = row.get(cols.get('saleDate')) if cols.get('saleDate') else None
        sale_date     = safe_date(raw_sale_date) if raw_sale_date else date_in
        raw_colour    = get(row, 'colour')
        # Prefer the dedicated Storage column when present, fall back to the
        # value we extracted out of the MODEL string above.
        storage       = (get(row, 'storage') or model_storage) or None
        condition     = get(row, 'condition') or None
        notes         = get(row, 'notes') or ''
        order_num     = get(row, 'orderNum') or None
        customer      = get(row, 'customer') or None

        # Supplier record(s). One synthetic id per supplier name; the first is primary.
        def _supplier_id_for(name, _map=supplier_map, _now=now):
            sid = f"sup_{name.replace(' ', '_').lower()}"
            if sid not in _map:
                _map[sid] = {
                    'id':        sid,
                    'name':      name,
                    'portal':    'Direct',
                    'ownerId':   'shared',
                    'createdAt': _now,
                }
            return sid
        supplier_id  = _supplier_id_for(supplier_name)
        supplier_ids = [_supplier_id_for(n) for n in supplier_names_all]

        category = parse_category(model)
        brand    = parse_brand(category)
        colour   = parse_colour(model, raw_colour)
        status   = 'sold' if sold else ('returned' if returned else 'available')
        unit_id  = build_unit_id(imei, model, date_in, supplier_id, buy_price, status)

        dedupe_key = imei or unit_id

        if dedupe_key in unit_map:
            duplicates += 1
            # Upsert — update existing record
        
        listing_sites = ([platform] if (status == 'available' and platform) else [])

        unit = {
            'id':             unit_id,
            'imei':           imei,
            'model':          model.strip(),
            'brand':          brand,
            'category':       category,
            'colour':         colour,
            'buyPrice':       buy_price,
            'dateIn':         date_in,
            'supplierId':     supplier_id,
            **({'supplierIds': supplier_ids} if len(supplier_ids) > 1 else {}),
            'status':         status,
            'flags':          [],
            'notes':          notes,
            'platformListed': status == 'available' and len(listing_sites) > 0,
            'listingSites':   listing_sites,
            'ownerId':        'shared',
            'createdAt':      now,
            'updatedAt':      now,
        }

        if storage:       unit['storage']       = storage
        if condition:     unit['conditionGrade'] = condition
        if sold and platform:   unit['salePlatform']  = platform
        if sold and sale_price: unit['salePrice']     = sale_price
        if sold:                unit['saleDate']       = sale_date
        if order_num:           unit['saleOrderId']    = order_num
        if customer:            unit['customerName']   = customer

        if verbose and idx < 5:
            print(f"  [Row {idx}] {status.upper():10} | {model[:40]:40} | {colour:20} | £{buy_price:.2f}")

        unit_map[dedupe_key] = unit

    units     = list(unit_map.values())
    suppliers = list(supplier_map.values())

    return {
        'suppliers': suppliers,
        'units':     units,
        'stats': {
            'total':      len(units),
            'available':  sum(1 for u in units if u['status'] == 'available'),
            'sold':       sum(1 for u in units if u['status'] == 'sold'),
            'returned':   sum(1 for u in units if u['status'] == 'returned'),
            'skipped':    skipped,
            'duplicates': duplicates,
        },
    }


# ── Entry Point ───────────────────────────────────────────────────────────────

def main():
    try:
        import pandas as pd
    except ImportError:
        print('❌ pandas is required: pip install pandas openpyxl xlrd')
        sys.exit(1)

    parser = build_arg_parser()
    args   = parser.parse_args()

    print('\n╔══════════════════════════════════════════════════════════════╗')
    print('║   MOBILEPHONEMARKET — Excel → JSON Converter v2.0           ║')
    print('╚══════════════════════════════════════════════════════════════╝\n')

    # ── Resolve file ──────────────────────────────────────────────────────────
    file_path = resolve_excel_file(args.file)
    if not file_path:
        print('❌ Could not locate master Excel file.')
        print('   Searched:')
        for hint in MASTER_FILE_HINTS:
            print(f'     • {PROJECT_ROOT / hint}')
        print('\n   Use: python convert_excel.py --file "path/to/file.xlsx"')
        sys.exit(1)

    size_kb = file_path.stat().st_size / 1024
    print(f'📂 File : {file_path}')
    print(f'   Size : {size_kb:.0f} KB')

    # ── Resolve sheet ─────────────────────────────────────────────────────────
    xl = pd.ExcelFile(file_path)
    sheet_name = resolve_sheet(xl, args.sheet)
    print(f'📋 Sheet: "{sheet_name}"  (available: {", ".join(xl.sheet_names)})')

    # ── Load DataFrame ────────────────────────────────────────────────────────
    df = xl.parse(sheet_name, header=0)
    df = df.fillna('')

    print(f'   Rows : {len(df)}  |  Columns : {len(df.columns)}\n')

    cols = resolve_columns(list(df.columns))

    if args.verbose:
        print('  Detected column mappings:')
        for field, col in cols.items():
            print(f'    {field:<12} → {col or "— not found"}')
        print()

    # ── Parse ─────────────────────────────────────────────────────────────────
    result = parse_sheet(df, cols, args.verbose)
    s      = result['stats']

    print('┌─────────────────────────────────────────────────────┐')
    print(f'│  Total units    : {str(s["total"]).ljust(34)} │')
    print(f'│  Available      : {str(s["available"]).ljust(34)} │')
    print(f'│  Sold           : {str(s["sold"]).ljust(34)} │')
    print(f'│  Returned       : {str(s["returned"]).ljust(34)} │')
    print(f'│  Suppliers      : {str(len(result["suppliers"])).ljust(34)} │')
    print(f'│  Skipped rows   : {str(s["skipped"]).ljust(34)} │')
    print(f'│  Duplicates     : {str(s["duplicates"]).ljust(34)} │')
    print('└─────────────────────────────────────────────────────┘')

    if result['suppliers']:
        names = ' · '.join(sup['name'] for sup in result['suppliers'])
        print(f'\n  Suppliers : {names}')

    if args.dry_run:
        print('\n✅ Dry run complete — no files written.\n')
        return

    # ── Write output ──────────────────────────────────────────────────────────
    output_path = Path(
        args.output
        or os.environ.get('IMPORT_OUTPUT_PATH')
        or PROJECT_ROOT / 'imported_inventory.json'
    )
    payload = {'suppliers': result['suppliers'], 'units': result['units']}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2))
    out_kb = output_path.stat().st_size / 1024
    print(f'\n✅ Written: {output_path}  ({out_kb:.0f} KB)')

    # ── Optional public copy ──────────────────────────────────────────────────
    if args.public:
        public_path = Path(args.public)
        public_path.parent.mkdir(parents=True, exist_ok=True)
        public_path.write_text(json.dumps(payload, indent=2))
        print(f'✅ Written: {public_path}  (public seed)')

    print('\n  Next steps:')
    print('  1. Run: node upload_to_firestore.cjs')
    print('  2. Or:  node import_excel.cjs --public public/imported_inventory.json')
    print('  3. Or:  Use Import Excel in the app UI\n')


if __name__ == '__main__':
    main()
