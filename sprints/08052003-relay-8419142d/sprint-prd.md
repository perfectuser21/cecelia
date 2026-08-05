# Sprint PRD：工厂·F1「接单进车间即分档」步修复（三联 bug）

task_id: 8419142d-ce38-4285-9afa-64edbe574eb4
sprint_dir: sprints/08052003-relay-8419142d
journey_type: bug_fix
target_environment: local_api

---

## 背景

2026-08-05 实证，Notion Issue eb9c8d71（P1），三个独立 bug 同步爆发：

1. `POST /api/brain/tasks` 注册携带 `status=blocked` 被覆盖为 `queued`（blocked_at 字段被白名单过滤丢弃）
2. `depends_on_prev` 串行语义对手动注册任务不生效，导致后续任务绕过阻塞并发抢跑派发
3. 同一任务（示例：58e146e1）被双容器重复派发（dispatcher 派发竞态）

根因链：注册层不守状态 → 调度层不检最新状态 → spawn 层无幂等防重——三层均有缺口。

---

## 锚定声明

> hotfix gear 强制段：每条对应一个可独立验证的技术断言。

**断言 A（注册层）**：`POST /api/brain/tasks` 携带 `{ status: "blocked", blocked_at: <timestamp> }` 后，
数据库中该任务行的 `status` 字段必须等于 `"blocked"`，`blocked_at` 字段必须非 null。

**断言 B（调度层）**：dispatcher 在 spawn 前重读任务当前 `status`；当任务 `status="blocked"` 时，
该轮 tick 内不产生任何 spawn 调用（`spawnFn` 调用次数 === 0）。

**断言 C（spawn 层）**：同一 `task_id` 在途容器存在时（模拟幂等键 / 锁已设），
二次 spawn 调用被拒绝并记录 `duplicate_spawn_rejected` 日志，容器总数不超过 1。

---

## Invariant 约束

1. **IN-1 状态优先级**：注册 API 仅允许覆盖 `queued/pending` 初始状态；`blocked` 为合法显式入参，不得被默认值替换。
2. **IN-2 blocked_at 自动补齐**：客户端传 `status=blocked` 但未传 `blocked_at` 时，服务端自动补当前时间；客户端传了则直接使用。
3. **IN-3 dispatcher 无副作用重读**：重读操作仅 SELECT，不更新任何字段，不影响现有 tick 耗时。
4. **IN-4 幂等键作用域**：幂等防重仅作用于同一 `task_id` 的 spawn，不影响不同任务的并发派发能力。
5. **IN-5 failing test 先 commit**：三个复现测试必须在修复代码 commit 之前独立入库，不得合并进同一 commit。
6. **IN-6 四档分流不变**：决策 1b677ae3 定义的四档分流逻辑不受本修复影响。

---

## 累积 FR

| # | 文件 | 变更描述 |
|---|------|---------|
| FR-1 | `packages/brain/src/routes/tasks.js`（注册接口） | 解除 `status` 字段白名单过滤，允许 `blocked` 写入；同步允许 `blocked_at` 入参或自动补 |
| FR-2 | `packages/brain/src/dispatcher.js`（或等效调度文件） | spawn 前重读任务 `status`，状态为 `blocked/completed/failed` 时跳过本轮 |
| FR-3 | `packages/brain/src/harness-skill-relay.js`（或 dispatcher） | spawn 时设幂等键（task_id 维度），在途容器存在则拒绝并记录 `duplicate_spawn_rejected` |
| FR-4 | 测试文件（新增） | failing test A：注册 `status=blocked` → 断言 DB 行 status=blocked（当前版本 failing） |
| FR-5 | 测试文件（新增） | failing test B：blocked 任务进 dispatcher → spawnFn 调用次数=0（当前版本 failing） |
| FR-6 | 测试文件（新增） | failing test C：同 task_id 二次 spawn → 第二次被拒，日志含关键词（当前版本 failing） |
| FR-7 | CI workflow | 三个 failing test 永久纳入 brain-ci.yml 回归跑 |
| FR-8 | 集成场景 | 回归验证：注册 1 queued + 2 blocked 串行序列，确认仅第一个任务被派发 |

---

## NFR

- **NFR-1 性能**：dispatcher 重读为单次 `SELECT … WHERE id=?`，P99 < 5ms，不引入额外轮询。
- **NFR-2 可观测性**：幂等拒绝日志前缀统一为 `[dispatcher][spawn-guard]`，便于 grep 定位。
- **NFR-3 向后兼容**：未传 `status` 的注册请求默认行为（写入 `queued`）保持不变。
- **NFR-4 测试隔离**：所有新测试使用 in-memory mock 或事务回滚，不污染 dev DB。

---

## 实施顺序

1. 写 FR-4/5/6 三个 failing tests → 各自独立 commit（先于修复）
2. 修 FR-1（注册层）→ 验证 failing test A 转绿
3. 修 FR-2（调度层重读）→ 验证 failing test B 转绿
4. 修 FR-3（spawn 幂等键）→ 验证 failing test C 转绿
5. 执行 FR-8 集成回归，确认三任务序列仅派发首个
6. PR → CI（brain-ci.yml）全绿 → 合并

---

journey_type: bug_fix
target_environment: local_api
