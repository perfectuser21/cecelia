# Sprint Contract Draft (Round 2)

**Sprint**: MJ1 主理人开发闭环 Walking Skeleton 立骨架
**Initiative ID**: b10de974-85ca-40ab-91d6-2965f0824c9d
**Journey**: MJ1 · 主理人开发闭环（Type: dev_pipeline，Maturity: skeleton）
**KR 对齐**: KR3 — 管家闭环（主理人开发任务可视、可启动、KR 自动回写）

## Round 2 修订总览（处理 Round 1 Reviewer 反馈）

| 反馈点 | 落地位置 | 措施摘要 |
|---|---|---|
| ① WS5 E2E 不应依赖物理 worktree / 真实 KR DB；上游红时应 cascade FAIL | WS5 行为/硬阈值/BEHAVIOR/ARTIFACT | E2E spec 文件必须 mock 上游接口（`createWorktree` / db pool / `processExecutionCallback` / `publishTaskDispatched`），合同阶段对 spec 文本结构作 grep 检测；Generator 阶段 E2E 跑前先看 WS1-WS4 全绿，否则跳过判 cascade FAIL |
| ② WS2 并发风险（同 KR 双 completed 丢更新） | WS2 行为/硬阈值/BEHAVIOR/ARTIFACT | 实现必须为单语句原子 `UPDATE … SET progress = LEAST(progress+1, 100) WHERE id = $1`；BEHAVIOR 加一条并发计数（mock pool 看到两次 UPDATE 调用且 SQL 模式正确）；ARTIFACT grep `LEAST` 表达式 |
| ③ WS1 worktree 在 CI 失败 | WS1 行为/硬阈值/BEHAVIOR | worktree 创建抛错 → handler 返回 500 + task.status 保持 `pending`；BEHAVIOR 在原"worktree 创建失败时不修改 task.status"基础上补 500 状态码断言；ARTIFACT 加 try/catch 文本检测 |
| ④ WS2 callback 重放幂等 | WS2 行为/硬阈值/BEHAVIOR/ARTIFACT | callback-processor 处理 `status=completed` 前先校验当前 task.status 是否已是 `completed`（DB 读到的当前值），是则 short-circuit 不再调用 `incrementKRProgressByOnePercent`；BEHAVIOR 加一条重放调用计数=1；ARTIFACT grep `already.*completed` 或等价幂等短路文本 |

---

## Feature 1: 主理人在 Dashboard 一键启动开发任务（接任务 / F1）

**行为描述**:
主理人在 Dashboard 任务列表上点击 status=pending 的任务行的"开始开发"按钮，后端为该任务创建一份独立 worktree 与 cp-* 分支，task 状态从 pending 切到 in_progress，HTTP 响应体返回该 worktree 的物理路径与分支名，便于主理人跳过手敲 /dev。同一 task 任意多次再点击不允许重复创建——服务端必须以 409 直接拒绝且不更动 worktree、不重复改 task 状态。非 pending（已 in_progress / completed / failed）状态点击同样返回 409 拒绝。**[Round 2 修订]** 当 worktree 创建函数抛错（CI 环境无 git worktree 权限 / 磁盘满 / 目录冲突等）时，handler 必须 try/catch 包裹该调用，对外返回 HTTP 500 且 task.status 保持 `pending`（绝不能在 worktree 失败后让 task 处于"已 in_progress 但无 worktree"的孤儿态）。

**硬阈值**:
- 触发入口: `POST /api/brain/tasks/:id/start-dev`（无 body 或 body 仅含可选 metadata）
- Happy path 响应: HTTP 200，JSON `{worktree_path: string, branch: string}`，二者均非空、均非 null
- branch 字段满足正则 `^cp-` 前缀
- task.status 由 `pending` 转为 `in_progress`（仅在 worktree 创建成功后才 UPDATE）
- 重复调用同一 task → HTTP 409，**不**修改 task 行任何字段，**不**新建 worktree
- 非 pending 状态调用 → HTTP 409
- **[Round 2 修订]** worktree 创建抛错 → HTTP 500，task.status 仍为 `pending`，且响应 body 不抛裸异常 stack（仅返回安全的错误概述，例如 `{error: 'worktree_create_failed'}`）
- 端到端响应（不含网络）P95 < 3000ms（SC-001）
- Dashboard 仅对 status=pending 的任务行渲染"开始开发"按钮，按钮含 `data-testid="start-dev-button"` 便于 E2E 抓取

