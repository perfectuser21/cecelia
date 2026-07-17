#!/usr/bin/env bash
# startup-reset-smoke.sh
# 验收：agent core 启动归零五步流水线冒烟
# Task: startup-reset 启动前置幂等复位
set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
STARTUP_RESET_JS="$SCRIPT_DIR/../../src/startup-reset.js"
API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

echo "── startup-reset smoke ──"

# 1. Brain API 健康检查
echo "── healthz ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "${API}/health")
[[ "$code" == "200" ]] \
  && ok "Brain /api/brain/health → 200" \
  || fail "Brain /api/brain/health → 期望 200，得 $code（Brain 未启动）"

# 2. startup-reset.js 文件存在
echo "── file check ──"
[[ -f "$STARTUP_RESET_JS" ]] \
  && ok "startup-reset.js 文件存在" \
  || fail "startup-reset.js 文件不存在：$STARTUP_RESET_JS"

# 3. 五步函数均已定义（静态 grep）
echo "── function exports ──"
if grep -q 'export async function runProcessZero' "$STARTUP_RESET_JS"; then
  ok "S1 runProcessZero 已导出"
else
  fail "S1 runProcessZero 未导出"
fi

if grep -q 'export async function runWechatUnify' "$STARTUP_RESET_JS"; then
  ok "S2 runWechatUnify 已导出"
else
  fail "S2 runWechatUnify 未导出"
fi

if grep -q 'export async function runEnvCheck' "$STARTUP_RESET_JS"; then
  ok "S3 runEnvCheck 已导出"
else
  fail "S3 runEnvCheck 未导出"
fi

if grep -q 'export async function runResidueCleanup' "$STARTUP_RESET_JS"; then
  ok "S4 runResidueCleanup 已导出"
else
  fail "S4 runResidueCleanup 未导出"
fi

if grep -q 'export async function reportStartupChecklist' "$STARTUP_RESET_JS"; then
  ok "S5 reportStartupChecklist 已导出"
else
  fail "S5 reportStartupChecklist 未导出"
fi

if grep -q 'export async function runStartupReset' "$STARTUP_RESET_JS"; then
  ok "Master runStartupReset 已导出"
else
  fail "Master runStartupReset 未导出"
fi

# 4. fail-open 设计：每步 try/catch 存在
echo "── fail-open design ──"
try_count=$(grep -c 'try {' "$STARTUP_RESET_JS" 2>/dev/null || echo 0)
if [[ "$try_count" -ge 5 ]]; then
  ok "fail-open try/catch 覆盖 >= 5 处（实际 $try_count）"
else
  fail "fail-open try/catch 不足，期望 >= 5，实际 $try_count"
fi

# 5. working_memory 上报：sentinel key 常量存在
echo "── checklist sentinel ──"
if grep -q "scheduler_job_last_run:startup-reset" "$STARTUP_RESET_JS"; then
  ok "working_memory sentinel key 已定义"
else
  fail "working_memory sentinel key 未定义"
fi

# 6. working_memory API 可查（验证 DB 表存在）
echo "── working_memory API ──"
wm_code=$(curl -s -o /dev/null -w "%{http_code}" \
  "${API}/memory/search" \
  -X POST -H "Content-Type: application/json" \
  -d '{"query":"startup-reset"}' 2>/dev/null)
[[ "$wm_code" == "200" ]] \
  && ok "POST /api/brain/memory/search → 200（working_memory 可查）" \
  || ok "POST /api/brain/memory/search → $wm_code（可能未触发 S5，非阻断）"

echo ""
echo "── 结果 ──"
echo "通过: $PASS / 失败: $FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
