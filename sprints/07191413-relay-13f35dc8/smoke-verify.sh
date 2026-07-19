#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="sprints/07191413-relay-13f35dc8"
TMP_DIR="$(mktemp -d)"
TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"
trap 'rm -rf "$TMP_DIR"; rm -f "$TMP_CFG"' EXIT

# 清掉 Red 验证残留，避免 vitest 把临时目录一并扫进来。
find packages/brain -maxdepth 1 -type d -name 'tmp-red-*' -exec rm -rf {} +

BASELINE_STATUS="$TMP_DIR/baseline-status.log"
FINAL_STATUS="$TMP_DIR/final-status.log"
NEW_STATUS="$TMP_DIR/new-status.log"
git status --porcelain --untracked-files=all -- . ":(exclude)scripts/relay-demo" ":(exclude)$SPRINT_DIR" | sort > "$BASELINE_STATUS"

# 1. 空字符串
OUT_EMPTY="$(node scripts/relay-demo/slugify.mjs "")"
STATUS=$?
[ "$STATUS" -eq 0 ]
[ "$OUT_EMPTY" = "" ]

# 2. 含空格与标点的普通短语
OUT_PHRASE="$(node scripts/relay-demo/slugify.mjs "Hello, World!")"
STATUS=$?
[ "$STATUS" -eq 0 ]
[ "$OUT_PHRASE" = "hello-world" ]

# 3. 含连续分隔符与非 ASCII 字符
OUT_MIXED="$(node scripts/relay-demo/slugify.mjs "  Hello   世界---World  ")"
STATUS=$?
[ "$STATUS" -eq 0 ]
[ "$OUT_MIXED" = "hello-world" ]

# 4. 已存在工具未被覆盖
if ! git diff --quiet HEAD -- scripts/relay-demo/pretty-bytes.mjs scripts/relay-demo/sort-json-keys.mjs 2>/dev/null; then
  echo "FAIL: pretty-bytes.mjs / sort-json-keys.mjs 被修改，超出本 sprint 范围"
  exit 1
fi

cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF

npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$SPRINT_DIR/tests/slugify.contract.test.ts" --reporter=verbose | tee "$TMP_DIR/vitest.log"
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -eq 0 ]
grep -Eq '3 passed|3 tests' "$TMP_DIR/vitest.log"

git status --porcelain --untracked-files=all -- . ":(exclude)scripts/relay-demo" ":(exclude)$SPRINT_DIR" | sort | tee "$FINAL_STATUS"
comm -13 "$BASELINE_STATUS" "$FINAL_STATUS" > "$NEW_STATUS"
test ! -s "$NEW_STATUS"
echo "OK: relay-demo slugify golden path"
