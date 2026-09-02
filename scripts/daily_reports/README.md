# Daily inventory & sales reports

Runs every day at **23:30 UTC** via GitHub Actions. Headless Chromium signs into the
Inventory Manager app, downloads the all-time Inventory Report and Sales Report,
uploads both to Google Drive, and emails them with a summary. Needs no local machine.

Trigger a test run any time: **Actions → Daily inventory & sales reports → Run workflow**.

## Files

| File | Purpose |
| --- | --- |
| `fetch_reports.py` | Drives the real app UI and captures both `.xlsx` downloads. |
| `summarize.py` | Derives the headline figures from the two workbooks. |
| `deliver.py` | Uploads to Drive, builds the HTML email, sends via Resend. |
| `../../.github/workflows/daily-reports.yml` | Schedule and wiring. |

## One-time setup

### 1. Google Drive service account
1. Google Cloud console → new (or existing) project → **Enable the Google Drive API**.
2. **IAM & Admin → Service Accounts → Create**. No roles needed.
3. On the account → **Keys → Add key → JSON**. Download it.
4. Open the Drive folder you want files in, **Share** it with the service account's
   `...@....iam.gserviceaccount.com` address as **Editor**. This step is essential —
   a service account has no access to your Drive otherwise.
5. Note the folder ID from its URL: `drive.google.com/drive/folders/<FOLDER_ID>`.

### 2. Resend
1. Add and verify your domain (DNS records) at resend.com → Domains.
2. Create an API key with send permission.
3. Free tier is 100 emails/day, 3,000/month — this job uses one.

### 3. Repository secrets
**Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value |
| --- | --- |
| `IM_EMAIL` | Inventory Manager login email |
| `IM_PASSWORD` | Inventory Manager password |
| `GDRIVE_SA_JSON` | Entire contents of the service-account JSON key |
| `GDRIVE_FOLDER_ID` | Target Drive folder ID |
| `RESEND_API_KEY` | Resend API key |
| `MAIL_FROM` | e.g. `Inventory Manager <reports@yourdomain.com>` (must be a verified domain) |
| `MAIL_TO` | Comma-separated recipients |

Optionally set repository **variable** `IM_BASE_URL` to point at a different deployment.

## Notes and gotchas

- **Use a dedicated login.** Give this job its own read-only Inventory Manager account
  rather than a personal admin one, so the password in secrets is low-value and the
  activity is attributable.
- GitHub disables scheduled workflows after **60 days without repository activity**.
  Any commit resets the clock.
- Scheduled runs can start late during GitHub's peak load. If the exact minute matters,
  a paid scheduler hitting `workflow_dispatch` is more precise.
- On failure the run uploads `out/` (including a screenshot and page text at the point of
  failure) as an artifact, kept 5 days. Nothing is uploaded on success.
- If the app's report buttons are renamed, `fetch_reports.py` is where to adjust the
  selectors — they match on visible button text.
- Free-tier Actions minutes: 2,000/month on private repos. This run costs ~2-3 minutes.

---

## Running it on your own VPS instead

Same three Python scripts — GitHub Actions and a VPS are just two places to run them.
Files live in `vps/`. Tested shape: fresh Ubuntu 22.04/24.04, arm64 or x86_64.

```bash
# on the server
curl -fsSL https://raw.githubusercontent.com/sumanthrb94-sudo/InventoryManager/main/scripts/daily_reports/vps/setup.sh | bash
nano /opt/reports/.env      # fill in, then chmod 600
nano /opt/reports/sa.json   # service-account key, then chmod 600
/opt/reports/run.sh         # test once by hand

( crontab -l 2>/dev/null; echo 'MAILTO=""'; \
  echo '30 23 * * * /opt/reports/run.sh >> /var/log/reports.log 2>&1' ) | crontab -
```

Notes:

- **No inbound ports are needed.** This job only makes outbound connections, so leave the
  firewall closed. Don't open anything for it.
- Cron follows the server clock. `timedatectl` to check; `sudo timedatectl set-timezone UTC`
  to match the `30 23 * * *` schedule to 11:30 PM GMT.
- **Set `HEALTHCHECK_URL`** to a free healthchecks.io check. A cron job that quietly stops
  running is the classic failure mode — nothing tells you, you just stop getting emails.
- Chromium and its libraries take ~500 MB; the job needs roughly 1 GB RAM while running.
  Any 2-core / 4 GB box is far more than enough.
- Keep `.env` and `sa.json` at `chmod 600`, and prefer a dedicated read-only app login over
  a personal admin account.

### Don't run both

If the GitHub Actions workflow and the VPS cron are both live you'll get two emails a night
and two copies in Drive. Pick one: disable the workflow (Actions tab → ⋯ → Disable workflow)
or remove the crontab line.
