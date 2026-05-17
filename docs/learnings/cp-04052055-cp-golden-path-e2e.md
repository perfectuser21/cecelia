## Golden Path E2E 集成测试（2026-04-05）

### 根本原因

Cecelia Brain 缺少端到端路径验证。现有 brain-endpoint-contracts 测试用 mock DB，
critical-routes 测试覆盖了 health/tasks/context/okr，但没有专门的"Golden Path"文件
来标识"哪些链路是 P0 核心链路"。新人或 AI agent 无法快速判断哪 3 条路径最关键。

同时发现一个 schema 认知偏差：调用 `PATCH /api/brain/tasks` 时传 `result` 字段
会被路由接受（API 层面），但直接查 DB 时 `result` 列不存在，正确字段是
`status`/`pr_url`/`metadata`。需要通过真实 DB 测试才能发现。

### 下次预防

- [ ] 新写集成测试时，先用 `SELECT column_name FROM information_schema.columns WHERE table_name='tasks'` 查清实际表结构，不依赖 API response 字段名推断 DB schema
- [ ] Golden Path 文件已建立，后续新增核心链路时在 `golden-path.integration.test.js` 中追加 Path N
- [ ] brain-unit OOM 是 pre-existing 问题（ci.yml 已标 continue-on-error），不要因 brain-unit fail 误判 CI 失败；以 ci-passed gate 为准
