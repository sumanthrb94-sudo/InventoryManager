#!/usr/bin/env python3
"""
Reconcile what ClientWalkthrough.handleLoadToDb would produce against the
source walkthroughWorkbook.json.

Replicates the loader's matching logic exactly:
  - For each INVENTORY row, normalise the model name.
  - Look up every "available" IMEI sheet row (status blank or "AVAILABLE")
    whose model normalises to the same key.
  - For each match, the loader writes a unit doc with id
    `walkthrough_${batchId}_u_${imeiValue}`.

That id is keyed by IMEI value only -- not by source row -- so if two
INVENTORY rows normalise to the same model key (or two rows share matching
IMEIs by any other path), the second write to Firestore silently clobbers
the first via merge: true. This script flags those collisions, plus the
orphan IMEIs that no INVENTORY row would ever match.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

WORKBOOK = Path(__file__).resolve().parent.parent / "src" / "data" / "walkthroughWorkbook.json"


def norm(s) -> str:
    """Mirror of normalizeModel() in ClientWalkthrough.tsx -- lowercase,
    every non-alphanumeric run collapses to a single space, trimmed."""
    out = []
    for c in str(s if s is not None else "").lower():
        out.append(c if c.isalnum() else " ")
    return " ".join("".join(out).split())


def as_str(v) -> str:
    """Match the loader's asStr() coercion -- None -> '', everything else
    str()'d. Preserves the original loader's treatment of numeric IMEIs."""
    if v is None:
        return ""
    return str(v)


def main() -> None:
    wb = json.loads(WORKBOOK.read_text())
    inv_rows = wb["INVENTORY"]["rows"]
    imei_rows = wb["IMEI NUMBERS"]["rows"]

    # --- Step 1: collect every available IMEI row, keyed by normalised model.
    #     Status is blank or "AVAILABLE" per the loader.
    imei_by_model: dict[str, list[dict]] = defaultdict(list)
    # Keep all available IMEI values too so we can spot orphans later.
    all_available_imeis: set[str] = set()
    # Track every (imei_value -> source_rows) so we can call out IMEI-value
    # duplicates within the sheet itself (those would also collide on
    # unit-doc id even from a single INVENTORY row).
    imei_value_sheet_rows: dict[str, list[int]] = defaultdict(list)

    for r in imei_rows:
        if r["classification"] == "blank":
            continue
        cells = r["cells"]
        model = as_str(cells[1])
        status = as_str(cells[7]).strip().upper()
        if not model:
            continue
        if status and status != "AVAILABLE":
            continue
        imei_val = as_str(cells[2]).strip()
        if not imei_val:
            # Loader's `if (!imeiVal) continue` -- never produces a doc.
            continue
        key = norm(model)
        imei_by_model[key].append(r)
        all_available_imeis.add(imei_val)
        imei_value_sheet_rows[imei_val].append(r["row"])

    total_available_unique = len(all_available_imeis)

    # --- Step 2: simulate the loader. For each INVENTORY row (any non-
    #     divider/blank classification), pull its match list and count
    #     unique IMEI values. We do this across ALL classifications so we
    #     can break the report down per-pill the way the UI would.
    #
    #     Track imei_val -> list[(inv_row, classification, model)] so we
    #     can detect doc-id collisions across rows.
    imei_to_inv_matches: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    matches_by_classification: dict[str, set[str]] = defaultdict(set)
    rows_that_matched_anything: list[tuple[int, str, str, int]] = []
    rows_with_no_matches: list[tuple[int, str, str]] = []

    for r in inv_rows:
        cls = r["classification"]
        if cls in ("divider", "blank"):
            continue
        model = as_str(r["cells"][0]).strip()
        if not model:
            continue
        key = norm(model)
        matched = imei_by_model.get(key, [])
        unique_imeis_for_row: set[str] = set()
        for ir in matched:
            imei_val = as_str(ir["cells"][2]).strip()
            if not imei_val:
                continue
            unique_imeis_for_row.add(imei_val)
            imei_to_inv_matches[imei_val].append((r["row"], cls, model))
        for v in unique_imeis_for_row:
            matches_by_classification[cls].add(v)
        if unique_imeis_for_row:
            rows_that_matched_anything.append((r["row"], cls, model, len(unique_imeis_for_row)))
        else:
            rows_with_no_matches.append((r["row"], cls, model))

    # --- Step 3: orphans -- available IMEIs no INVENTORY row touches.
    matched_imeis = set(imei_to_inv_matches.keys())
    orphan_imeis = all_available_imeis - matched_imeis

    # --- Step 4: collisions -- one IMEI value claimed by 2+ INVENTORY rows.
    #     These are the silent-drop cases: the loader writes one unit doc
    #     per IMEI, but the second write merges over the first in Firestore.
    collisions: list[tuple[str, list[tuple[int, str, str]]]] = []
    for imei_val, claims in imei_to_inv_matches.items():
        # Distinct INVENTORY source rows claiming this IMEI.
        distinct_inv_rows = {(c[0], c[1], c[2]) for c in claims}
        if len(distinct_inv_rows) > 1:
            collisions.append((imei_val, sorted(distinct_inv_rows)))

    # --- Step 5: IMEI-value duplicates *within the IMEI sheet itself*.
    #     One IMEI value present on multiple available rows still folds
    #     into a single unit doc (same id), and is worth surfacing too.
    sheet_dup_imeis = {v: rows for v, rows in imei_value_sheet_rows.items() if len(rows) > 1}

    # --- Step 6: total unique unit docs that survive a "load everything"
    #     pass over every classification with at least one matched IMEI.
    #     This is just the count of distinct IMEI values the loader would
    #     write to -- collisions collapse to one doc, orphans contribute zero.
    surviving_unit_docs = len(matched_imeis)

    # ---------------------------------------------------------------- report
    print("=" * 72)
    print("CLIENT WALKTHROUGH LOAD-TO-DB RECONCILIATION")
    print("=" * 72)

    print(f"\n[1] Total available IMEIs in IMEI NUMBERS sheet")
    print(f"    Unique IMEI values (status blank or AVAILABLE): {total_available_unique}")
    # Also surface the raw row count so the user can sanity-check.
    raw_available_rows = sum(len(v) for v in imei_value_sheet_rows.values())
    print(f"    Raw available rows (pre-dedup):                 {raw_available_rows}")

    print(f"\n[2] Matched unit docs the loader would write, per INVENTORY classification")
    print(f"    (unique IMEI values across rows of that class)")
    for cls in ("green", "yellow", "red", "blue"):
        rows_in_cls = sum(1 for r in inv_rows if r["classification"] == cls)
        matched_in_cls = len(matches_by_classification.get(cls, set()))
        print(f"    {cls:<7} rows={rows_in_cls:>3}   matched unique IMEIs={matched_in_cls}")

    print(f"\n[3] CRITICAL -- IMEI values matched by MORE THAN ONE INVENTORY row")
    print(f"    Each collision = one unit doc the loader silently drops on second write.")
    if not collisions:
        print("    None. No cross-row doc-id collisions.")
    else:
        print(f"    {len(collisions)} colliding IMEI(s):\n")
        for imei_val, claims in sorted(collisions):
            print(f"    IMEI {imei_val}")
            for row_n, cls, model in claims:
                print(f"      <- inv row {row_n:>3} [{cls:<6}] {model}")
            print()

    if sheet_dup_imeis:
        print(f"    Note: {len(sheet_dup_imeis)} IMEI value(s) appear on multiple available rows")
        print(f"    in the IMEI sheet itself (one unit doc each regardless):")
        for v, rows in sorted(sheet_dup_imeis.items()):
            print(f"      IMEI {v} -> sheet rows {rows}")

    print(f"\n[4] CRITICAL -- available IMEIs no INVENTORY row matches (orphans)")
    print(f"    These can never load because no INVENTORY rollup keys to them.")
    if not orphan_imeis:
        print("    None. Every available IMEI is reachable from some INVENTORY row.")
    else:
        # Group orphans by model so the output is actionable, not a wall of numbers.
        orphans_by_model: dict[str, list[str]] = defaultdict(list)
        for r in imei_rows:
            if r["classification"] == "blank":
                continue
            cells = r["cells"]
            imei_val = as_str(cells[2]).strip()
            if imei_val not in orphan_imeis:
                continue
            status = as_str(cells[7]).strip().upper()
            if status and status != "AVAILABLE":
                continue
            model = as_str(cells[1]).strip()
            orphans_by_model[model].append(imei_val)
        print(f"    {len(orphan_imeis)} orphan IMEI(s) across {len(orphans_by_model)} model(s):\n")
        for model, imeis in sorted(orphans_by_model.items()):
            uniq = sorted(set(imeis))
            print(f"    {model}  (norm key: {norm(model)!r})")
            print(f"      {len(uniq)} IMEI(s): {', '.join(uniq[:6])}" + (" ..." if len(uniq) > 6 else ""))

    print(f"\n[5] Surviving unique unit docs after a 'load everything' run")
    n_collisions = len(collisions)
    # The arithmetic the spec asks for, made explicit.
    print(f"    total available IMEIs           : {total_available_unique}")
    print(f"    - orphans (never matched)       : {len(orphan_imeis)}")
    collapsed_by_collision = sum(
        len({c[0] for c in claims}) - 1
        for v, claims in imei_to_inv_matches.items()
        if len({c[0] for c in claims}) > 1
    )
    print(f"    - rows lost to collisions       : 0  (collisions still write 1 doc per IMEI)")
    print(f"    = surviving unique unit docs    : {surviving_unit_docs}")
    print(f"    (collision count = {n_collisions}; each is a row whose unit doc gets overwritten,")
    print(f"     not a missing doc -- the *unit count per inv row* is what diverges)")

    # Sanity: surviving docs must equal total available minus orphans.
    expected = total_available_unique - len(orphan_imeis)
    if expected != surviving_unit_docs:
        print(f"    !! arithmetic mismatch: expected {expected}, got {surviving_unit_docs}")
    else:
        print(f"    arithmetic check ok ({total_available_unique} - {len(orphan_imeis)} = {surviving_unit_docs})")

    print(f"\n[bonus] INVENTORY rows with classification != divider/blank that matched ZERO IMEIs")
    if not rows_with_no_matches:
        print("    None.")
    else:
        cnt_by_cls = Counter(c for _, c, _ in rows_with_no_matches)
        print(f"    {len(rows_with_no_matches)} row(s); by class: {dict(cnt_by_cls)}")
        for row_n, cls, model in rows_with_no_matches:
            print(f"      row {row_n:>3} [{cls:<6}] {model}")

    print("\n" + "=" * 72)


if __name__ == "__main__":
    main()
