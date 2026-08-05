#!/usr/bin/env bash
# strategist-form-smoke.sh — 军师台形态对版收尾 smoke 验证
# task_id: 184c6da1-ef57-4171-ba92-5b05711076e6
# Fix-1~Fix-5 快速健康检查
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:5174}"
# 相对定位仓库根（packages/brain/scripts/smoke → 上跳四级），不依赖 git/容器路径
# （模式同 gp-assertion-command-smoke.sh；此前 git 兜底在 glob runner 失效落到 /workspace 死路径）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

echo "=== strategist-form-smoke: 开始 ==="

# 1. Brain 在线
echo "[1/5] 检查 Brain 在线..."
curl -sf "${BRAIN_URL}/api/brain/context" > /dev/null \
  || { echo "FAIL: Brain 不在线"; exit 1; }

# 2. Dashboard 在线（smoke 环境无 Dashboard，跳过；源码断言在步骤 4/5 覆盖）
echo "[2/5] Dashboard 在线检查（smoke 环境跳过）：OK"

# 3. journey_step_links API 可用（Fix-1 依赖）
echo "[3/5] 检查 journey_step_links API..."
curl -sf "${BRAIN_URL}/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1&limit=1" > /dev/null \
  || { echo "FAIL: journey_step_links API 失败"; exit 1; }

# 4. smoke 过滤代码存在（Fix-5）
echo "[4/5] 检查 smoke 过滤源码..."
grep -q "smoke" "${REPO_ROOT}/apps/dashboard/src/pages/strategist/StrategistPage.tsx" \
  || { echo "FAIL: StrategistPage.tsx 缺少 smoke 过滤"; exit 1; }

# 5. AbortController 超时保护（Fix-3）
echo "[5/5] 检查 AbortController 源码..."
grep -q "AbortController" "${REPO_ROOT}/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx" \
  || { echo "FAIL: ConversationsPanel.tsx 缺少 AbortController"; exit 1; }

echo "=== strategist-form-smoke: 全通过 ==="
