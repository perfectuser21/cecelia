# Learning: cecelia_events 表加 task_id 列

**PR**: cp-0419113408-cp-04191134-events-task-id
**日期**: 2026-04-19

## 发生了什么

`packages/brain/src/executor.js` 里 LangGraph harness pipeline 的 `onStep` 回调每一步都 `INSERT INTO cecelia_events (event_type, task_id, payload) VALUES ('langgraph_step', $1::uuid, $2::jsonb)`，但 `cecelia_events` 表的基础 schema（`000_base_schema.sql` L111-117）只有 `id / event_type / source / payload / created_at`，根本没有 `task_id` 列。每一次 INSERT 都因 `column "task_id" does not exist` 抛错，然后被外层 `try { ... } catch { /* non-fatal */ }` 吞掉。

结果：
- Dashboard 查询 `langgraph_step` 事件永远为空
- 运行日志里没有一条 warn/error，问题隐形了很久
- 事件表里丢失了 LangGraph 每步的状态快照，debug 线索为零

## 根本原因

1. **Schema 漂移**：代码写的是含 `task_id` 的 INSERT，但数据库表结构没有这一列，没有任何 migration 补上
2. **静默失败**：`catch { /* non-fatal */ }` 把错误完全吞掉，不打 log 不上报，使 schema 漂移无法被发现
3. **缺集成测试兜底**：新增 LangGraph pipeline 时没有"INSERT 能真正落库"的集成测试，只有 mock 过的单元测试

## 下次预防

- [ ] **"可选"的 DB 写入也要打 warn**：即使 catch 不阻塞主流程，也必须 `console.warn` 打出 `err.message`，让 schema 漂移能立即被发现
- [ ] **新表列/新 INSERT 字段必须随代码同步 migration**：PR 自检清单里加一条——"新 SQL INSERT 字段在 base_schema + 最新 migration 里都能找到"
- [ ] **涉及新写入的 LangGraph/pipeline 代码必须有集成测试**：放 `packages/brain/src/__tests__/integration/`，走 brain-integration CI 真连 PostgreSQL 验证 INSERT 落库
- [ ] **vitest.config.js exclude 规则**：需要真实 pool 的测试放到 `integration/` 子目录，brain-unit 自动排除、brain-integration 才扫描

## 本次改动清单

- `packages/brain/migrations/235_cecelia_events_task_id.sql` — 新 migration：ADD COLUMN task_id UUID + 部分索引（WHERE task_id IS NOT NULL），不加 FK（cascade delete 场景事件应留存）
- `packages/brain/src/__tests__/integration/cecelia-events-task-id.integration.test.js` — 新集成测试：列存在 + UUID 类型 + INSERT 成功 + NULL 兼容 + 清理
- `packages/brain/src/executor.js` — `catch { /* non-fatal */ }` 改为 `catch (err) { console.warn(...) }`
