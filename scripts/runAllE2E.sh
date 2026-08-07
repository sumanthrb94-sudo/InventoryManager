#!/usr/bin/env bash
# Run every E2E script in turn and record a one-line verdict for each.
#
# Written because there are 48 of them and a foreground shell cannot hold the
# whole run. Each script gets its own timeout so one hang cannot eat the sweep,
# and its full output is kept so a failure can be diagnosed without re-running.
#
#   bash scripts/runAllE2E.sh            # all of them
#   bash scripts/runAllE2E.sh e2eVat     # only matching names
#
# Results: /tmp/e2e-results.txt   Per-script logs: /tmp/e2e-logs/
set -u

FILTER="${1:-}"
OUT=/tmp/e2e-results.txt
LOGS=/tmp/e2e-logs
PER_SCRIPT_TIMEOUT=900

mkdir -p "$LOGS"
: > "$OUT"

scripts=$(ls scripts/e2e*.mjs | sed 's|scripts/||; s|\.mjs$||' | sort)
[ -n "$FILTER" ] && scripts=$(echo "$scripts" | grep -i "$FILTER")

total=$(echo "$scripts" | wc -l | tr -d ' ')
i=0

for s in $scripts; do
  i=$((i + 1))
  printf '[%2d/%d] %-42s' "$i" "$total" "$s"
  start=$(date +%s)
  timeout "$PER_SCRIPT_TIMEOUT" node "scripts/$s.mjs" > "$LOGS/$s.log" 2>&1
  code=$?
  secs=$(( $(date +%s) - start ))

  # Scripts report in several shapes; count explicit FAIL lines, and treat a
  # non-zero exit with no FAIL lines as a crash rather than a test failure.
  fails=$(grep -ciE '^ *FAIL' "$LOGS/$s.log")
  passes=$(grep -ciE '^ *PASS' "$LOGS/$s.log")

  if [ "$code" -eq 124 ]; then
    verdict="TIMEOUT after ${PER_SCRIPT_TIMEOUT}s"
  elif [ "$fails" -gt 0 ]; then
    verdict="$fails FAILED / $((passes + fails)) checks"
  elif [ "$code" -ne 0 ]; then
    verdict="CRASHED exit=$code (no FAIL lines — see log)"
  elif [ "$passes" -gt 0 ]; then
    verdict="ok — $passes checks"
  else
    verdict="ok — no check lines emitted"
  fi

  printf '%s  (%ss)\n' "$verdict" "$secs"
  printf '%-42s %s (%ss)\n' "$s" "$verdict" "$secs" >> "$OUT"
done

echo
echo "=================== SUMMARY ==================="
grep -cE 'ok — ' "$OUT" | sed 's/^/  clean:    /'
grep -cE 'FAILED'  "$OUT" | sed 's/^/  failing:  /'
grep -cE 'CRASHED' "$OUT" | sed 's/^/  crashed:  /'
grep -cE 'TIMEOUT' "$OUT" | sed 's/^/  timeout:  /'
echo
echo "Anything not clean:"
grep -E 'FAILED|CRASHED|TIMEOUT' "$OUT" || echo "  (nothing)"
