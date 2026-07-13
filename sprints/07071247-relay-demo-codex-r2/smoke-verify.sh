#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="sprints/07071247-relay-demo-codex-r2"
TMP_DIR="$(mktemp -d)"
TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"
trap 'rm -rf "$TMP_DIR"; rm -f "$TMP_CFG"' EXIT

# 清掉 Red 验证残留，避免 vitest 把临时目录一并扫进来。
find packages/brain -maxdepth 1 -type d -name 'tmp-red-*' -exec rm -rf {} +

BASELINE_STATUS="$TMP_DIR/baseline-status.log"
FINAL_STATUS="$TMP_DIR/final-status.log"
NEW_STATUS="$TMP_DIR/new-status.log"
git status --porcelain --untracked-files=all -- . ":(exclude)scripts/relay-demo" ":(exclude)$SPRINT_DIR" | sort > "$BASELINE_STATUS"

cat > "$TMP_DIR/nested.json" <<'JSON'
{"z":1,"a":{"d":4,"c":3},"items":[{"b":2,"a":1},"plain"],"empty":{}}
JSON

OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_DIR/nested.json")"
STATUS=$?
[ "$STATUS" -eq 0 ]

echo "$OUT" | jq -e '. == {"a":{"c":3,"d":4},"empty":{},"items":[{"a":1,"b":2},"plain"],"z":1}' >/dev/null

cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF

npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$SPRINT_DIR/tests/sort-json-keys.contract.test.ts" --reporter=verbose | tee "$TMP_DIR/vitest.log"
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -eq 0 ]
grep -Eq '3 passed|3 tests' "$TMP_DIR/vitest.log"

git status --porcelain --untracked-files=all -- . ":(exclude)scripts/relay-demo" ":(exclude)$SPRINT_DIR" | sort | tee "$FINAL_STATUS"
comm -13 "$BASELINE_STATUS" "$FINAL_STATUS" > "$NEW_STATUS"
test ! -s "$NEW_STATUS"
echo "OK: relay-demo sort-json-keys golden path"
