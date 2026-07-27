#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="sprints/07272334-kernel-aeaf5c78"
BEHAVIOR="${1:-}"
MODE="${2:-}"
case "$BEHAVIOR" in B1|B2|B3|B4|B5) ;; *) echo "usage: $0 B1..B5 red|green|mutate|restore" >&2; exit 64;; esac
case "$MODE" in red|green|mutate|restore) ;; *) echo "usage: $0 B1..B5 red|green|mutate|restore" >&2; exit 64;; esac

node "$SPRINT_DIR/tests/dependency-proof.mjs"
node "$SPRINT_DIR/tests/pg-preflight.mjs"

REAL_TEST="packages/brain/src/__tests__/harness-kernel-feedback-lineage.real.test.js"
LOG="$(mktemp)"
cleanup() { rm -f "$LOG"; }
trap cleanup EXIT

patch_for() { printf '%s/tests/counterfactuals/%s.patch' "$SPRINT_DIR" "$BEHAVIOR"; }

if [[ "$MODE" == "restore" ]]; then
  if [[ "$BEHAVIOR" == "B3" || "$BEHAVIOR" == "B5" ]]; then
    COUNTERFACTUAL_MUTATION="$BEHAVIOR" COUNTERFACTUAL_ACTION=restore \
      npx vitest run "$REAL_TEST" -t "\\[$BEHAVIOR\\]" --reporter=verbose
  else
    git apply -R --check "$(patch_for)"
    git apply -R "$(patch_for)"
  fi
  echo "RESTORED:$BEHAVIOR"
  exit 0
fi

if [[ "$MODE" == "mutate" && "$BEHAVIOR" != "B3" && "$BEHAVIOR" != "B5" ]]; then
  git apply --check "$(patch_for)"
  git apply "$(patch_for)"
fi

set +e
COUNTERFACTUAL_MUTATION="$([[ "$MODE" == "mutate" ]] && printf '%s' "$BEHAVIOR")" \
  COUNTERFACTUAL_ACTION="$MODE" \
  npx vitest run "$REAL_TEST" -t "\\[$BEHAVIOR\\]" --reporter=verbose 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
set -e

if grep -Eqi 'Cannot find module|No test files found|vitest.*config|config(uration)? error|import error|FAKE_RED|ECONNREFUSED|ENOTFOUND|database .*does not exist' "$LOG"; then
  echo "FAKE_RED:$BEHAVIOR:infrastructure_or_import_failure" >&2
  exit 70
fi

case "$MODE" in
  red)
    [[ "$STATUS" -ne 0 ]] || { echo "FAKE_RED:$BEHAVIOR:unexpected_green" >&2; exit 71; }
    grep -F "BUSINESS_RED:$BEHAVIOR:" "$LOG" >/dev/null
    echo "VALID_RED:$BEHAVIOR"
    ;;
  green)
    [[ "$STATUS" -eq 0 ]] || exit "$STATUS"
    grep -F "[$BEHAVIOR]" "$LOG" >/dev/null
    echo "GREEN:$BEHAVIOR"
    ;;
  mutate)
    [[ "$STATUS" -ne 0 ]] || { echo "FAKE_RED:$BEHAVIOR:counterfactual_survived" >&2; exit 72; }
    grep -F "COUNTERFACTUAL:$BEHAVIOR:" "$LOG" >/dev/null
    echo "MUTATION_CAUGHT:$BEHAVIOR"
    ;;
esac
