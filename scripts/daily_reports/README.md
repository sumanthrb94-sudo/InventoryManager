# Daily inventory & sales reports

Runs every day at **23:59 UTC** via GitHub Actions. Headless Chromium signs into the
Inventory Manager app, downloads the all-time Inventory Report and Sales Report, and
emails both as attachments with a summary built from the workbooks. Needs no local
machine and no Google Cloud setup.

Trigger a test run any time: **Actions → Daily inventory & sales reports → Run workflow**.

## Files

| File | Purpose |
| --- | --- |
| `fetch_reports.py` | Drives the real app UI and captures both `.xlsx` downloads. |
| `summarize.py` | Derives the headline figures from the two workbooks. |
| `deliver.py` | Builds the HTML email and sends it via Gmail SMTP. Drive upload optional. |
| `vps/` | Same job as a cron entry on a VPS, if you ever move off Actions. |
| `../../.github/workflows/daily-reports.yml` | Schedule and wiring. |

## Setup

### 1. Gmail app password
1. The sending Google account needs **2-Step Verification** turned on.
2. Google Account → Security → **App passwords** → create one (any name).
3. Copy the 16-character password. Spaces are stripped automatically, so paste it either way.

Google treats app passwords as a legacy fallback. If one ever stops working, switch
`send_email()` in `deliver.py` to an email API (Resend, Postmark, SES) — it is a single
function and the rest of the script is unaffected.

### 2. Repository secrets
**Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value |
| --- | --- |
| `IM_EMAIL` | Inventory Manager login email |
| `IM_PASSWORD` | Inventory Manager password |
| `GMAIL_USER` | the Gmail address that sends the report |
| `GMAIL_APP_PASSWORD` | the app password from step 1 |
| `MAIL_TO` | comma-separated recipients |

Optionally set repository **variable** `IM_BASE_URL` to point at a different deployment.

## Notes and gotchas

- **Use a dedicated login.** Give this job its own read-only Inventory Manager account
  rather than a personal admin one, so the password in secrets is low-value.
- **This repo is public.** Secrets are encrypted and never exposed in logs or to forks,
  but never hard-code a credential into these scripts — they only read env vars, keep it
  that way.
- GitHub queues scheduled runs and the minutes around the top of the hour are the busiest
  on the platform, so a `59` job often starts 5-20 minutes late. Move the cron to a
  quieter minute (e.g. `47 23 * * *`) if the exact time matters.
- GitHub disables scheduled workflows after **60 days without repository activity**.
  Any commit resets the clock.
- Actions minutes are **free and unlimited on public repos**; the 2,000/month figure
  applies to private repos. This job uses roughly 3 minutes per run.
- On failure the run uploads `out/` (including a screenshot and the page text at the point
  of failure) as an artifact, kept 5 days. Nothing is uploaded on success.
- If the app's report buttons are renamed, `fetch_reports.py` is where to adjust the
  selectors — they match on visible button text.

### Optional: Google Drive copy

`deliver.py` will also upload both files to Drive if you set `GDRIVE_FOLDER_ID` and
`GDRIVE_SA_FILE` (a service-account JSON key). Uncomment the two Google libraries in
`requirements.txt`, and share the target Drive folder with the service account's
`...@....iam.gserviceaccount.com` address as **Editor** — without that share it cannot
see the folder. Left off by default: the email itself is a permanent, searchable archive
in every recipient's mailbox.
