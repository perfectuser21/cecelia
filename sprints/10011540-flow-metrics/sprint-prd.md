---
journey_type: user_facing
target_environment: mac_web
---
# Sprint PRD：活动近七日过程指标接线

任务903e9956-f677-4af0-9d6f-53ddae717143；原根ec643d60-cf1a-4d5a-926d-c4f2434e990f；决定3e867cad/f425e3fd。

## Golden Path

1. 用户打开现有地图，选择 zenithjoy-workspace 范围 → 能力/价值流区域显示逐活动与工作流p50、一次做对、实际通过率和样本；无需radius成功。
2. 用户打开军师路径的活动页面 → 活动行显示同一七日事实，无数据展示明确空值。
3. 用户打开既有Notion承诺地图格子 → activity格Flow字段与真身一致，step/enabler/旧链接不继承；七日过期清空。

打开现有地图或军师活动页面 → 看到近七日逐活动/工作流p50、一次做对、实际通过率和样本 → 判断真正耗时与结果。Notion沿现有真身投影通道显示相同事实。无数据明确空值；一次做对沿既有1-fallback口径说明；颜色仍由判定回执决定。

手机恢复后的新夜批验收属于d4c3f808，10/2北京时间06:55后只读验；本棒不触发夜采收、不把历史/回放当新批。不改schema、网络、设备、地图拓扑、镜子状态列。

代码范围：
- packages/brain/src/lib/activity-flow-metrics.js
- packages/brain/src/lib/notion-activity-flow.js
- packages/brain/src/lib/map-read-service.js
- packages/brain/src/routes/journeys.js
- packages/brain/src/notion-push-sync.js
- packages/brain/src/notion-probe-projection.js
- packages/brain/src/ops-notion-schema.js
- apps/api/features/planning/components/ActivityFlowMetrics.tsx
- apps/api/features/planning/pages/MapPage.tsx
- apps/dashboard/src/pages/strategist/StrategistLinePage.tsx

永久红回归先提交4a8a5a260b/84d077ecc3/0067ae109b，日志/tmp/flow-metrics-red-brain.log、/tmp/flow-metrics-red-ui.log、/tmp/flow-metrics-red-sweep.log、/tmp/flow-metrics-red-legacy.log。真实父链SQL在PostgreSQL READ ONLY用CTE验证无工作流错误标签不跨流、合法父链保留、跨流workflow拒绝。生产真实输出在部署后回读API/Notion与页面；不以mock冒充生产。
