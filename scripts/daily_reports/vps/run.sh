#!/usr/bin/env bash
# Nightly: download both reports, push to Drive, email them.
set -euo pipefail

APP_DIR=/opt/reports
cd "$APP_DIR"

set -a; . "$APP_DIR/.env"; set +a
export OUT_DIR="$APP_DIR/out"

DATE=$(date -u +%F)
PRETTY=$(date -u '+%d %b %Y')

fail() {
  echo "[$(date -u +%FT%TZ)] FAILED"
  [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL}/fail" >/dev/null || true
  exit 1
}
trap fail ERR

echo "[$(date -u +%FT%TZ)] start"
"$APP_DIR/.venv/bin/python" fetch_reports.py "$DATE"
"$APP_DIR/.venv/bin/python" deliver.py \
  "$OUT_DIR/Inventory-Report-All-Time-$DATE.xlsx" \
  "$OUT_DIR/Sales-Report-All-Time-$DATE.xlsx" \
  "$PRETTY"

# keep a fortnight of local copies, drop the rest
find "$OUT_DIR" -name '*.xlsx' -mtime +14 -delete 2>/dev/null || true

[ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" >/dev/null || true
echo "[$(date -u +%FT%TZ)] done"
