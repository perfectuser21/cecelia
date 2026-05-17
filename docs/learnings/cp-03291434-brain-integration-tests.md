# Learning: Brain 关键路由集成测试补全

**分支**: cp-03291434-brain-integration-tests
**日期**: 2026-03-29

## 完成内容

为 Brain 4 个关键路由补充了集成测试（真实 PostgreSQL），文件位于：
`packages/brain/src/__tests__/integration/critical-routes.integration.test.js`

覆盖路由：GET /health、GET /tasks、GET /context、GET /okr/current

## 根本原因

Brain 路由缺乏集成测试，导致：
1. `/context` SQL bug 曾在无测试保护下被引入
2. CI `integration-test-required` 门禁要求 Brain feat PR 必须含集成测试
3. mock 单元测试无法捕捉 SQL 语法错误和字段名错误

### 下次预防

- [ ] 新增 Brain 路由时，同步在 `src/__tests__/integration/` 目录添加集成测试
- [ ] `/context` 等复杂 SQL 路由修改前，先跑集成测试确认 SQL 无误
- [ ] 集成测试中断言字段名前，必须先确认实际响应结构（本次发现 `summary` 实为 `summary_text`）
- [ ] 复杂 mock 依赖（如 goals.js 依赖 tick.js/circuit-breaker）需要在测试文件开头完整 mock，否则导入会报错

## 技术发现

1. `/context` 响应字段名为 `summary_text`，不是 `summary`——只有集成测试才能发现此类问题
2. goals.js 依赖链：tick.js + circuit-breaker.js + event-bus.js + alertness/index.js + dispatch-stats.js + task-cleanup.js + proposal.js，需全部 mock
3. CI `integration-test-required` 门禁检查路径为 `packages/brain/src/__tests__/integration/`，与任务描述中提到的 `routes/__tests__/` 不同
