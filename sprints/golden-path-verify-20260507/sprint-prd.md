# Sprint PRD — 验证 harness_initiative 执行完毕后状态自动回写

## OKR 对齐

- **对应 KR**：免疫系统 / Harness 可靠性 KR（任务全链路状态可观测，无静默卡死）
- **当前进度**：未知（Brain API 不可达，无法实时获取）
- **本次推进预期**：把 PR #2816 修复落到"端到端可见"——任何路径执行完的 harness_initiative 任务都不再卡 `in_progress`

## 背景

PR #2816 已合并（2026-05-07 01:46 UTC），修复了 `packages/brain/src/executor.js` 中 harness_initiative 处理器执行完 `compiled.invoke()` 后未调用 `updateTaskStatus` 的 bug。修复内容：

- 成功路径：`final.error` 为空 → `updateTaskStatus(task.id, 'completed')`
- 失败路径：`final.error` 有值 → `updateTaskStatus(task.id, 'failed')`
- catch 路径：异常时同样回写 `failed`，双层 try/catch 保护
- 所有路径统一返回 `{ success: true }`，防止 dispatcher 把已完成任务回退 `queued`

PR 内带 4 项静态单元断言通过，但**未做端到端运行时验证**——即真正派一条 harness_initiative 任务下去，跑到底，看数据库 tasks.status 是否真的从 `in_progress` 变成 `completed`。本 Sprint 就是补这一刀。

## Golden Path（核心场景）

系统从 [一条 harness_initiative 任务被派发] → 经过 [executor 实际执行 LangGraph 编译图直到 invoke 返回] → 到达 [数据库 tasks.status 被回写为 completed 或 failed，且 dispatcher 不再重试该任务]

具体：

1. **触发条件**：一条 `task_type=harness_initiative` 的任务存在，状态为 `queued` 或 `in_progress`，被 executor 拣选执行（可以是真实派发，也可以是测试夹具构造的最小可执行任务）
2. **系统处理**：
   - executor 调用 `compiled.invoke(initialState)`，等待返回
   - 拿到 `final` 对象后，根据 `final.error` 是否存在，调用 `updateTaskStatus(task.id, 'completed'|'failed')`
   - 若 invoke 抛异常被 catch，同样调用 `updateTaskStatus(task.id, 'failed')`
   - 所有路径返回 `{ success: true }`
3. **可观测结果**：
   - 数据库 `tasks` 表中该任务行 `status` 字段 = `completed`（或 `failed`，二选一），不为 `in_progress`、`queued`、`null`
   - dispatcher 后续 tick 不再重新派发该任务（因为状态已是终态）
   - 如有 `result` / `error` 字段，与 final 输出一致（非强制，看现有写回逻辑）

## 边界情况

- **invoke 抛异常**：catch 块必须回写 `failed`，且不能让 executor 整体崩溃
- **updateTaskStatus 自身失败**（DB 短暂不可达）：双层 try/catch 应吞掉错误，executor 仍返回 `{ success: true }` 让 dispatcher 不退回 `queued`；但任务行可能保留旧 `in_progress` ——属于已知降级，不在本 Sprint 范围
- **任务在 invoke 中途超时**（LangGraph 内部超时）：final.error 应被填充，走 failed 路径
- **并发**：同一 task_id 不应被两个 executor 同时拣选（dispatcher 锁的责任，不在本 Sprint 范围）
- **空 final**：若 invoke 返回 undefined / null，应走 failed 路径或保守 completed——按现有 PR 实现行为为准，本 Sprint 只验证不规定

## 范围限定

**在范围内**：
- 真实跑一条 harness_initiative 任务（最小可执行夹具），观察 `tasks.status` 是否回写
- 覆盖三条路径：成功、final.error 非空、invoke 抛异常
- 在 dispatcher tick 后再观察一次，确保任务不被回退到 `queued`

**不在范围内**：
- 修改 executor.js 自身逻辑（PR #2816 已修，本 Sprint 只验证）
- 其他 task_type（harness_planner / harness_proposer 等）的同类问题
- updateTaskStatus 自身失败场景的修复（属于另一个 Sprint）
- dispatcher 锁 / 并发派发问题
- result / error 字段格式契约

## 假设

- [ASSUMPTION: PR #2816 已合并到 main，executor.js 当前在 main 上即包含修复版本]
- [ASSUMPTION: Brain 数据库 tasks 表 schema 包含 `status` 字段，且取值为字符串枚举 `queued|in_progress|completed|failed`]
- [ASSUMPTION: 存在某种最小化方式构造一条可被 executor 真实 invoke 的 harness_initiative 任务（哪怕走 mock LangGraph），不需要完整跑 Planner→Proposer→Generator 全链路]
- [ASSUMPTION: 测试可在本地 docker-compose 起的 Brain + Postgres 上跑，不依赖远端]

## 预期受影响文件

- `packages/brain/src/__tests__/executor-harness-initiative-e2e.test.js`：新增端到端测试文件（成功 / 失败 / catch 三路径），跑真实 executor + 真实 Brain DB（或 in-memory 等价体），断言 `tasks.status` 终态
- `packages/brain/src/executor.js`：**只读**，本 Sprint 不修改
- 可能新增：`packages/brain/test-fixtures/harness-initiative-minimal.js` 或类似最小任务夹具（仅当现有夹具不足时）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 的 executor + 数据库回写，无 UI、无远端 agent、非开发流水线，纯 Brain 运行时行为
