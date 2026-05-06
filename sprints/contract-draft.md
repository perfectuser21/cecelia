# Sprint Contract Draft (Round 1)

**Sprint**: MJ1 主理人开发闭环 Walking Skeleton 立骨架
**Initiative ID**: b10de974-85ca-40ab-91d6-2965f0824c9d
**Journey**: MJ1 · 主理人开发闭环（Type: dev_pipeline，Maturity: skeleton）
**KR 对齐**: KR3 — 管家闭环（主理人开发任务可视、可启动、KR 自动回写）

---

## Feature 1: 主理人在 Dashboard 一键启动开发任务（接任务 / F1）

**行为描述**:
主理人在 Dashboard 任务列表上点击 status=pending 的任务行的"开始开发"按钮，后端为该任务创建一份独立 worktree 与 cp-* 分支，task 状态从 pending 切到 in_progress，HTTP 响应体返回该 worktree 的物理路径与分支名，便于主理人跳过手敲 /dev。同一 task 任意多次再点击不允许重复创建——服务端必须以 409 直接拒绝且不更动 worktree、不重复改 task 状态。非 pending（已 in_progress / completed / failed）状态点击同样返回 409 拒绝。

**硬阈值**:
- 触发入口: `POST /api/brain/tasks/:id/start-dev`（无 body 或 body 仅含可选 metadata）
- Happy path 响应: HTTP 200，JSON `{worktree_path: string, branch: string}`，二者均非空、均非 null
- branch 字段满足正则 `^cp-` 前缀
- task.status 由 `pending` 转为 `in_progress`
- 重复调用同一 task → HTTP 409，**不**修改 task 行任何字段，**不**新建 worktree
- 非 pending 状态调用 → HTTP 409
- 端到端响应（不含网络）P95 < 3000ms（SC-001）
- Dashboard 仅对 status=pending 的任务行渲染"开始开发"按钮，按钮含 `data-testid="start-dev-button"` 便于 E2E 抓取

**BEHAVIOR 覆盖**（落到 `tests/ws1/start-dev-route.test.ts`）:
- `it('POST /tasks/:id/start-dev 路由已注册')`
- `it('happy path: pending task → 200 + {worktree_path, branch} 字段非空，branch 以 cp- 开头')`
- `it('happy path: task.status 由 pending 切到 in_progress（DB UPDATE 实际下发）')`
- `it('重复调用同一 task → 409，且不再调用 worktree 创建函数')`
- `it('非 pending 状态调用（in_progress/completed/failed）→ 409')`
- `it('worktree 创建失败时不修改 task.status')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws1.md`）:
- `packages/brain/src/routes/tasks.js` 中存在 `router.post('/tasks/:id/start-dev'`（或等价路径）的注册行
- `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx`（或等价 task 列表组件）出现 `data-testid="start-dev-button"`

---

## Feature 2: 任务完成后 KR 进度自动 +1%（回血回填 / F3）

**行为描述**:
当 callback-processor 收到一条 status=completed 的 task callback 且该 task 关联了 KR（kr_id 非空）、且 callback 携带 PR merge 信号（pr_url 非空且 PR 为 merged 状态）时，自动调用 progress-reviewer 把对应 KR 的 progress 字段加 1（thin 计数法），并封顶 100。task 无 kr_id 关联时，整段回血回填**完全跳过且不抛错**（不能因为缺字段把整个 callback 链条搞挂）。已经 100 的 KR 不能再继续累加。task 完成但 PR 未 merge（pr_url 为空或 PR 处于 open）时不触发 KR 更新。

**硬阈值**:
- 触发条件: callback `status === 'completed' && pr_url 非空 && task.kr_id 非空`
- 增量: `kr.progress = MIN(kr.progress + 1, 100)`
- 已 100 的 KR: progress 仍为 100，不再变化
- 无 kr_id 关联: callback-processor 完成正常状态切换流程，不抛异常、不调用 progress 增量函数
- callback 接收 → KR progress 落库延迟 P95 < 5s（SC-002）

**BEHAVIOR 覆盖**（落到 `tests/ws2/callback-kr-update.test.ts`）:
- `it('exports incrementKRProgressByOnePercent from progress-reviewer.js')`
- `it('completed task with kr_id (kr at 50) → KR progress 升至 51')`
- `it('completed task with kr_id (kr at 100) → KR progress 仍为 100，不溢出')`
- `it('completed task with kr_id (kr at 99) → KR progress 升至 100')`
- `it('completed task without kr_id → 不调用 incrementKRProgressByOnePercent，无异常')`
- `it('completed task without pr_url（PR 未 merge）→ 不调用 incrementKRProgressByOnePercent')`
- `it('callback-processor 在 task=completed + pr_url + kr_id 三齐全时调用 incrementKRProgressByOnePercent 一次')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws2.md`）:
- `packages/brain/src/progress-reviewer.js` 导出 `incrementKRProgressByOnePercent` 命名导出
- `packages/brain/src/callback-processor.js` 在 task=completed 分支引用 `incrementKRProgressByOnePercent`

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