**BEHAVIOR 覆盖**（落到 `tests/ws1/start-dev-route.test.ts`）:
- `it('POST /tasks/:id/start-dev 路由已注册')`
- `it('happy path: pending task → 200 + {worktree_path, branch} 字段非空，branch 以 cp- 开头')`
- `it('happy path: task.status 由 pending 切到 in_progress（DB UPDATE 实际下发）')`
- `it('重复调用同一 task → 409，且不再调用 worktree 创建函数')`
- `it('非 pending 状态调用（completed）→ 409')`
- `it('worktree 创建失败时不修改 task.status')`
- **[Round 2 新增]** `it('worktree 创建失败 → HTTP 500 且响应 body 不含未脱敏 stack')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/tasks.js` 中存在 `router.post('/tasks/:id/start-dev'`（或等价路径）的注册行
- `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx`（或等价 task 列表组件）出现 `data-testid="start-dev-button"`
- **[Round 2 新增]** `packages/brain/src/routes/tasks.js` start-dev handler 区段含 `try` / `catch` 关键字（错误隔离结构，防止裸异常冒到 Express）

---

## Feature 2: 任务完成后 KR 进度自动 +1%（回血回填 / F3）

**行为描述**:
当 callback-processor 收到一条 status=completed 的 task callback 且该 task 关联了 KR（kr_id 非空）、且 callback 携带 PR merge 信号（pr_url 非空且 PR 为 merged 状态）时，自动调用 progress-reviewer 把对应 KR 的 progress 字段加 1（thin 计数法），并封顶 100。task 无 kr_id 关联时，整段回血回填**完全跳过且不抛错**（不能因为缺字段把整个 callback 链条搞挂）。已经 100 的 KR 不能再继续累加。task 完成但 PR 未 merge（pr_url 为空或 PR 处于 open）时不触发 KR 更新。

**[Round 2 修订 — 并发原子性]** `incrementKRProgressByOnePercent(krId)` 必须用单语句原子 SQL 自增 + 封顶（不允许"先 SELECT 再 UPDATE"的 read-modify-write 模式），形如 `UPDATE key_results SET progress = LEAST(progress + 1, 100) WHERE id = $1 RETURNING progress`，避免两条 task 同时 completed 触发同一 KR 时丢更新。

**[Round 2 修订 — 重放幂等]** callback-processor 在执行回血逻辑前必须先校验当前 task 在 DB 里的 status：若该 task 当前 DB status 已是 `completed`（说明这是同一 callback 的重复投递 / PR webhook 重放），则 short-circuit 直接返回，不再调用 `incrementKRProgressByOnePercent`，确保同一 task 的 KR 进度只会 +1 一次。幂等键 = `(task.id, task.status === 'completed')`。

**硬阈值**:
- 触发条件: callback `status === 'completed' && pr_url 非空 && task.kr_id 非空 && DB 中 task.status !== 'completed'（首次抵达）`
- 增量 SQL 形态: 单语句 `UPDATE … SET progress = LEAST(progress + 1, 100) WHERE id = $1 …`，**禁止**先 SELECT 后 UPDATE
- 已 100 的 KR: progress 仍为 100，不再变化（由 SQL `LEAST` 表达式保证）
- 无 kr_id 关联: callback-processor 完成正常状态切换流程，不抛异常、不调用 progress 增量函数
- **[Round 2 新增]** 重复 callback（同一 task.id，DB.status 已是 completed）→ 不调用 `incrementKRProgressByOnePercent`，不再次 UPDATE KR
- callback 接收 → KR progress 落库延迟 P95 < 5s（SC-002）

