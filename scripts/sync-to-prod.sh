#!/usr/bin/env bash
# One-shot dev -> prod sync for the Microtubule Resonance Simulator.
#
# Copies the simulator's runtime files from THIS source repo
# (coherence-lab/sims/microtubule-resonance, repo benskamps/microtubule-resonance-sim)
# into the live website tree (brokenbranchdevwebsite/lab/microtubule).
#
# The CI workflow (.github/workflows/mirror-to-prod.yml) does this automatically
# on push to main. This script is the manual / offline equivalent and the
# break-glass tool when you want to preview or force a sync by hand.
#
# HEAD PRESERVATION
# -----------------
# The website pages carry a prod SEO <head> (canonical, OG, Twitter, JSON-LD,
# favicon). As of 2026-06-18 that head was folded back INTO this repo's HTML, so
# source is now authoritative for the head -- a verbatim copy is safe.
#
# As a safety net, if --reinject-head is passed, HTML files are written by
# splicing PROD's current <head> onto SOURCE's <body> (scripts/splice_head.py),
# so even if a source edit stripped the SEO head, prod's head survives.
#
# SAFETY: dry-run by default; nothing is written until --apply. Touches only the
# local prod working tree -- never commits or pushes. The website repo is a live
# production site: review, commit, and deploy through its own workflow.
#
# Usage:
#   scripts/sync-to-prod.sh                    # dry run
#   scripts/sync-to-prod.sh --apply            # copy for real
#   scripts/sync-to-prod.sh --apply --reinject-head   # keep prod head via splice
#   scripts/sync-to-prod.sh --prod <path>      # override destination
set -euo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_ROOT="$(cd "$SRC_ROOT/../../../brokenbranchdevwebsite/lab/microtubule" 2>/dev/null && pwd || true)"
APPLY=0; REINJECT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --reinject-head) REINJECT=1 ;;
    --prod) shift; PROD_ROOT="$1" ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "${PROD_ROOT:-}" ] || [ ! -d "$PROD_ROOT" ]; then
  echo "Prod tree not found. Pass --prod <path> to the website's lab/microtubule dir." >&2
  exit 1
fi

HTML_FILES=(index.html simulator.html whitepaper.html)
ASSET_FILES=(landing.css style.css whitepaper.css sim.js physics.js)

# SAME | DIFF | NEW | MISSING-SRC, ignoring CRLF/LF.
cmp_state() {
  local s="$SRC_ROOT/$1" d="$PROD_ROOT/$1"
  [ -f "$s" ] || { echo "MISSING-SRC"; return; }
  [ -f "$d" ] || { echo "NEW"; return; }
  if diff -q <(tr -d '\r' < "$s") <(tr -d '\r' < "$d") >/dev/null 2>&1; then echo "SAME"; else echo "DIFF"; fi
}

echo "Microtubule dev -> prod sync"
echo "  source: $SRC_ROOT"
echo "  prod  : $PROD_ROOT"
echo "  mode  : $([ $APPLY -eq 1 ] && echo APPLY || echo DRY-RUN)$([ $REINJECT -eq 1 ] && echo ' +reinject-head')"
echo ""

copied=0

echo "HTML pages:"
for f in "${HTML_FILES[@]}"; do
  st="$(cmp_state "$f")"
  case "$st" in
    SAME) echo "  [same] $f" ;;
    NEW)  echo "  [new ] $f -> will create" ;;
    DIFF) echo "  [diff] $f -> will update" ;;
    MISSING-SRC) echo "  [!!  ] $f missing in source -- skipping" ;;
  esac
  if [ $APPLY -eq 1 ] && { [ "$st" = NEW ] || [ "$st" = DIFF ]; }; then
    if [ $REINJECT -eq 1 ] && [ -f "$PROD_ROOT/$f" ]; then
      python "$SRC_ROOT/scripts/splice_head.py" "$SRC_ROOT/$f" "$PROD_ROOT/$f" > "$PROD_ROOT/$f.tmp" \
        && mv "$PROD_ROOT/$f.tmp" "$PROD_ROOT/$f"
    else
      cp -f "$SRC_ROOT/$f" "$PROD_ROOT/$f"
    fi
    copied=$((copied+1))
  fi
done

echo ""
echo "CSS + JS payload:"
for f in "${ASSET_FILES[@]}"; do
  st="$(cmp_state "$f")"
  case "$st" in
    SAME) echo "  [same] $f" ;;
    NEW)  echo "  [new ] $f -> will create" ;;
    DIFF) echo "  [diff] $f -> will update" ;;
    MISSING-SRC) echo "  [!!  ] $f missing in source -- skipping" ;;
  esac
  if [ $APPLY -eq 1 ] && { [ "$st" = NEW ] || [ "$st" = DIFF ]; }; then
    cp -f "$SRC_ROOT/$f" "$PROD_ROOT/$f"; copied=$((copied+1))
  fi
done

echo ""
if [ $APPLY -eq 1 ]; then
  echo "Done. $copied file(s) written to prod working tree."
  echo "NEXT: review with 'git status' / 'git diff' IN THE WEBSITE REPO, then commit + deploy there."
else
  echo "Dry run -- nothing written. Re-run with --apply to copy."
fi
