"""Email the two reports with a summary built from the workbooks.

Sends via Gmail SMTP using an app password. Google Drive upload is optional and
skipped unless GDRIVE_FOLDER_ID and GDRIVE_SA_FILE are both set.

Required env:
  GMAIL_USER          the sending Gmail address
  GMAIL_APP_PASSWORD  a Google app password (needs 2-Step Verification on)
  MAIL_TO             comma-separated recipients
Optional env:
  MAIL_FROM_NAME      display name on the From header (default "Inventory Manager")
  GDRIVE_FOLDER_ID    Drive folder to upload into
  GDRIVE_SA_FILE      path to a service-account JSON key
"""
import mimetypes
import os
import pathlib
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formataddr

from summarize import summarize

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
B = "border:1px solid #dadce0"


def money(n):
    return f"&pound;{n:,.0f}"


def build_html(s, pretty, drive_note):
    m, t, r = s["marketplaces"], s["totals"], s["returns"]
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
<p>Attached are the all-time <b>Inventory Report</b> and <b>Sales Report</b> from Inventory Manager, exported {pretty}.{drive_note}</p>
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


def upload_to_drive(paths):
    """Optional. Returns a note for the email body, or '' when skipped."""
    folder = os.environ.get("GDRIVE_FOLDER_ID")
    sa = os.environ.get("GDRIVE_SA_FILE")
    if not folder or not sa or not pathlib.Path(sa).exists():
        print("  drive: skipped (GDRIVE_FOLDER_ID / GDRIVE_SA_FILE not set)", flush=True)
        return ""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    creds = service_account.Credentials.from_service_account_file(
        sa, scopes=["https://www.googleapis.com/auth/drive.file"])
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    for p in paths:
        f = svc.files().create(
            body={"name": p.name, "parents": [folder]},
            media_body=MediaFileUpload(str(p), mimetype=XLSX, resumable=False),
            fields="id,name,size", supportsAllDrives=True).execute()
        print(f"  drive: {f['name']} ({int(f.get('size', 0)):,} bytes)", flush=True)
    return ' Both files are also saved in Google Drive under <b>Inventory Reports</b>.'


def send_email(paths, html, subject):
    user = os.environ["GMAIL_USER"]
    pwd = os.environ["GMAIL_APP_PASSWORD"].replace(" ", "")  # Google shows it in groups of 4
    to = [a.strip() for a in os.environ["MAIL_TO"].split(",") if a.strip()]

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((os.environ.get("MAIL_FROM_NAME", "Inventory Manager"), user))
    msg["To"] = ", ".join(to)
    msg.set_content("This report is formatted in HTML. Both workbooks are attached.")
    msg.add_alternative(html, subtype="html")

    for p in paths:
        ctype, _ = mimetypes.guess_type(p.name)
        maintype, _, subtype = (ctype or XLSX).partition("/")
        msg.add_attachment(p.read_bytes(), maintype=maintype, subtype=subtype, filename=p.name)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=120) as smtp:
        smtp.login(user, pwd)
        smtp.send_message(msg)
    print(f"  email sent to {', '.join(to)}", flush=True)


if __name__ == "__main__":
    inv, sales, pretty = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
    for p in (inv, sales):
        if not p.exists() or p.stat().st_size < 5_000:
            raise SystemExit(f"missing or too small: {p}")
    s = summarize(inv, sales)
    print(f"stock {s['total_units']:,} units / {s['total_value']:,} | sales {s['totals']['sales']:,} "
          f"/ net GP {s['totals']['net_gp']:,} ({s['totals']['net_pct']}%)", flush=True)
    drive_note = upload_to_drive([inv, sales])
    send_email([inv, sales], build_html(s, pretty, drive_note),
               f"Inventory & Sales Reports (All Time) — {pretty}")
