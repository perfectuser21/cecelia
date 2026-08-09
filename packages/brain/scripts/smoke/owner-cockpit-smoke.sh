#!/usr/bin/env bash
# owner-cockpit-smoke.sh — 主理人指挥舱 smoke 验收
#
# Task ID: 80a5be84-059a-4d86-a55c-a1e38f84e043
# Sprint:  sprints/07162300-owner-cockpit
#
# 验收项：
#   1. Brain API /api/brain/harness/stats 可访问，返回 completion_rate
#   2. Brain API /api/brain/guard-drill/status 可访问，返回 guards 数组
#   3. scheduler-jobs.js 中包含 morning-cockpit-bark 条目
#   4. morning-cockpit-bark.js 中无硬编码 BARK_TOKEN
#   5. OwnerCockpitPage.tsx 文件存在
#   6. apps/api/features/workbench/index.ts 注册 WorkbenchOverview → OwnerCockpitPage

set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [[ "$result" == "PASS" ]]; then
    echo "✅ $label"
    PASS=$((PASS+1))
  else
    echo "❌ $label — $result"
    FAIL=$((FAIL+1))
  fi
}

# 1. Brain harness/stats API
stats=$(curl -sf "${BRAIN_URL}/api/brain/harness/stats" 2>/dev/null || echo "FAIL")
if echo "$stats" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'completion_rate' in d" 2>/dev/null; then
  check "Brain /api/brain/harness/stats 可访问" "PASS"
else
  check "Brain /api/brain/harness/stats 可访问" "API 返回异常或不含 completion_rate"
fi

# 2. guard-drill/status API
drill=$(curl -sf "${BRAIN_URL}/api/brain/guard-drill/status" 2>/dev/null || echo "FAIL")
if echo "$drill" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'guards' in d" 2>/dev/null; then
  check "Brain /api/brain/guard-drill/status 可访问" "PASS"
else
  check "Brain /api/brain/guard-drill/status 可访问" "API 返回异常或不含 guards"
fi

# 3. scheduler-jobs.js 包含 morning-cockpit-bark
SCHED_FILE="${REPO_ROOT}/packages/brain/src/scheduler-jobs.js"
if grep -q "'morning-cockpit-bark'" "$SCHED_FILE" 2>/dev/null; then
  check "scheduler-jobs.js 含 morning-cockpit-bark 条目" "PASS"
else
  check "scheduler-jobs.js 含 morning-cockpit-bark 条目" "未找到条目"
fi

# 4. morning-cockpit-bark.js 无硬编码 BARK_TOKEN
BARK_FILE="${REPO_ROOT}/packages/brain/src/morning-cockpit-bark.js"
if [[ -f "$BARK_FILE" ]]; then
  if grep -qE "BARK_TOKEN\s*=\s*['\"][a-zA-Z0-9]+" "$BARK_FILE" 2>/dev/null; then
    check "morning-cockpit-bark.js 无硬编码 BARK_TOKEN" "发现硬编码 token！"
  else
    check "morning-cockpit-bark.js 无硬编码 BARK_TOKEN" "PASS"
  fi
else
  check "morning-cockpit-bark.js 无硬编码 BARK_TOKEN" "文件不存在"
fi

# 5. OwnerCockpitPage.tsx 存在
COCKPIT_PAGE="${REPO_ROOT}/apps/dashboard/src/pages/owner-cockpit/OwnerCockpitPage.tsx"
if [[ -f "$COCKPIT_PAGE" ]]; then
  check "OwnerCockpitPage.tsx 文件存在" "PASS"
else
  check "OwnerCockpitPage.tsx 文件存在" "文件不存在: $COCKPIT_PAGE"
fi

# 6. Workbench 路由配置
WORKBENCH_INDEX="${REPO_ROOT}/apps/api/features/workbench/index.ts"
if grep -q "WorkbenchOverview.*OwnerCockpitPage" "$WORKBENCH_INDEX" 2>/dev/null; then
  check "apps/api/features/workbench/index.ts 注册 WorkbenchOverview" "PASS"
else
  check "apps/api/features/workbench/index.ts 注册 WorkbenchOverview" "未找到 OwnerCockpitPage 映射"
fi

echo ""
echo "========================================="
echo "Smoke 结果：${PASS} 通过 / ${FAIL} 失败"
echo "========================================="

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