**BEHAVIOR 覆盖**（落到 `tests/ws2/callback-kr-update.test.ts`）:
- `it('exports incrementKRProgressByOnePercent from progress-reviewer.js')`
- `it('completed task with kr_id (kr at 50) → KR progress 升至 51')`
- `it('completed task with kr_id (kr at 100) → KR progress 仍为 100，不溢出')`
- `it('completed task with kr_id (kr at 99) → KR progress 升至 100')`
- `it('completed task without kr_id → 不调用 incrementKRProgressByOnePercent，无异常')`
- `it('completed task without pr_url（PR 未 merge）→ 不调用 incrementKRProgressByOnePercent')`
- `it('callback-processor 在 task=completed + pr_url + kr_id 三齐全时调用 incrementKRProgressByOnePercent 一次')`
- **[Round 2 新增]** `it('incrementKRProgressByOnePercent 使用单语句原子 SQL（含 LEAST(...,100) 表达式，无前置 SELECT）')`
- **[Round 2 新增]** `it('两次并发调用 incrementKRProgressByOnePercent 触发两条独立 UPDATE 调用（不依赖中间 SELECT 状态）')`
- **[Round 2 新增]** `it('callback 重放幂等：同一 task DB.status 已是 completed → 不再调用 incrementKRProgressByOnePercent')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws2.md`）:
- `packages/brain/src/progress-reviewer.js` 导出 `incrementKRProgressByOnePercent` 命名导出
- `packages/brain/src/callback-processor.js` 在 task=completed 分支引用 `incrementKRProgressByOnePercent`
- **[Round 2 新增]** `packages/brain/src/progress-reviewer.js` 含 `LEAST(` 字面量（原子 SQL 表达式锚点）
- **[Round 2 新增]** `packages/brain/src/callback-processor.js` 含幂等短路文本（`already.*completed` 或等价英文/中文注释 + 早返回逻辑）

---

## Feature 3: KR 推进三态评估函数 verifyKRMovement（评估好坏 / F2）

**行为描述**:
对外暴露同步函数 `verifyKRMovement(taskId)`（async，从 DB 读取该 task 关联 KR 的当前 progress 与 task 完成前快照对比）。返回结构固定为 `{kr_id, before, after, moved}`，moved 字段只有三种合法值：`true`（after > before，KR 真在动）、`false`（after === before，task 完成但 KR 没动）、`null`（task 没有 KR 关联，无法评估）。before/after 类型必须是 number，no-KR 场景两者均为 null。

**硬阈值**:
- 函数签名: `async function verifyKRMovement(taskId: string): Promise<{kr_id: string|null, before: number|null, after: number|null, moved: boolean|null}>`
- moved=true 当且仅当 after > before（严格大于）
- moved=false 当且仅当 after === before（严格相等，含 0===0）
- moved=null 当且仅当 task.kr_id 为空（before/after 同为 null）
- 返回对象**正好**包含 4 个 key：`kr_id`/`before`/`after`/`moved`，无多余字段

**BEHAVIOR 覆盖**（落到 `tests/ws3/verify-kr-movement.test.ts`）:
- `it('exports verifyKRMovement from kr-verifier.js')`
- `it('after > before → moved=true（before=50, after=51 → moved=true）')`
- `it('after === before → moved=false（before=50, after=50 → moved=false）')`
- `it('task 无 kr_id → moved=null, before=null, after=null')`
- `it('返回对象 keys 严格为 [kr_id, before, after, moved] 四个，无多余字段')`
- `it('before 与 after 在有 kr_id 时类型均为 number')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws3.md`）:
- `packages/brain/src/kr-verifier.js` 导出 `verifyKRMovement` 命名导出

---

## Feature 4: LiveMonitor 看到任务实时进度（前端可见 / F4）

**行为描述**:
当 task 发生关键状态切换（dispatch / in_progress / completed | failed），后端在状态变更的同一函数调用栈内同步触发 WebSocket broadcast，确保 LiveMonitor 客户端在 P95 < 10s 内看到该状态变化。新增 `publishTaskDispatched(task)` 用于派发瞬间的事件推送（之前缺失）。三类状态推送共用相同的事件 payload schema（含 taskId/runId/status/timestamp）。

**硬阈值**:
- 函数清单: `publishTaskDispatched(task)`、`publishTaskStarted(task)`、`publishTaskCompleted(taskId, runId, result)` 全部存在并被导出
- publishTaskDispatched 触发后 broadcast 调用次数 +1
- 三个 publish 函数的 broadcast payload 都含 `taskId`、`runId`、`status` 三个字段（status 分别为 'dispatched'、'running'、'completed'）
- publish 调用相对状态变更触发点的同步延迟 < 50ms（thin 阶段以"同步路径无 setTimeout/queueMicrotask 间接"为准）

