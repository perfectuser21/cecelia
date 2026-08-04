# warroom /line/:id/command 列名错位修复 — 设计

- Brain task: 9eae3edd-a4a4-43b1-a28f-daae6a12dd32 · 决策 af0d0818 / 13660836
- PrepPRD: sprints/08041820-warroom-line-command-columns/prep-prd.md

## 问题
`packages/brain/src/routes/warroom.js` GET `/line/:id/command` 三处查询列名与真库不符，被 try/catch 静默吞：
1. L432 `journey_features.group_name` → 真列名 `"group"`
2. L492/L506 `initiative_runs.status` → 真列名 `phase`（值域 done/failed/evaluate/planning/gan/…）
3. L492/L506 `initiative_runs.result` → 列不存在（前端 RecentRun 接口不消费）

连带：L513 成功判定 `status==='completed'` → 应为 `phase==='done'`。

## 方案（API 契约不变，前端零改动）
- q3：`SELECT …, "group" AS group_name, …`
- q7：查 `id, phase, started_at, completed_at, created_at`，JS 映射 `status = phase==='done' ? 'completed' : phase==='failed' ? 'failed' : 'in_progress'`；移除 `result`
- q8：查 `phase`，`runSuccess = rows.filter(r => r.phase === 'done').length`

不改静默降级结构（catch 保留，属既有防御设计）；列名修对后 catch 不再吞真实数据。

## 测试策略
- **integration（本次核心）**：新增 `packages/brain/src/__tests__/warroom-line-command-columns.test.js`，真实 pg 连接（DATABASE_URL，模式照 autoblock-sql-integration.test.js，禁 mock pool）。种子：1 journey + 2 journey_features（含 "group" 值）+ 2 initiative_runs（phase=done/failed）→ 调 handler → 断言 abilities[0].group_name 非空、recent_runs 状态映射 completed/failed、health.run_success=1。commit-1 必须先红（当前代码三块均空）。
- **unit**：既有 mock-pool 测试保持通过（仅调整其 mock 无关处，不依赖它验列名）。
- **E2E**：不新增（Line 指挥页 E2E 归军师台 UI 批次）。

## 守卫
逻辑接缝 → 上述 CI regression test 即守卫（proven-to-fire：commit-1 红）。
