"""Upload both reports to Google Drive and email them with a summary."""
import base64, os, pathlib, sys, requests
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from summarize import summarize

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
B = "border:1px solid #dadce0"


def money(n):
    return f"&pound;{n:,.0f}"


def build_html(s, pretty):
    m = s["marketplaces"]
    t = s["totals"]
    r = s["returns"]
    rows = "".join(
        f'<tr><td style="{B}">{x["name"]}</td>'
        f'<td style="{B}" align="right">{x["sales"]:,}</td>'
        f'<td style="{B}" align="right">{money(x["revenue"])}</td>'
        f'<td style="{B}" align="right">{money(x["net_gp"])}</td>'
        f'<td style="{B}" align="right">{x["net_pct"]}%</td></tr>' for x in m)
    weakest = min(m, key=lambda x: x["net_pct"]) if m else None
    others = [x["net_pct"] for x in m if weakest and x is not weakest]
    note = ""
    if weakest and others and weakest["net_pct"] < min(others) * 0.75:
        note = (f'<p style="font-size:13px;color:#5f6368;margin:6px 0 0">{weakest["name"]} is the outlier at '
                f'{weakest["net_pct"]}% net &mdash; well below every other channel, on {weakest["sales"]:,} sales.</p>')
    per_mk = ", ".join(f'{x["name"]} {x["returns"]}' for x in m if x["returns"])
    return f"""<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#202124;line-height:1.5">
<p>Hi,</p>
<p>Attached are the all-time <b>Inventory Report</b> and <b>Sales Report</b> from Inventory Manager, exported {pretty}. Headline numbers below; both files are also saved in Google Drive under <b>Inventory Reports</b>.</p>
<p style="margin:18px 0 6px"><b>Stock on hand</b></p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
<tr><td style="{B}">Office stock</td><td style="{B}" align="right">{s['office_units']:,} units</td><td style="{B}" align="right">{money(s['office_value'])}</td></tr>
<tr><td style="{B}">SHS stock</td><td style="{B}" align="right">{s['shs_units']:,} units</td><td style="{B}" align="right">{money(s['shs_value'])}</td></tr>
<tr><td style="{B}"><b>Total</b></td><td style="{B}" align="right"><b>{s['total_units']:,} units</b></td><td style="{B}" align="right"><b>{money(s['total_value'])}</b></td></tr>
</table>
<p style="font-size:13px;color:#5f6368;margin:6px 0 0">{s['distinct_models']} distinct models in office &middot; average age {s['avg_age']} days, oldest {s['max_age']} &middot; <b>{s['aged_units']:,} units ({money(s['aged_value'])}) held 14 days or longer</b> &middot; {s['single_unit_models']} models down to their last unit.</p>
<p style="margin:18px 0 6px"><b>Sales &mdash; all time</b></p>
<p style="margin:0 0 8px">{t['sales']:,} sales &middot; <b>{money(t['revenue'])}</b> revenue &middot; {money(t['gross_gp'])} gross GP &middot; <b>{money(t['net_gp'])} net GP ({t['net_pct']}%)</b></p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
<tr style="background:#f1f3f4"><th style="{B}" align="left">Marketplace</th><th style="{B}" align="right">Sales</th><th style="{B}" align="right">Revenue</th><th style="{B}" align="right">Net GP</th><th style="{B}" align="right">Net GP %</th></tr>
{rows}</table>{note}
<p style="margin:18px 0 6px"><b>Returns</b></p>
<p style="margin:0">{r['Total Returns']} returns all time &mdash; {r['Refunds']} refunds, {r['Replacements']} replacements, {r['Repairs']} repairs. {money(t['carriage'] + t['fees_kept'])} total return cost ({money(t['carriage'])} carriage, {money(t['fees_kept'])} fees kept), averaging &pound;{r['Avg Loss per Return £']} per return.{(' ' + per_mk + '.') if per_mk else ''}</p>
<p style="margin:20px 0 4px">Full detail is in the attached workbooks &mdash; the sales file breaks out every unit by marketplace, plus returns and unit histories.</p>
<p style="margin:0">Thanks</p>
</div>"""


def upload_to_drive(paths, folder_id, sa_file):
    creds = service_account.Credentials.from_service_account_file(
        sa_file, scopes=["https://www.googleapis.com/auth/drive.file"])
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    links = []
    for p in paths:
        f = svc.files().create(
            body={"name": p.name, "parents": [folder_id]},
            media_body=MediaFileUpload(str(p), mimetype=XLSX, resumable=False),
            fields="id,name,size,webViewLink", supportsAllDrives=True).execute()
        print(f"  drive: {f['name']} ({int(f.get('size', 0)):,} bytes)", flush=True)
        links.append(f)
    return links


def send_email(paths, html, subject):
    atts = [{"filename": p.name, "content": base64.b64encode(p.read_bytes()).decode()} for p in paths]
    resp = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
        json={"from": os.environ["MAIL_FROM"],
              "to": [a.strip() for a in os.environ["MAIL_TO"].split(",") if a.strip()],
              "subject": subject, "html": html, "attachments": atts},
        timeout=120)
    if resp.status_code >= 300:
        raise SystemExit(f"Resend failed {resp.status_code}: {resp.text[:500]}")
    print(f"  email sent: {resp.json().get('id')}", flush=True)


if __name__ == "__main__":
    inv, sales, pretty = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
    for p in (inv, sales):
        if not p.exists() or p.stat().st_size < 5_000:
            raise SystemExit(f"missing or too small: {p}")
    s = summarize(inv, sales)
    print(f"stock {s['total_units']:,} units / {s['total_value']:,} | sales {s['totals']['sales']:,} "
          f"/ net GP {s['totals']['net_gp']:,} ({s['totals']['net_pct']}%)", flush=True)
    upload_to_drive([inv, sales], os.environ["GDRIVE_FOLDER_ID"], os.environ["GDRIVE_SA_FILE"])
    send_email([inv, sales], build_html(s, pretty), f"Inventory & Sales Reports (All Time) — {pretty}")
