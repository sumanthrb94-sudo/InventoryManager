"""Derive the headline figures for the email from the two exported workbooks."""
import json, sys, openpyxl

NAMES = {"AMAZON": "Amazon", "BM": "Back Market", "EBAY": "eBay", "ONBUY": "OnBuy", "TEMU": "Temu"}


def summarize(inv_path, sales_path):
    out = {}
    wb = openpyxl.load_workbook(inv_path, read_only=True, data_only=True)

    def stats(name):
        if name not in wb.sheetnames:
            return 0, 0.0, [], []
        rows = list(wb[name].iter_rows(values_only=True))
        if not rows:
            return 0, 0.0, [], []
        h = [str(x) if x is not None else "" for x in rows[0]]
        iBP = h.index("BP") if "BP" in h else None
        iM = h.index("Model") if "Model" in h else None
        iA = h.index("Age (days)") if "Age (days)" in h else None
        data = [r for r in rows[1:] if any(c is not None for c in r)]
        val = sum(float(r[iBP]) for r in data if iBP is not None and isinstance(r[iBP], (int, float)))
        models = [str(r[iM]) for r in data if iM is not None and r[iM]]
        ages = [r[iA] for r in data if iA is not None and isinstance(r[iA], (int, float))]
        return len(data), val, models, ages

    o_u, o_v, o_m, o_a = stats("Office Stock")
    s_u, s_v, _, _ = stats("SHS Stock")
    out.update(office_units=o_u, office_value=round(o_v), shs_units=s_u, shs_value=round(s_v),
               total_units=o_u + s_u, total_value=round(o_v + s_v),
               distinct_models=len(set(o_m)),
               single_unit_models=sum(1 for m in set(o_m) if o_m.count(m) == 1),
               avg_age=round(sum(o_a) / len(o_a), 1) if o_a else 0,
               max_age=max(o_a) if o_a else 0)

    rows = list(wb["Office Stock"].iter_rows(values_only=True))
    h = [str(x) if x is not None else "" for x in rows[0]]
    iBP, iA = h.index("BP"), h.index("Age (days)")
    aged = [r for r in rows[1:] if isinstance(r[iA], (int, float)) and r[iA] >= 14]
    out["aged_units"] = len(aged)
    out["aged_value"] = round(sum(float(r[iBP]) for r in aged if isinstance(r[iBP], (int, float))))

    wb2 = openpyxl.load_workbook(sales_path, read_only=True, data_only=True)
    rows = list(wb2["Returns & Profit"].iter_rows(values_only=True))
    hdr = next(i for i, r in enumerate(rows) if r and str(r[0]).strip() == "Marketplace")
    mk, tot = [], None
    for r in rows[hdr + 1:]:
        if not r or r[0] is None:
            continue
        key = str(r[0]).strip().upper()
        rec = {"name": NAMES.get(key, str(r[0]).title()), "sales": int(r[1] or 0),
               "revenue": round(float(r[2] or 0)), "gross_gp": round(float(r[3] or 0)),
               "returns": int(r[4] or 0), "carriage": round(float(r[9] or 0), 2),
               "fees_kept": round(float(r[12] or 0), 2), "net_gp": round(float(r[14] or 0)),
               "net_pct": round(float(r[15] or 0), 1)}
        if key == "TOTAL":
            tot = rec
        else:
            mk.append(rec)
    mk.sort(key=lambda x: -x["sales"])
    out["marketplaces"], out["totals"] = mk, tot

    rs = {}
    for r in wb2["Returns Summary"].iter_rows(values_only=True):
        if r and r[0] and r[1] is not None:
            rs[str(r[0]).strip()] = r[1]
    out["returns"] = {k: rs.get(k) for k in ("Total Returns", "Refunds", "Replacements", "Repairs",
                                             "Total Postage Loss £", "Avg Loss per Return £")}
    return out


if __name__ == "__main__":
    print(json.dumps(summarize(sys.argv[1], sys.argv[2]), indent=1, default=str))
