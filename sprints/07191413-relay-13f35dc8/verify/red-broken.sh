#!/usr/bin/env bash
# 单一事实源：Red 前提「错误实现状态」验证命令（见 verify/red-missing.sh 顶部说明，
# 同一防线适用：smoke-verify.sh 启动时清理；根 .gitignore 尚未收录 `tmp-red-*` 模式，
# 本轮不实施，仅登记为后续 sprint 改进建议，详见 contract-draft.md ## Risks R1）。
# 需从 repo root 执行。
TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-broken.XXXXXX")"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
trap 'rm -rf "$TMP_REPO" "$TMP_CFG_DIR"' EXIT
mkdir -p "$TMP_REPO/scripts/relay-demo" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests"
cp sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/"
cat > "$TMP_REPO/scripts/relay-demo/slugify.mjs" <<'EOF'
process.stdout.write(`${(process.argv[2] ?? '').toLowerCase()}\n`);
EOF
REL_TEST="$(node --input-type=module -e 'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));' "$PWD/packages/brain" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts")"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-broken.log"
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -ne 0 ]
grep -Eq '普通短语转换为小写连字符 slug|连续分隔符与非 ASCII 字符折叠为单个连字符|AssertionError|expected|to be' "$TMP_REPO/red-broken.log"
