#!/usr/bin/env bash
# smoke-forensics-no-overwrite.sh — 取证文件防覆盖真环境验证
# 验证 writePromptFile 生成含实例标识的文件名（非旧固定格式），
# 两次写入同一 taskId 文件独立共存，entrypoint.sh 含 CECELIA_PROMPT_FILE 协议。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── forensics-no-overwrite smoke ──"

TMPDIR_TEST=$(mktemp -d)
trap 'rm -rf "$TMPDIR_TEST" "$REPO_ROOT/smoke-fn-check.mjs" 2>/dev/null || true' EXIT

# 1. writePromptFile 文件名含实例标识
cat > "$REPO_ROOT/smoke-fn-check.mjs" << 'EOF'
import path from "path";
import { readFileSync } from "fs";
const m = await import("./packages/brain/src/docker-executor.js");
const p1 = m.__test__.writePromptFile("smoke-fn", "run1");
await new Promise(r => setTimeout(r, 20));
const p2 = m.__test__.writePromptFile("smoke-fn", "run2");
const b1 = path.basename(p1);
if (!/^smoke-fn\.\d{10,}-[0-9a-f]{8}\.prompt$/.test(b1)) {
  console.error("FAIL_FORMAT:" + b1); process.exit(1);
}
if (p1 === p2) {
  console.error("FAIL_OVERWRITE:" + p1); process.exit(2);
}
if (readFileSync(p1, "utf8") !== "run1") {
  console.error("FAIL_CONTENT_LOST"); process.exit(3);
}
console.log("OK:p1=" + b1 + " p2=" + path.basename(p2));
EOF

node "$REPO_ROOT/smoke-fn-check.mjs" 2>/dev/null \
  && ok "writePromptFile 生成含实例标识文件名，两次写入独立共存" \
  || fail "writePromptFile 仍用旧格式或覆盖文件"

# 2. entrypoint.sh 含 CECELIA_PROMPT_FILE fallback 语法
ENTRYPOINT="$REPO_ROOT/docker/cecelia-runner/entrypoint.sh"
grep -q 'CECELIA_PROMPT_FILE' "$ENTRYPOINT" \
  && grep 'CECELIA_PROMPT_FILE' "$ENTRYPOINT" | grep -q ':-' \
  && ok "entrypoint.sh 含 CECELIA_PROMPT_FILE fallback 语法" \
  || fail "entrypoint.sh 缺 CECELIA_PROMPT_FILE / fallback"

# 3. docker-executor.js 含 CECELIA_STDOUT_FILE 字面量
grep -q 'CECELIA_STDOUT_FILE' "$REPO_ROOT/packages/brain/src/docker-executor.js" \
  && ok "docker-executor.js 含 CECELIA_STDOUT_FILE 协议声明" \
  || fail "docker-executor.js 缺 CECELIA_STDOUT_FILE"

# 4. host-executor.js 含实例标识生成逻辑
grep -qE "Date\.now\(\)|randomBytes|instanceId" "$REPO_ROOT/packages/brain/src/spawn/host-executor.js" \
  && ok "host-executor.js 含实例标识生成逻辑" \
  || fail "host-executor.js 不含实例标识生成逻辑"

echo ""
echo "smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
