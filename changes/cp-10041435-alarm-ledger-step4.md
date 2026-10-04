## Brain {VERSION} — 闹钟总账最小版：扩排程台账（不建新表）、72 个 job 与 recurring 落表、alarms 接口与 Dashboard 只读页

- 迁移 517：`ops_schedule_entries` 加 15 列——机器列（周期/启用/上次运行/上次成功/最近状态/活性/登记状态）、挂树列（`journey_id`/`workflow_id`/`ops_workflow_id`）、人工列（`owner_manual`/`note_manual`/`tree_bucket_manual`）；带 CHECK 约束与回滚。决策 9e9d90b6：不新建表、不另起注册系统。
- `scheduler-jobs.js` 72 个 JOB 各加结构化 `cadence`（`everySec` 或 `cron+tz`）；`scheduler-jobs.test.js` 断言必填、name 唯一——新增定时只能经此表注册。
- `ops-scheduler-liveness.js` 同一份活性结论顺带 UPSERT 一行总账（沿用降噪条件，防 Notion 推送被挤）；总账写失败只告警不拖垮活性判定。`recurring-tasks` job 把模板投影进总账，取代 `agent-ops.js` API 层的临时拼接。
- `ops-collector.js` 采集腿写新机器列（人工列与挂树列永不进 SET）；Notion「Ops 运行图谱」推送排除总账自有行。
- `GET /api/brain/agent-ops/alarms`：统一 11 列 + 来源心跳 + 未登记数；`POST /agent-ops/alarms/import`（内部令牌，缺省干跑）+ `scripts/ops/import-alarm-ledger-inventory.mjs` 导入 2026-10-04 盘点静态快照（`source=inventory-20261004`，已被采集的来源只补挂树列，只补空）。
- Dashboard：System → 「闹钟总账」页签（`/system/alarms`），只读表格，可按机器/机制/状态/部门筛选。
- 回归：`ops-alarm-ledger.test.js`、`ops-alarm-ledger.pg.integration.test.js`、`ops-registry-smoke.sh`（任务 fe10d1a0）。
