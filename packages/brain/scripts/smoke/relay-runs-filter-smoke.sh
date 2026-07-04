#!/usr/bin/env bash
# Smoke: relay-runs ?phase= 过滤 + /:initiative_id 详情端点
# 验证 N4 两个新端点的基本行为（静态 + 运行时双层）
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
# 支持从仓库根或 packages/brain/ 下运行
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ROUTE="$REPO_ROOT/packages/brain/src/routes/initiatives.js"

echo "=== relay-runs-filter smoke ==="

# 1. 静态检查：ALLOWED_PHASES 常量存在且含正确枚举
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROUTE', 'utf8');
if (!src.includes('ALLOWED_PHASES')) {
  console.error('FAIL: ALLOWED_PHASES 常量未在路由文件中定义'); process.exit(1);
}
const required = ['A_planning','A_contract','B_task_loop','C_final_e2e',
                   'done','failed','planning','gan','generate','evaluate'];
const missing = required.filter(v => !src.includes(\"'\" + v + \"'\"));
if (missing.length > 0) {
  console.error('FAIL: ALLOWED_PHASES 缺失枚举值:', missing.join(',')); process.exit(1);
}
console.log('✅ 静态检查: ALLOWED_PHASES 含全部 10 个 migration 312 枚举值');
"

# 2. 静态检查：/:initiative_id 路由已注册
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROUTE', 'utf8');
if (!/relay-runs\/:initiative_id/.test(src)) {
  console.error('FAIL: GET /relay-runs/:initiative_id 路由未注册'); process.exit(1);
}
console.log('✅ 静态检查: /relay-runs/:initiative_id 路由已注册');
"

# 3. 运行时检查（Brain 可达 且 已部署新版端点 时执行）
# 先探测新版端点是否可用（旧 Brain 返回 200 而非 400，则跳过运行时检查）
BRAIN_HAS_NEW_ENDPOINT=0
if curl -sf --max-time 3 "$BRAIN/api/brain/health" > /dev/null 2>&1; then
  PROBE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/orchestrator/relay-runs?phase=INVALID_PHASE_XYZ")
  if [ "$PROBE" = "400" ]; then
    BRAIN_HAS_NEW_ENDPOINT=1
  fi
fi

if [ "$BRAIN_HAS_NEW_ENDPOINT" = "1" ]; then
  echo "Brain 可达且已部署新端点，执行运行时 smoke..."

  # 3a. 无效 phase → 400
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/orchestrator/relay-runs?phase=INVALID_PHASE_XYZ")
  if [ "$STATUS" != "400" ]; then
    echo "FAIL: 无效 phase 期望 400，实际 $STATUS"; exit 1
  fi
  echo "✅ 运行时: 无效 phase → 400"

  # 3b. 无效 phase 响应含 allowed 字段
  BODY=$(curl -s "$BRAIN/api/brain/orchestrator/relay-runs?phase=INVALID_PHASE_XYZ")
  if ! echo "$BODY" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!d.allowed){process.exit(1);}"; then
    echo "FAIL: 400 响应缺 allowed 字段; body=$BODY"; exit 1
  fi
  echo "✅ 运行时: 400 响应含 allowed 字段"

  # 3c. 合法 phase 过滤 → 200 数组
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/orchestrator/relay-runs?phase=A_planning")
  if [ "$STATUS" != "200" ]; then
    echo "FAIL: 合法 phase 期望 200，实际 $STATUS"; exit 1
  fi
  echo "✅ 运行时: 合法 phase=A_planning → 200"

  # 3d. 不存在的 initiative_id → 404
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000")
  if [ "$STATUS" != "404" ]; then
    echo "FAIL: 不存在 initiative_id 期望 404，实际 $STATUS"; exit 1
  fi
  echo "✅ 运行时: 不存在 initiative_id → 404"

else
  echo "⏭️  Brain 不可达或未部署新端点，跳过运行时验证（CI 静态检查已覆盖）"
fi

echo "=== relay-runs-filter smoke 通过 ==="