**BEHAVIOR 覆盖**（落到 `tests/ws4/livemonitor-events.test.ts`）:
- `it('exports publishTaskDispatched from events/taskEvents.js')`
- `it('publishTaskDispatched(task) 调用 broadcast 一次，event 类型为 TASK_DISPATCHED')`
- `it('publishTaskDispatched payload 包含 taskId/runId/status，status==="dispatched"')`
- `it('publishTaskDispatched 调用是同步的（不延迟到下一个 microtask 之外）')`
- `it('WS_EVENTS.TASK_DISPATCHED 在 websocket.js 中已声明')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws4.md`）:
- `packages/brain/src/events/taskEvents.js` 导出 `publishTaskDispatched` 命名导出
- `packages/brain/src/websocket.js` 的 `WS_EVENTS` 常量含 `TASK_DISPATCHED` key

---

## Feature 5: F0 端到端 7 step E2E smoke（Walking Skeleton 验收 / F0）

**行为描述**:
单条端到端测试用例，假定一条 hardcode 关联 KR3 的最简 task 已存在，主理人按"开始开发"后必须把 7 步全走通且每步在测试报告中以"step N"明确标识。Step 1 校验 Dashboard 入口 testid 存在；Step 2 校验 start-dev endpoint 200 + worktree_path/branch 返回；Step 3 校验 worktree 物理目录已创建；Step 4 校验 /dev mock 简化版的执行回调（mock 简化版只关心被调一次，**不**关心真实 Generator-Evaluator 链）；Step 5 校验 PR merge callback 被 callback-processor 收到；Step 6 校验 KR progress +1（before/after 对比）；Step 7 校验 LiveMonitor WebSocket 渠道收到至少一条 task 状态变化事件。

任何单步红 = E2E FAIL。E2E 跑通但 KR 未 +1（Step 5 通而 Step 6 红）= 数据不一致 → 仍判 FAIL。

**[Round 2 修订 — E2E 不依赖物理资源]** E2E spec 文件 `tests/e2e/mj1-skeleton-smoke.spec.ts` 必须以"上游接口替身"的方式跑通，**不依赖物理 worktree、不依赖真实 KR DB、不依赖真实 PR 远端**：
- `createWorktree` 用 `vi.mock` 替身（返回固定 `{worktree_path, branch}`，避免 CI 无 git worktree 权限）
- DB pool 用 `vi.mock` 替身（KR before/after 走 mock 返回值，避免依赖 PG 实例）
- `processExecutionCallback` 用 `vi.mock`/spy（避免触发真实业务链）
- `publishTaskDispatched` / WebSocket broadcast 用 `vi.mock` 替身（避免依赖运行中的 WS server）
- Step 3 "worktree 路径在文件系统上真实存在" 改为校验 mock 返回值的 path 字段非空（保留语义，去除物理依赖）

**[Round 2 修订 — Cascade FAIL 策略]** Generator 阶段实际跑 E2E 之前，先看 WS1-WS4 的 BEHAVIOR 测试是否全绿。任意一个 workstream 标红 → 直接判该 sprint **cascade FAIL**，跳过 E2E 阶段（避免上游模块缺失导致的 E2E 噪声）。Reviewer/Evaluator 看到上游红时不应再追究 E2E 的具体红点。

**硬阈值**:
- 测试文件路径（最终目标）: `tests/e2e/mj1-skeleton-smoke.spec.ts`
- 测试文件包含 7 处独立 `it.step('step N: ...')` 或等价的 7 个连续 expect 块，每块前置 `// step N:` 注释
- 7 步顺序固定：Dashboard 点击 → start-dev → worktree → /dev mock → PR merge callback → KR +1% → LiveMonitor
- Step 6 严格断言 KR after === before + 1（thin 计数）
- **[Round 2 新增]** spec 源代码出现 `vi.mock(` 至少 3 处（覆盖 worktree / db / callback-processor 上游模块），即 grep `vi\.mock\(` 命中 ≥ 3
- **[Round 2 新增]** spec 源代码出现 `createWorktree` 与 `processExecutionCallback` 字面量（证明这两个上游模块被 mock）
- **[Round 2 新增]** Step 3 校验文本由 `existsSync` 改为对 mock 返回值的 `worktree_path` 字段断言（spec 中含 `worktree_path` 引用 + 字段非空断言，不强制 `existsSync` 出现）

