# Sprint PRD — fix-markdispatched-null-payload

journey_type: bug_fix
target_environment: packages/brain (PostgreSQL集成测试)

## 背景与根因

Notion Issue: 817097dc（07-22破案）

**根因**：`nightly-orchestrator.js` 第161行 `markDispatched` 函数使用：
```sql
SET payload = payload || $1::jsonb
```
当任务的 `payload` 列为 `NULL` 时，Postgres 中 `NULL || jsonb = NULL`，导致 `dispatched_by_orchestrator` 标记永远无法写入。

**后果**：`getPendingBacklog`（第88行）的过滤条件 `payload->>'dispatched_by_orchestrator' IS NULL` 对 NULL payload 恒为 true，任务33ae43c8昨夜被连续7个周期重复派发，每轮消耗1个dispatch slot，饿死真实积压任务。

**同款陷阱（同文件/同模块扫描结果）**：
- `post-publish-data-collector.js` 第125行 `writeBackToPublishTask`：`payload = payload || $1::jsonb`（NULL陷阱）
- `post-publish-data-collector.js` 第154行 `completeScraperTask`：`payload = payload || $1::jsonb`（NULL陷阱）
- `routes/content-library.js` 第149行：`payload = payload || $1::jsonb`（NULL陷阱）

---

## 累积 FR

| # | 功能需求 |
|---|---------|
| FR-1 | `markDispatched` 改为 `SET payload = COALESCE(payload, '{}'::jsonb) \|\| $1::jsonb`，参照 `handoff.js` saveHandoff 的防御写法 |
| FR-2 | 新增集成测试：插入 `payload=NULL` 的 queued 任务 → 调用 `markDispatched` → 断言 `SELECT payload->>'dispatched_by_orchestrator'` 返回 `'true'` |
| FR-3 | 新增集成测试：payload=NULL 任务经 markDispatched 后，连续调用两轮 `getPendingBacklog`，断言第二轮不再返回该任务（任务ID不在结果集中） |
| FR-4 | 修复 `post-publish-data-collector.js` 第125行和第154行的同款 NULL 陷阱 |
| FR-5 | 修复 `routes/content-library.js` 第149行的同款 NULL 陷阱 |
| FR-6 | 回归测试必须 commit 进仓库，永久进入 CI 不得删除 |

---

## Invariant 约束

| # | 约束 |
|---|------|
| INV-1 | 禁止裸写 `payload = payload \|\| $x::jsonb` 或 `result = result \|\| $x::jsonb`，必须加 COALESCE 防御 |
| INV-2 | `markDispatched` 修改后不得改变任务 `status`（仍由 tick loop 拉起） |
| INV-3 | `getPendingBacklog` 过滤逻辑不得修改（仅修复标记写入端） |
| INV-4 | nightly评分逻辑（`scoreTask`）不在本Sprint修改范围内 |
| INV-5 | executor N4守卫行为不在本Sprint修改范围内 |
| INV-6 | 集成测试必须连接真实 Postgres（不可用 mock 替代数据库层） |

---

## NFR

- **正确性**：修复后同一queued任务在同日内不能被 nightly orchestrator 派发超过1次
- **向后兼容**：`payload` 已有值的任务行为不变（COALESCE仅在NULL时生效）
- **测试覆盖**：新增回归测试永久留在 CI，不得因任何原因删除

---

## 验收标准（Final E2E）

**数据写入类，必须查DB验证：**

1. **DB断言A**：插入 `payload=NULL` 的 queued 任务 → 执行 `markDispatched(taskId)` → 执行 `SELECT payload->>'dispatched_by_orchestrator' FROM tasks WHERE id=$1` → 断言结果为 `'true'`（非NULL非空字符串）

2. **DB断言B**：上述任务经 markDispatched 后，调用 `getPendingBacklog()` → 断言返回行中不含该 taskId

3. **CI全绿**：`packages/brain` 所有测试通过，包括新增回归测试

---

## 实现指引

**修改点1**（主修）— `packages/brain/src/nightly-orchestrator.js` 第161行：
```sql
-- Before（有NULL陷阱）
SET payload = payload || $1::jsonb
-- After（防御写法）
SET payload = COALESCE(payload, '{}'::jsonb) || $1::jsonb
```

**修改点2**（顺带修）— `packages/brain/src/post-publish-data-collector.js` 第125、154行：同上防御写法

**修改点3**（顺带修）— `packages/brain/src/routes/content-library.js` 第149行：同上防御写法

**测试文件**：在 `packages/brain/src/__tests__/nightly-orchestrator.test.js` 中新增集成测试（连接真实Postgres，或用 `pg-mem` / `testcontainers` 模拟真实SQL语义）

---

## 范围外（明确排除）

- executor N4 守卫行为
- nightly评分逻辑变更
- 其他模块（已用COALESCE的写法不需要改）
