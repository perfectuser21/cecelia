# Learning: task-status-transitions integration test

**分支**: cp-0501215612-task-status-transitions-integration-test
**日期**: 2026-05-01
**Brain Task ID**: e23d83f2-84b9-494c-8740-29978ee9b35d

---

### 根本原因

`/api/brain/tasks` 的 `queued → in_progress → completed` 状态流转只有路由存活检查，没有验证每步是否真实写入 PostgreSQL 的 integration test。golden-path test 中虽然有状态更新的 case，但它是作为大链路测试的一部分，不是专门针对状态机流转的细粒度验证。

### 经过

1. 读 `routes/task-tasks.js` 确认真实 PATCH 路径（`PATCH /:id`）和状态机规则
2. 参照 `golden-path.integration.test.js` 的 mock 模式
3. 发现需要 mock `event-bus.js` 的 `emit` 函数（task-tasks.js 不调用，但 task-tasks 内联实现不涉及；golden-path 的 mock 是防御性的）
4. 本地验证 7/7 全部通过

### 下次预防

- [ ] 新增状态流转路由时，同步在 `src/__tests__/integration/` 下添加对应 integration test
- [ ] Integration test 文件名格式：`<feature>-status-transitions.integration.test.js`
- [ ] worktree 中运行 integration test 需要根目录 node_modules，不是 packages/brain/node_modules
