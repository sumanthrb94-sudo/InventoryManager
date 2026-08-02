#!/usr/bin/env bash
#
# Stop hook — open-code-review in delegation mode.
#
# Fires when a turn finishes with modified source files. Emits the resolved
# rule set on stderr and exits 2, which feeds it back to Claude as a reason to
# keep working: the review gets done before the turn is handed over.
#
# Delegation mode needs NO API key. `ocr delegate rule` only resolves and
# prints the rules that apply to the changed files; the reviewing is done by
# the agent that receives them.
#
# Exit codes: 0 = nothing to review (or unavailable), 2 = review these.
#
# Loop safety: the hook records a hash of the source diff and fires at most
# once per distinct working-tree state. Reviewing without editing leaves the
# hash unchanged, so the turn ends. Fixing something changes it, so the fix
# gets reviewed too — that terminates as soon as a turn stops editing source.

set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0

# Source only. Screenshots, reports, lockfiles and build output are noise here.
PATHSPECS=(
  '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs'
  ':(exclude)node_modules/**'
  ':(exclude)dist/**'
  ':(exclude)dist-e2e/**'
  ':(exclude)e2e-screenshots/**'
)

changed=$(
  {
    git diff HEAD --name-only -- "${PATHSPECS[@]}"
    git ls-files --others --exclude-standard -- "${PATHSPECS[@]}"
  } 2>/dev/null | sort -u
)
[ -n "$changed" ] || exit 0

# Hash the actual content, not just the names — otherwise a second edit to the
# same file would look like a state we had already reviewed.
state=$(
  {
    git diff HEAD -- "${PATHSPECS[@]}"
    git status --porcelain -- "${PATHSPECS[@]}"
  } 2>/dev/null | sha1sum | cut -d' ' -f1
)

marker="$(git rev-parse --git-dir)/ocr-stop-review"
if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$state" ]; then
  exit 0
fi
printf '%s' "$state" >"$marker"

# Local binary — the devDependency, not a global install.
OCR="$ROOT/node_modules/.bin/ocr"
[ -x "$OCR" ] || exit 0

{
  echo "open-code-review · delegation mode · $(printf '%s\n' "$changed" | wc -l) changed source file(s)"
  echo
  printf '%s\n' "$changed" | sed 's/^/  - /'
  echo
  # Rules are grouped by content, so passing every file is cheap. -d '\n'
  # keeps paths with spaces intact.
  printf '%s\n' "$changed" | xargs -d '\n' -r "$OCR" delegate rule 2>/dev/null | head -c 8000
  echo
  echo "---"
  echo "Review the changed code against the rules above. Fix what is genuinely"
  echo "wrong; for anything you deliberately leave (an existing convention the"
  echo "rule would flag, say), state it and why. Then finish — this will not"
  echo "fire again unless the source changes."
} >&2

exit 2
