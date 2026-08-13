# 前端回归测试（D1）
cd /workspace && npx vitest run apps/api/features/planning/__tests__/map-collect-descendants.test.ts

# Brain 骨干投影测试（D2）
cd /workspace && npx vitest run packages/brain/src/map/__tests__/projector-backbone.test.js

# 生产 API 骨干节点数量（D3）
curl http://localhost:5221/api/brain/map?scope=cecelia | \
  jq '[.nodes[] | select(.type=="backbone")] | length'
# 期望: >= 4

# Level 2 骨干面板 + StateBadge 截图（D4/D5）
# 由 mac_web Playwright 执行，截图路径：sprints/08131750-relay-cb41e551/e2e-screenshot-F1-backbone.png