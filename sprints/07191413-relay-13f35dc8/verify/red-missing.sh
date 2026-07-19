#!/usr/bin/env bash
# 单一事实源：Red 前提「未实现状态」验证命令。
# contract-draft.md「Red 前提」段与 contract-dod.md 对应 [BEHAVIOR] 条目均只引用本文件
# （`bash sprints/07191413-relay-13f35dc8/verify/red-missing.sh`），不再各自逐字粘贴一份
# （GAN Round 1 问题 1：internal_consistency 6 分的根因）。
# 需从 repo root 执行。
#
# 风险登记（见 contract-draft.md ## Risks R1）：本脚本在
# packages/brain/tmp-red-missing.XXXXXX 下创建临时目录，仅靠 trap EXIT 清理；
# 若进程被 SIGKILL/宿主机异常中断会残留。双重防线：
#   ① 根 .gitignore 已收录 `tmp-red-*` 模式（静态防线，残留不会被 git 追踪/误 add）；
#   ② smoke-verify.sh 开头已 `find packages/brain -maxdepth 1 -type d -name 'tmp-red-*' -exec rm -rf {} +`
#      做启动时清理（动态防线）。
TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-missing.XXXXXX")"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
trap 'rm -rf "$TMP_REPO" "$TMP_CFG_DIR"' EXIT
mkdir -p "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests"
cp sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/"
REL_TEST="$(node --input-type=module -e 'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));' "$PWD/packages/brain" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts")"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-missing.log"
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -ne 0 ]
grep -Eq '空字符串输入返回空字符串|普通短语转换为小写连字符 slug|连续分隔符与非 ASCII 字符折叠为单个连字符|ENOENT|AssertionError|expected' "$TMP_REPO/red-missing.log"
