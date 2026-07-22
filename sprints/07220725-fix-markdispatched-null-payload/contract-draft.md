# Contract Draft — fix-markdispatched-null-payload

Sprint: 07220725-fix-markdispatched-null-payload
Task ID: 2faafa72-9358-4057-b1e6-6f5a67133ed7
日期: 2026-07-22

---

## 背景摘要

`nightly-orchestrator.js` 中 `markDispatched` 函数执行的 SQL 为：

```sql
SET payload = payload || $1::jsonb
```

在 PostgreSQL 中，`NULL || jsonb = NULL`，导致 `payload` 为 NULL 的任务即便调用了 `markDispatched`，其 `dispatched_by_orchestrator` 字段也永远写不进去。`getPendingBacklog` 的过滤条件 `payload->>'dispatched_by_orchestrator' IS NULL` 对 NULL payload 恒为 true，造成同一任务被同日多个编排周期重复派发（已知案例：任务 33ae43c8 昨夜被连续 7 个周期重复派发，消耗 slot 饿死积压）。

同款 NULL 陷阱存在于三处额外位置（`post-publish-data-collector.js` 两处、`routes/content-library.js` 一处），一并修复。

---

## 修复范围

| 文件 | 行号 | 函数/上下文 | 修复动作 |
|------|------|-------------|---------|
| `packages/brain/src/nightly-orchestrator.js` | 161 | `markDispatched` | `payload \|\| $1` → `COALESCE(payload, '{}'::jsonb) \|\| $1` |
| `packages/brain/src/post-publish-data-collector.js` | 125 | `writeBackToPublishTask` | 同上防御写法 |
| `packages/brain/src/post-publish-data-collector.js` | 154 | `completeScraperTask` | 同上防御写法 |
| `packages/brain/src/routes/content-library.js` | 149 | content-pipeline review patch | 同上防御写法 |

**不在范围内**：`scoreTask` 评分逻辑、executor N4 守卫行为、`getPendingBacklog` 过滤逻辑、其他已用 COALESCE 的位置。

---

## 技术断言

### 断言 A — markDispatched 写入 NULL payload 任务
插入一条 `payload = NULL` 的 `queued` 任务，调用 `markDispatched(taskId)` 后，执行：
```sql
SELECT payload->>'dispatched_by_orchestrator' FROM tasks WHERE id = $1
```
结果必须为字符串 `'true'`（非 NULL，非空字符串）。

### 断言 B — 防重派：markDispatched 后不再出现于 getPendingBacklog
同一任务经 `markDispatched` 标记后，调用 `getPendingBacklog()`，返回行中**不含**该 `taskId`。

### 断言 C — 已有 payload 任务不受影响（向后兼容）
对一条 `payload = '{"existing_key": "value"}'` 的任务调用 `markDispatched`，原有 `existing_key` 字段保留，新增 `dispatched_by_orchestrator: 'true'`。

### 断言 D — COALESCE 写法全覆盖（无裸 NULL 陷阱）
源码中不再出现 `payload = payload || $`（不含 COALESCE）或 `result = result || $` 的裸写法。

---

## E2E 验收

**数据写入类，必须连接真实 PostgreSQL 进行集成验证：**

### E2E-1：markDispatched 写入断言（DB 断言 A）

```bash
# 在集成测试环境执行（vitest + 真实 Postgres）
cd packages/brain && npx vitest run src/__tests__/nightly-orchestrator.integration.test.js
```

预期：测试中执行 `markDispatched(taskId)` 后，`SELECT payload->>'dispatched_by_orchestrator'` 返回 `'true'`，断言通过。

### E2E-2：防重派断言（DB 断言 B）

同一集成测试文件中，调用两轮 `getPendingBacklog()`：第一轮含目标任务，第二轮（markDispatched 后）不含该任务 ID。

### E2E-3：全文件无裸 NULL 陷阱静态扫描

```bash
# 扫描修复后四个文件中不存在裸写法
grep -rn "payload = payload || \$\|result = result || \$" \
  packages/brain/src/nightly-orchestrator.js \
  packages/brain/src/post-publish-data-collector.js \
  packages/brain/src/routes/content-library.js
# 预期：无输出（exitcode 1 = grep 无匹配 = 通过）
```

### E2E-4：全量回归测试通过

```bash
cd packages/brain && npx vitest run
```

预期：所有测试（含新增集成测试）全绿，无 skip。

---

## 不变量约束

- `markDispatched` 不得修改任务 `status` 字段
- `getPendingBacklog` 过滤逻辑不得修改
- `scoreTask` 评分逻辑不在本 Sprint 修改范围
- 新增回归测试必须 commit 进仓库，永久留在 CI，不得删除
- 集成测试必须连接真实 PostgreSQL（不可用纯 mock 替代数据库层）
