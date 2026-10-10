## Brain {VERSION} — 运行定义回读瘦身：GET /runs/:id/definition 默认只回本次运行的定义骨架

任务 e961f9a9。10-09 22:15/22:45 智能获客 crontab 运行因「运行发布绑定未确认」拒跑：执行端 bind-run 回读 GET /api/brain/runs/{run_id}/definition 带回整个 release（payload 约 528KB：15 个 Activity 全量 269KB、CI 证据 119KB、4 个 Workflow 86KB、断言计划 79KB），响应约 669KB，跨境 curl `-m 60` 超时。服务端本身 0.12s 出完。

- 新增 `lib/run-definition-view.js`（`compactRunDefinition`、`RUN_DEFINITION_COMPACT_LIMIT_BYTES=64KB`）。默认回读 `definition_view=compact`：binding 原样；release 只留 id/release_key/manifest_sha256/request_sha256/environment/target/actor/created_at + `full_href`；workflow 去 `payload.contract`；activities 只留本次绑定的 Activity 身份与 payload_sha256/contract_sha256，Step 留 step_id/locator/registration 摘要与 optional/required/condition。
- `?view=full` 原样返回旧形状；完整 release 走已有的 GET /api/brain/releases/:id。紧凑化遇异常形状回退完整定义，不 500。
- 执行端（zenithjoy-workspace runtime-binding.mjs）只读 `binding`，字段契约兼容；Brain 内部消费者用 lib 函数 `getRunDefinitionBinding`，未改。
- 生产 12 条真实绑定实测：视频发现 651,859→30,546 字节，视频处理 653,184→29,474，评论评分 564,975→9,016。
