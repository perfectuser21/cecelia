# Contract DoD：903e9956 活动过程指标

- [x] [BEHAVIOR] 活动多工作流独立且非活动格不继承，当前地图归属隔离不补拓扑且不平均分位数，Notion零值保留窗口过期清空多工作流不任选。
  Test: manual:npx vitest run sprints/tests/activity-flow-metrics.test.js
- [x] [BEHAVIOR] 既有API与公平增量永久回归通过。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js src/__tests__/notion-probe-projection.test.js src/__tests__/notion-push-sync.test.js src/lib/__tests__/activity-flow-metrics.test.js"
- [x] [BEHAVIOR] 前端主地图指标不依赖radius成功，零值/空值正确，完整suite与build通过。
  Test: manual:bash -c "cd apps/dashboard && npx vitest run && npm run build"

生产输出由部署后真实GET与Notion页回读验收，Brain result记录事实、证据、actor与完整handoff，不将历史指标当新夜批。