**BEHAVIOR 覆盖**（落到 `tests/ws5/mj1-skeleton-smoke.test.ts`）:
- `it('skeleton E2E covers 7 step path with step labels 1..7')`
- `it('step 1: Dashboard 任务列表行有 start-dev-button testid')`
- `it('step 2: POST /tasks/:id/start-dev → 200 + {worktree_path, branch}')`
- `it('step 3: worktree 路径在 mock 返回值中非空（不依赖物理 fs）')`
- `it('step 4: /dev mock 简化版被调用一次（runDevMock 调用计数 === 1）')`
- `it('step 5: callback-processor 接收到 task=completed + pr_url 的 callback')`
- `it('step 6: KR progress 从 X 升至 X+1')`
- `it('step 7: LiveMonitor WebSocket 收到至少一条 status 变化事件')`
- **[Round 2 新增]** `it('E2E spec 含 vi.mock 调用至少 3 处（覆盖 worktree / db / callback-processor 上游）')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws5.md`）:
- `tests/e2e/mj1-skeleton-smoke.spec.ts` 文件存在
- 该文件出现 `step 1:` / `step 2:` / ... / `step 7:` 共 7 处 step 标识
- **[Round 2 新增]** 该文件出现至少 3 处 `vi.mock(` 调用
- **[Round 2 新增]** 该文件含 `createWorktree` 与 `processExecutionCallback` 字面量（证明 mock 了上游接口）

---

## Workstreams

workstream_count: 5

### Workstream 1: F1 接任务（start-dev endpoint + Dashboard 按钮）

**范围**: 新增 `POST /api/brain/tasks/:id/start-dev` handler，调用现有 worktree 创建逻辑；Dashboard task 列表行加"开始开发"按钮（含 testid），仅对 status=pending 任务渲染。
**大小**: M（路由 handler ~80 行 + 前端按钮 ~40 行 + DB 状态切换 ~20 行）
**依赖**: 无
**BEHAVIOR 覆盖测试文件**: `tests/ws1/start-dev-route.test.ts`

### Workstream 2: F3 回血回填（callback → KR +1%）

**范围**: 在 progress-reviewer.js 新增 `incrementKRProgressByOnePercent(krId)`；callback-processor.js 的 task=completed 分支判断 pr_url+kr_id 后调用该函数。
**大小**: S（thin 计数函数 ~30 行 + callback 接通 ~15 行）
**依赖**: 无
**BEHAVIOR 覆盖测试文件**: `tests/ws2/callback-kr-update.test.ts`

### Workstream 3: F2 评估好坏（verifyKRMovement 三态）

**范围**: 在 kr-verifier.js 新增 `verifyKRMovement(taskId)` 异步函数，返回 `{kr_id, before, after, moved}` 四态。
**大小**: S（~50 行）
**依赖**: 无
**BEHAVIOR 覆盖测试文件**: `tests/ws3/verify-kr-movement.test.ts`

### Workstream 4: F4 前端可见（LiveMonitor 事件推送）

**范围**: 在 events/taskEvents.js 新增 `publishTaskDispatched(task)` 与 `WS_EVENTS.TASK_DISPATCHED`；在 task 状态切换处接通三类 publish 调用。
**大小**: S（~40 行）
**依赖**: 无
**BEHAVIOR 覆盖测试文件**: `tests/ws4/livemonitor-events.test.ts`

### Workstream 5: F0 7 step E2E smoke

