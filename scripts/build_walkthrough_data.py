#!/usr/bin/env python3
"""Extract row classifications from annotated workbook → src/data/walkthroughRows.json.

Read INVENTORY_REPORT_2026_annotated.xlsx, classify each in-office row
(2-39) by the cell fill colour we applied, and emit a JSON file the
Client Walkthrough UI consumes at runtime.
"""
import json
import os
from openpyxl import load_workbook
from collections import Counter

# Hex codes the annotation script wrote in (Excel default palette,
# slightly different from what was passed in due to xlsx round-tripping).
FILL_CLASS = {
    '00C6EFCE': 'green',   # clean match
    '00FFC7CE': 'red',     # real issue
    '00FFEB9C': 'yellow',  # rollup qty gap
    '00BDD7EE': 'blue',    # our fix (single cell)
}

def row_class(inv, row_i):
    """Pick the dominant classification for a row. Blue is a per-cell
    flag (it sits on one cell, not the whole row), so it overrides
    only when no other class is present."""
    seen = Counter()
    for col in range(1, 9):
        c = inv.cell(row_i, col)
        if not (c.fill and c.fill.patternType == 'solid'):
            continue
        rgb = c.fill.fgColor.rgb
        if rgb in FILL_CLASS:
            seen[FILL_CLASS[rgb]] += 1
    # Priority: red > yellow > green > blue > none. Blue rarely covers
    # all cells; it usually marks the one cell that was renamed.
    for cls in ('red', 'yellow', 'green'):
        if seen[cls] >= 3:
            return cls
    if seen['blue'] > 0:
        return 'blue'
    return 'none'

def main():
    wb = load_workbook('INVENTORY_REPORT_2026_annotated.xlsx')
    inv = wb['INVENTORY']

    rows_out = []
    for i in range(2, 40):
        model = inv.cell(i, 1).value
        if not model:
            continue
        if str(model).strip().upper() in ('TOTAL', 'SHS', 'SOLD'):
            continue
        rows_out.append({
            'row': i,
            'model': model,
            'bp': inv.cell(i, 2).value,
            'qty': inv.cell(i, 3).value,
            'value': inv.cell(i, 5).value,
            'colours': inv.cell(i, 6).value,
            'supplier': inv.cell(i, 7).value,
            'notes': inv.cell(i, 8).value,
            'classification': row_class(inv, i),
        })

    counts = Counter(r['classification'] for r in rows_out)
    print(f"Rows extracted: {len(rows_out)}")
    print(f"By classification: {dict(counts)}")

    os.makedirs('src/data', exist_ok=True)
    out_path = 'src/data/walkthroughRows.json'
    with open(out_path, 'w') as f:
        json.dump(rows_out, f, indent=2)
    print(f"→ saved {out_path}")

if __name__ == '__main__':
    main()
