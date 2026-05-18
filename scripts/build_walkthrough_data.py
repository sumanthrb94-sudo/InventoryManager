#!/usr/bin/env python3
"""Extract every row of the INVENTORY sheet → src/data/walkthroughRows.json.

We render the workbook 1:1 in the Client Walkthrough UI, so the JSON
must mirror the file: in-office rows, the TOTAL marker, the SHS
section header, all the SHS line items, the SOLD section header, every
historical sold row. Blank rows are preserved too (rendered as
spacers) so the visible row numbers line up with what the client sees
when they open the workbook in Excel.

Classification is derived from the cell fill colour we applied during
the audit pass. A row classified as `divider` is the TOTAL/SHS/SOLD
section heading; `blank` is an empty row.
"""
import json
import os
from openpyxl import load_workbook
from collections import Counter

FILL_CLASS = {
    '00C6EFCE': 'green',
    '00FFC7CE': 'red',
    '00FFEB9C': 'yellow',
    '00BDD7EE': 'blue',
}

DIVIDER_KEYWORDS = {'TOTAL', 'SHS', 'SOLD', 'SOLD ITEMS'}

def row_class(inv, row_i):
    seen = Counter()
    for col in range(1, 9):
        c = inv.cell(row_i, col)
        if not (c.fill and c.fill.patternType == 'solid'):
            continue
        rgb = c.fill.fgColor.rgb
        if rgb in FILL_CLASS:
            seen[FILL_CLASS[rgb]] += 1
    for cls in ('red', 'yellow', 'green'):
        if seen[cls] >= 3:
            return cls
    if seen['blue'] > 0:
        return 'blue'
    return 'none'

def is_divider(model):
    if not model:
        return False
    return str(model).strip().upper() in DIVIDER_KEYWORDS

def main():
    wb = load_workbook('INVENTORY_REPORT_2026_annotated.xlsx')
    inv = wb['INVENTORY']

    rows_out = []
    # Walk every row up to the last non-empty + a small tail.
    last = inv.max_row
    for i in range(2, last + 1):
        model = inv.cell(i, 1).value
        bp = inv.cell(i, 2).value
        qty = inv.cell(i, 3).value
        val = inv.cell(i, 5).value
        colours = inv.cell(i, 6).value
        sup = inv.cell(i, 7).value
        notes = inv.cell(i, 8).value
        all_blank = all(v in (None, '') for v in (model, bp, qty, val, colours, sup, notes))
        if all_blank:
            rows_out.append({
                'row': i,
                'model': None, 'bp': None, 'qty': None, 'value': None,
                'colours': None, 'supplier': None, 'notes': None,
                'classification': 'blank',
            })
            continue
        klass = 'divider' if is_divider(model) else row_class(inv, i)
        rows_out.append({
            'row': i,
            'model': model,
            'bp': bp,
            'qty': qty,
            'value': val,
            'colours': colours,
            'supplier': sup,
            'notes': notes,
            'classification': klass,
        })

    # Strip the trailing run of blank rows — the sheet often has a few
    # hundred empties at the bottom we don't want to render.
    while rows_out and rows_out[-1]['classification'] == 'blank':
        rows_out.pop()

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
