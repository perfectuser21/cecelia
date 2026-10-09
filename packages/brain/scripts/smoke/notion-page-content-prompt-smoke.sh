#!/usr/bin/env bash
# notion-page-content-prompt-smoke.sh — Notion 排单正文 prompt 链路烟雾测试
#
# 真 node 进程 import notion-push-sync.js 的 fetchNotionPageContent（mock notionReq
# 依赖不可行——它来自 recurring-notion-sync.js 顶层 import，故本 smoke 走纯行为面：
# 对导出的 fetchNotionPageContent 用 monkeypatch fetch 层不可靠，改为验证源码级
# 行为不变量 + base64 注入面数学性质：
#  1) fetchNotionPageContent 已导出（接线存在性）
#  2) 源码含 {PROMPT_FILE} split/join 全量替换且发生在单引号转义之前（顺序守卫）
#  3) 源码 ssh 分支含 base64 -d 写 ~/brain-runs/<run_id>.prompt 前置（prompt 送达形状）
#  4) base64 注入面：含单引号/反引号/$( ) 的正文经 Buffer.toString('base64') 后
#     字符集仅 [A-Za-z0-9+/=]（零 shell 逃逸面，数学性质每次真算一遍）
#  5) 普通排单 description 回落文案仍在（向后兼容锚）
#
# 用法：bash packages/brain/scripts/smoke/notion-page-content-prompt-smoke.sh
# CI：由 packages/quality/smoke-allowlist.txt 注册后，ci-smoke-glob-runner.yml 自动调用
#
# 退出码：0 = 全部通过，非 0 = 某项失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SRC="$REPO_ROOT/packages/brain/src/notion-push-sync.js"

echo "📝 notion-page-content-prompt-smoke：验证正文 prompt 链路不变量"

FAIL=0
ok()   { echo "  PASS: $1"; }
bad()  { echo "  FAIL: $1"; FAIL=1; }

# 1) 导出存在
grep -q "export async function fetchNotionPageContent" "$SRC" \
  && ok "fetchNotionPageContent 已导出" || bad "fetchNotionPageContent 未导出"

# 2) {PROMPT_FILE} split/join 替换，且在单引号转义之前
REPL_LINE=$(grep -n "split('{PROMPT_FILE}')" "$SRC" | head -1 | cut -d: -f1 | tr -cd '0-9')
ESC_LINE=$(grep -n "replace(/'/g" "$SRC" | head -1 | cut -d: -f1 | tr -cd '0-9')
REPL_LINE="${REPL_LINE:-0}"
ESC_LINE="${ESC_LINE:-0}"
if [[ "$REPL_LINE" -gt 0 && "$ESC_LINE" -gt 0 && "$REPL_LINE" -lt "$ESC_LINE" ]]; then
  ok "{PROMPT_FILE} split/join 替换在单引号转义之前（${REPL_LINE} < ${ESC_LINE}）"
else
  bad "{PROMPT_FILE} 替换/转义顺序不满足（repl=${REPL_LINE} esc=${ESC_LINE}）"
fi

# 3) base64 prompt 文件送达形状
grep -q "base64 -d > \${promptFile}" "$SRC" \
  && ok "ssh 分支含 base64 写 prompt 文件" || bad "ssh 分支缺 base64 prompt 写入"

# 4) base64 注入面数学性质（真算）
node --input-type=module <<'NODE_EOF'
const evil = `恶意'内容\`rm -rf\` $(whoami) "双引" \\反斜杠\n多行`;
const b64 = Buffer.from(evil, 'utf8').toString('base64');
if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
  console.error('  FAIL: base64 输出含意外字符'); process.exit(1);
}
const roundtrip = Buffer.from(b64, 'base64').toString('utf8');
if (roundtrip !== evil) {
  console.error('  FAIL: base64 round-trip 不一致'); process.exit(1);
}
console.log('  PASS: base64 注入面为零（字符集纯净 + round-trip 一致）');
NODE_EOF
[[ $? -eq 0 ]] || FAIL=1

# 5) 向后兼容锚：普通排单回落文案仍在
grep -q "来自 Notion Tasks 编排（主理人排单）" "$SRC" \
  && ok "普通排单回落文案在位" || bad "回落文案丢失"

if [[ "$FAIL" -eq 0 ]]; then
  echo "✅ notion-page-content-prompt-smoke 全部通过"
else
  echo "❌ notion-page-content-prompt-smoke 有失败项"
  exit 1
fi
