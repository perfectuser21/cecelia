#!/usr/bin/env bash
# 单一事实源：Golden Path Step 4 验证命令（见 verify/step1.sh 顶部说明）。
# 需从 repo root 执行（相对路径 scripts/relay-demo/slugify.mjs 与
# sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts）。
OUT="$(node scripts/relay-demo/slugify.mjs "  Hello   世界---World  ")"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "hello-world"

TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF

npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts --reporter=verbose | tee /tmp/slugify-vitest.log
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -eq 0 ]
grep -Eq '3 passed|3 tests' /tmp/slugify-vitest.log
rm -rf "$TMP_CFG_DIR"
