#!/usr/bin/env bash
# Exercise the real scanner against an isolated workspace, including negative cases.
set -euo pipefail
# Keep byte-oriented scanner output stable across macOS and Linux locales.
export LC_ALL=C
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PRIVATE=$(mktemp -d)
FIXTURE="$PRIVATE/workspace"
trap 'rm -rf "$PRIVATE"' EXIT
mkdir -p "$FIXTURE/packages/engine/tests/integrity" "$FIXTURE/.skills-source/history" "$FIXTURE/scripts"
cp "$REPO_ROOT/packages/engine/tests/integrity/doc-zombie-retired.test.sh" "$FIXTURE/packages/engine/tests/integrity/"
SCANNER="$FIXTURE/packages/engine/tests/integrity/doc-zombie-retired.test.sh"
RETIRED="write-current""-state.sh"
printf '%s\n' "$RETIRED" > "$FIXTURE/.skills-source/history/cleanup.sh"
if ! "$BASH" "$SCANNER" > "$PRIVATE/cache.log"; then
  cat "$PRIVATE/cache.log"
  echo 'FAIL: dependency cache must not be scanned as workspace code'
  exit 1
fi
printf '%s\n' "$RETIRED" > "$FIXTURE/scripts/business.sh"
if "$BASH" "$SCANNER" > "$PRIVATE/business.log"; then
  echo 'FAIL: a retired reference in business code must remain blocked'
  exit 1
fi
grep -qF 'scripts/business.sh' "$PRIVATE/business.log"
# A similarly named business directory must not inherit the cache exception.
rm "$FIXTURE/scripts/business.sh"
mkdir "$FIXTURE/skills-source"
printf '%s\n' "$RETIRED" > "$FIXTURE/skills-source/business.sh"
if "$BASH" "$SCANNER" > "$PRIVATE/neighbor.log"; then
  echo 'FAIL: only the exact dependency cache directory may be excluded'
  exit 1
fi
grep -qF 'skills-source/business.sh' "$PRIVATE/neighbor.log"
echo 'PASS: cache excluded; real workspace and neighboring directory references blocked'
