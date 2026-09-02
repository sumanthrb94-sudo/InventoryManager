#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu VPS (works on both arm64 and x86_64).
set -euo pipefail

APP_DIR=/opt/reports
REPO="${1:-https://github.com/sumanthrb94-sudo/InventoryManager.git}"

echo "==> packages"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-pip git

echo "==> $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"

tmp=$(mktemp -d)
git clone --depth 1 "$REPO" "$tmp/repo"
cp "$tmp/repo"/scripts/daily_reports/*.py "$tmp/repo"/scripts/daily_reports/requirements.txt "$APP_DIR"/
cp "$tmp/repo"/scripts/daily_reports/vps/run.sh "$APP_DIR"/
cp -n "$tmp/repo"/scripts/daily_reports/vps/.env.example "$APP_DIR"/.env.example
rm -rf "$tmp"
chmod +x "$APP_DIR/run.sh"

echo "==> python env (this pulls a browser, give it a few minutes)"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"
"$APP_DIR/.venv/bin/python" -m playwright install --with-deps chromium

mkdir -p "$APP_DIR/out"
[ -f "$APP_DIR/.env" ] || cp "$APP_DIR/.env.example" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

cat <<'MSG'

Setup done. Three things left:

  1. Create /opt/reports/.env from vps/.env.example and fill it in:
       nano /opt/reports/.env && chmod 600 /opt/reports/.env
  2. Put the Google service-account JSON at /opt/reports/sa.json:
       nano /opt/reports/sa.json && chmod 600 /opt/reports/sa.json
     ...and share the target Drive folder with that service account's email as Editor.
  3. Test it once by hand, then schedule it:
       /opt/reports/run.sh
       ( crontab -l 2>/dev/null; echo 'MAILTO=""'; \
         echo '30 23 * * * /opt/reports/run.sh >> /var/log/reports.log 2>&1' ) | crontab -

Cron uses the server clock. Check it is UTC with `timedatectl`; if not:
  sudo timedatectl set-timezone UTC
MSG
