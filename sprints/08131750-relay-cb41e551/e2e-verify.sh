#!/usr/bin/env bash
# D3 backbone verification — sprint 08131750-relay-cb41e551
# E2E route: mac_web (localhost:5221 Brain)
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== D3: backbone 节点数量验证 ==="
BACKBONE_COUNT=$(curl -s "${BRAIN_URL}/api/brain/map?scope=cecelia" | \
  python3 -c "import json,sys; nodes=json.load(sys.stdin).get('nodes',[]); print(sum(1 for n in nodes if n.get('type')=='backbone'))")

echo "backbone 节点数: ${BACKBONE_COUNT}"
if [ "${BACKBONE_COUNT:-0}" -ge 4 ]; then
  echo "✅ D3 PASS: backbone >= 4"
else
  echo "❌ D3 FAIL: backbone = ${BACKBONE_COUNT}, need >= 4"
  exit 1
fi

echo ""
echo "=== D5: StateBadge child_unknown 文案验证 ==="
# 通过代码静态验证（已在 MapPage.tsx 实现）
grep -q "child_unknown.*子节点状态未知" /workspace/apps/api/features/planning/pages/MapPage.tsx && \
  echo "✅ D5 PASS: child_unknown 映射存在" || \
  { echo "❌ D5 FAIL"; exit 1; }

echo ""
echo "✅ E2E 验收通过"