**硬阈值**:
- 测试文件路径（最终目标）: `tests/e2e/mj1-skeleton-smoke.spec.ts`
- 测试文件包含 7 处独立 `it.step('step N: ...')` 或等价的 7 个连续 expect 块，每块前置 `// step N:` 注释
- 7 步顺序固定：Dashboard 点击 → start-dev → worktree → /dev mock → PR merge callback → KR +1% → LiveMonitor
- Step 6 严格断言 KR after === before + 1（thin 计数）

**BEHAVIOR 覆盖**（落到 `tests/ws5/mj1-skeleton-smoke.test.ts`）:
- `it('skeleton E2E covers 7 step path with step labels 1..7')`
- `it('step 1: Dashboard 任务列表行有 start-dev-button testid')`
- `it('step 2: POST /tasks/:id/start-dev → 200 + {worktree_path, branch}')`
- `it('step 3: worktree 路径在文件系统上真实存在')`
- `it('step 4: /dev mock 简化版被调用一次（runDevMock 调用计数 === 1）')`
- `it('step 5: callback-processor 接收到 task=completed + pr_url 的 callback')`
- `it('step 6: KR progress 从 X 升至 X+1')`
- `it('step 7: LiveMonitor WebSocket 收到至少一条 status 变化事件')`

**ARTIFACT 覆盖**（落到 `contract-dod-ws5.md`）:
- `tests/e2e/mj1-skeleton-smoke.spec.ts` 文件存在
- 该文件出现 `step 1:` / `step 2:` / ... / `step 7:` 共 7 处 step 标识

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
| WS1 | `tests/ws1/start-dev-route.test.ts` | route 注册 / happy path / status 切换 / 重复 409 / 非 pending 409 / worktree 失败回滚 | `npx vitest run sprints/tests/ws1/` → 6 failures |
| WS2 | `tests/ws2/callback-kr-update.test.ts` | 函数导出 / +1 / 100 封顶 / 99→100 / 无 kr 跳过 / 无 pr_url 跳过 / callback 接通调用计数 | `npx vitest run sprints/tests/ws2/` → 7 failures |
| WS3 | `tests/ws3/verify-kr-movement.test.ts` | 函数导出 / true / false / null / keys 集合 / 类型 | `npx vitest run sprints/tests/ws3/` → 6 failures |
| WS4 | `tests/ws4/livemonitor-events.test.ts` | publishTaskDispatched 导出 / broadcast 计数 / payload 字段 / 同步性 / WS_EVENTS.TASK_DISPATCHED 声明 | `npx vitest run sprints/tests/ws4/` → 5 failures |
| WS5 | `tests/ws5/mj1-skeleton-smoke.test.ts` | 7 step 标识齐全 / 各 step 断言 | `npx vitest run sprints/tests/ws5/` → 8 failures |

合计预期红: **32** failures（覆盖 5 个 workstream 全部 BEHAVIOR）。

---

## Red Evidence（Proposer 本地跑测试结果，Round 1）

执行命令：

```bash
cd /workspace
npx vitest run --config ./.harness-vitest.config.ts
```

聚合结果：

```
Test Files  5 failed (5)
      Tests  32 failed (32)
```

逐 workstream Red count（实际值与预期一致）：

| Workstream | 测试文件 | it 总数 | 实际 FAIL |
|---|---|---|---|
| WS1 | `tests/ws1/start-dev-route.test.ts` | 6 | 6 |
| WS2 | `tests/ws2/callback-kr-update.test.ts` | 7 | 7 |
| WS3 | `tests/ws3/verify-kr-movement.test.ts` | 6 | 6 |
| WS4 | `tests/ws4/livemonitor-events.test.ts` | 5 | 5 |
| WS5 | `tests/ws5/mj1-skeleton-smoke.test.ts` | 8 | 8 |
| **合计** | — | **32** | **32** |

Red 原因摘要：
- WS1: `start-dev` 路由不存在 → `findHandler` 返回 undefined；mock worktree 创建函数从未被调用；DB UPDATE 计数为 0
- WS2: `incrementKRProgressByOnePercent` 未在 `progress-reviewer.js` 中导出；`callback-processor.js` 源代码 grep 不到该函数引用
- WS3: `verifyKRMovement` 未在 `kr-verifier.js` 中导出
- WS4: `publishTaskDispatched` 未在 `events/taskEvents.js` 中导出；`websocket.js` 的 `WS_EVENTS` 缺少 `TASK_DISPATCHED`
- WS5: `tests/e2e/mj1-skeleton-smoke.spec.ts` 文件本身不存在（spec 由 Generator 阶段创建）

完整 Red 日志：`/tmp/all-red-v2.log`（reproducible by re-running命令）。