**范围**: 编写 `tests/e2e/mj1-skeleton-smoke.spec.ts` 端到端测试，覆盖 7 step 完整路径（step 标识必须显式可见）。允许 mock 真实 /dev 与 PR merge 远端步骤。
**大小**: M（~150 行）
**依赖**: WS1 / WS2 / WS3 / WS4 全部完成（E2E 必须等四件套接通后才能跑绿）
**BEHAVIOR 覆盖测试文件**: `tests/ws5/mj1-skeleton-smoke.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/start-dev-route.test.ts` | 路由注册 / happy path / status 切换 / 重复 409 / 非 pending 409 / worktree 失败回滚 / **worktree 失败 → 500 不漏 stack（R2 新增）** | `npx vitest run sprints/tests/ws1/` → 7 failures |
| WS2 | `tests/ws2/callback-kr-update.test.ts` | 函数导出 / +1 / 100 封顶 / 99→100 / 无 kr 跳过 / 无 pr_url 跳过 / callback 接通调用计数 / **原子 SQL 模式（R2 新增）** / **并发独立 UPDATE（R2 新增）** / **重放幂等（R2 新增）** | `npx vitest run sprints/tests/ws2/` → 10 failures |
| WS3 | `tests/ws3/verify-kr-movement.test.ts` | 函数导出 / true / false / null / keys 集合 / 类型 | `npx vitest run sprints/tests/ws3/` → 6 failures |
| WS4 | `tests/ws4/livemonitor-events.test.ts` | publishTaskDispatched 导出 / broadcast 计数 / payload 字段 / 同步性 / WS_EVENTS.TASK_DISPATCHED 声明 | `npx vitest run sprints/tests/ws4/` → 5 failures |
| WS5 | `tests/ws5/mj1-skeleton-smoke.test.ts` | 7 step 标识齐全 / 各 step 断言 / **spec 含 vi.mock 上游 ≥ 3 处（R2 新增）** | `npx vitest run sprints/tests/ws5/` → 9 failures |

合计预期红: **37** failures（覆盖 5 个 workstream 全部 BEHAVIOR；Round 2 新增 5 条强约束测试）。

---

## Red Evidence（Proposer 本地跑测试结果，Round 2）

执行命令：

```bash
cd /workspace
npx vitest run sprints/tests/ws1 sprints/tests/ws2 sprints/tests/ws3 sprints/tests/ws4 sprints/tests/ws5 --reporter=verbose
```

聚合结果（来自 `/tmp/round2-red.log`）：

```
Test Files  5 failed (5)
      Tests  37 failed (37)
```

逐 workstream Red count（实际值与预期一致）：

| Workstream | 测试文件 | it 总数 | 实际 FAIL |
|---|---|---|---|
| WS1 | `tests/ws1/start-dev-route.test.ts` | 7 | 7 |
| WS2 | `tests/ws2/callback-kr-update.test.ts` | 10 | 10 |
| WS3 | `tests/ws3/verify-kr-movement.test.ts` | 6 | 6 |
| WS4 | `tests/ws4/livemonitor-events.test.ts` | 5 | 5 |
| WS5 | `tests/ws5/mj1-skeleton-smoke.test.ts` | 9 | 9 |
| **合计** | — | **37** | **37** |

Red 原因摘要：
- WS1: `start-dev` 路由不存在 → `findHandler` 返回 undefined；mock worktree 创建函数从未被调用；DB UPDATE 计数为 0；R2 新增"500 不漏 stack"测试因 handler 不存在直接红
- WS2: `incrementKRProgressByOnePercent` 未在 `progress-reviewer.js` 中导出；`callback-processor.js` 源代码 grep 不到该函数引用；R2 新增 3 条（原子 SQL / 并发 / 重放幂等）因函数缺失或源码缺幂等短路文本而红
- WS3: `verifyKRMovement` 未在 `kr-verifier.js` 中导出
- WS4: `publishTaskDispatched` 未在 `events/taskEvents.js` 中导出；`websocket.js` 的 `WS_EVENTS` 缺少 `TASK_DISPATCHED`
- WS5: `tests/e2e/mj1-skeleton-smoke.spec.ts` 文件本身不存在（spec 由 Generator 阶段创建）；R2 新增"spec 含 vi.mock ≥ 3 处"同样因文件不存在而红

完整 Red 日志：`/tmp/round2-red.log`（reproducible by re-running 命令）。

### Round 2 修订 — 防假绿措施

Round 2 调整时发现一处假绿风险并已修复：
"重放幂等"测试如果只断言 `expect(incrementMock).not.toHaveBeenCalled()`，在实现完全缺失（callback-processor 根本不调用增量函数）时也会自动通过（vacuously true）。已加入两条 Red 锚点（`expect(cbSrc).toMatch(/incrementKRProgressByOnePercent/)` 与 `expect(cbSrc).toMatch(/already.*completed|status === 'completed'/)`）确保测试在缺失实现时一定红。本次本地跑测试 37/37 全红已验证此修复有效。

