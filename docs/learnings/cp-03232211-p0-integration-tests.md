# Learning: P0 跨集成测试 — OKR 拆解端到端 + Tick Full Loop

**Branch**: cp-03232211-p0-integration-tests
**Date**: 2026-03-23
**Task ID**: 2817b37d-af41-4762-900f-024fb3ce416f

---

### 根本原因

Brain 系统有 459 个单元测试，但跨模块集成测试严重不足（"500个灯泡，没有导线"）。
最近的 OKR 迁移（PR #1461-1464，goals/projects → objectives/key_results/okr_projects 新表体系）
没有端到端集成测试验证，增加了线上回归风险。

---

### 解决方案

新增 2 个 P0 集成测试文件：

1. **`okr-decomposition-flow.integration.test.js`**（10 tests）
   - 通过 Brain API 验证 Vision→Objective→KR→okr_project→Scope→Initiative 完整创建链
   - ON DELETE CASCADE 级联验证（删 Objective 后子层全部消失）
   - `/api/brain/okr/tree` 树状层级查询
   - KR `recalculate-progress`（completed/total tasks 比例计算 current_value）

2. **`tick-full-loop.integration.test.js`**（4 tests）
   - 使用真实 PostgreSQL（不 mock db.js），仅 mock 外部服务
   - P0 存在时 P2 不被选中（断言 task.id !== p2Id）
   - depends_on 未完成时任务被跳过
   - completed 后依赖满足，任务可被选中（柔性验证）

---

### 关键教训

- [ ] **集成测试要用真实 DB**：tick-dispatch.integration.test.js 全量 mock db.js，是伪集成测试。真正的集成测试应连接真实 PostgreSQL，只 mock 外部服务（alertness、LLM、focus）
- [ ] **共享状态 it 链需要 skip guard**：`describe` 内多个 `it` 共享变量（objId, krId...）时，后续 `it` 开头必须加 `if (!prevId) return;`，防止前一步失败导致后续产生误导性错误
- [ ] **生产 DB 环境的断言要柔性**：在非隔离 DB 中测试时（有生产数据），不能断言"我的 P0 任务一定被选中"（可能有其他 P0 任务）。要改为"P2 不被选中"的负向断言
- [ ] **DoD 必须包含 [BEHAVIOR] 条目**：CI L1 DoD Gate 检查是否有 `[BEHAVIOR]` 标签，纯 ARTIFACT 检查无法通过
- [ ] **Learning 必须在 push 前写好**：本次在 push 后写 Learning，导致 CI L1 Learning Gate 失败，需要补 commit 修复

---

### 下次预防

- 写集成测试时，直接使用 pg.Pool 连接真实 DB，不要复制 tick-dispatch 的 mock 模式
- 每个 spec 都要在 DoD 中加 `[BEHAVIOR]` 运行时验证条目
- Learning 必须在第一次 push 前写好并加入 commit
