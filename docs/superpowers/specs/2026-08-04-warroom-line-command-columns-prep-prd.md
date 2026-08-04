# Bug PrepPRD：warroom /line/:id/command 三处列名错位被静默吞

- Brain task: 9eae3edd-a4a4-43b1-a28f-daae6a12dd32（军师台落地序列第 1 件，决策 af0d0818）

## 症状
Line 指挥页（/warroom/line/:id）三栏大面积空白：abilities/features 恒空、recent_runs 恒空、health 恒零。API 返回 200，无任何报错。

## 根因（已对真库 schema 实证，2026-08-04）
`packages/brain/src/routes/warroom.js` GET `/line/:id/command` 三处查询列名与真库不符，且各自包在 `try/catch` 静默降级里，错误被吞：

1. **L432** `journey_features` 查 `group_name` → 真列名是 `"group"`（varchar(100)）
2. **L492/L506** `initiative_runs` 查 `status` → 真列名是 `phase`（取值 done/failed/evaluate/planning/gan…）
3. **L492/L506** `initiative_runs` 查 `result` → **该列不存在**（前端 RecentRun 接口也不消费它）

连带逻辑错：L513 用 `r.status === 'completed'` 算成功率 → 真库成功终态是 `phase = 'done'`。

**为什么现有测试没拦住**：`__tests__/warroom-line-command.test.js` 用 mock pool，mock 不知道真列名（已有教训：mock 真实外部依赖必出哑火）。

## 修法（保持 API 契约不变，前端零改动）
- q3：`"group" AS group_name`
- q7：改查 `id, phase, started_at, completed_at, created_at`，JS 映射 `status`: `done→completed / failed→failed / 其余→in_progress`；去掉不存在的 `result`
- q8：改查 `phase`；`runSuccess = phase === 'done'`

## Regression Test 计划
新增**真 postgres 集成测试**（禁 mock pool）：种入 1 条 journey + 2 条 journey_features（带 "group"）+ 2 条 initiative_runs（phase=done/failed）→ 调 handler → 断言 abilities 非空且带 group_name、recent_runs 状态映射正确、health.run_success=1。修前必须先跑红（列名错位时三块均空即红）。

## 哨兵
逻辑接缝（纯 SQL 列名/映射）→ CI regression test 即守卫，须 proven-to-fire（commit-1 先红）。不涉真机/生产环境接缝。

## 验收标准
- [ ] failing test 先 commit（commit-1，真 postgres）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] `curl /api/brain/warroom/line/<F5 journey id>/command` 三块非空（本机实测）
- [ ] CI 全绿
