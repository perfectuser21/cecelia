#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="sprints/07081030-headed-r7"
WORKSPACE_TEST_FILE="$SPRINT_DIR/tests/pretty-bytes.contract.test.ts"
TMP_DIR="$(mktemp -d)"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
trap 'rm -rf "$TMP_DIR" "$TMP_CFG_DIR"' EXIT

find packages/brain -maxdepth 1 -type d -name 'tmp-red-*' -exec rm -rf {} +

BASELINE_STATUS="$TMP_DIR/baseline-status.log"
FINAL_STATUS="$TMP_DIR/final-status.log"
NEW_STATUS="$TMP_DIR/new-status.log"
git status --porcelain --untracked-files=all -- . ":(exclude)scripts/relay-demo" ":(exclude)$SPRINT_DIR" | sort > "$BASELINE_STATUS"

test "$(node scripts/relay-demo/pretty-bytes.mjs 0)" = "0 B"
test "$(node scripts/relay-demo/pretty-bytes.mjs 1024)" = "1 KB"
test "$(node scripts/relay-demo/pretty-bytes.mjs 1099511627776)" = "1 TB"

cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF

npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$WORKSPACE_TEST_FILE" --reporter=verbose | tee "$TMP_DIR/vitest.log"
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -eq 0 ]
grep -Eq '3 passed|3 tests' "$TMP_DIR/vitest.log"

git status --porcelain --untracked-files=all -- . ":(exclude)scripts/relay-demo" ":(exclude)$SPRINT_DIR" | sort | tee "$FINAL_STATUS"
comm -13 "$BASELINE_STATUS" "$FINAL_STATUS" > "$NEW_STATUS"
test ! -s "$NEW_STATUS"
echo "OK: relay-demo pretty-bytes golden path"
