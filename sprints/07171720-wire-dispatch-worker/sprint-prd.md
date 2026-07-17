# Sprint PRD: wire-dispatch-worker
<!-- task_id: 1f50b6ac-8076-47c5-bff6-cc6bdb79bcd1 -->
<!-- sprint_dir: sprints/07171720-wire-dispatch-worker -->
<!-- generated: 2026-07-17 -->

## 背景与目标

将 `dispatch-worker.mjs`（跨账号 headless worker，2026-07-16 实测链路）接入
`packages/brain/src/harness-skill-relay.js` 的 executor 白名单，使
`payload.executor='worker-pool'` 的 harness_initiative 任务能通过 dispatch-worker 自动
选号（查余量 → 择优 → 撞墙换号），而非降为缺省 codex 路径。

## Invariant 约束

三源（brain invariants / task-router 限制 / 现有测试约定）：

- [brain-invariant] **核心任务铁律**：`base_repo=cecelia` 且合同改动路径含 `packages/brain/src` 的 harness_initiative 任务，禁止 `executor=worker-pool`（亦禁 codex）派发；违者在派发侧（task-router/executor 层）以 `feedback_no_core_tasks_to_codex` 口径拒绝，标 terminal_failed，不回滚重试。
- [brain-invariant] **不改 dispatch-worker 已实测链路**：`scripts/dispatch-worker.mjs` 的 `buildCommand` / `dispatchWithRotation` / `queryUsage` / `pickAccounts` 不做功能改动（07-16 链路实测已验证，禁想当然改它）。
- [task-router] **白名单外 executor 值拒绝**：`spawnSkillRelaySession` 接收到 `executor` 非 `claude` / `codex` / `undefined` / `null` / `worker-pool` 时，应抛出或返回错误，不静默降级。
- [task-router] **headed 分支保持只支持 claude/codex**：`_spawnHeadedSession` 的 `headedExecutor` 判断不改动，`worker-pool` 不进入 headed 分支。
- [existing-test] **进程内 codex 并发守门（_activeCodexRelays）**：`worker-pool` 路径不计入 `_activeCodexRelays` 计数器（独立链路，独立额度管理）。
- [existing-test] **Grok 首跑限非核心低危**：`vendor=grok` 的候选账号在 `pickAccounts` 中作为余量最低优先级候选，首轮 worker-pool 任务不应主动指定 `vendor=grok`（依靠 Infinity usedPercent 自然垫底）。

## 累积 FR

（本 line 当前无已验收 worker-pool 相关 FR；以下为本 sprint 首次落地）

- FR-1: `payload.executor='worker-pool'` → `spawnSkillRelaySession` 识别并走 dispatch-worker 路径（非 codex / claude 路径）。
- FR-2: dispatch-worker 路径调用 `node scripts/dispatch-worker.mjs --brief <prompt文件> --dir <worktreePath>`，brief 内容与现有 relay prompt 格式（skill 全文 + 上下文头）一致。
- FR-3: dispatch-worker 执行完毕后，`initiative_runs` 落行 `orchestrator_host='skill-relay-worker-pool'`，`phase='A_planning'`，`deadline=6h`。
- FR-4: 核心任务护栏：task-router / executor 层检测到 `base_repo=cecelia && 改动路径含 packages/brain/src` + `executor=worker-pool`，以 `feedback_no_core_tasks_to_codex` 口径拒绝，不进入 dispatch-worker。
- FR-5: 白名单外 executor 值（如 `executor='unknown-bot'`）被拒绝并返回明确错误（现有回归不退）。
- FR-6: `worker-pool` 路径的账号选择日志（`pickAccounts` 结果 + 实际使用账号）在 `.dispatch-worker-*.log` 和 relay console 中可见。

## NFR

- 宿主直跑优先（dispatch-worker 已在宿主上实测），容器模式仅在 `process.env.DISPATCH_WORKER_IN_DOCKER` 显式设置时走容器路径；两者均不改动 dispatch-worker 内部实现。
- spawn 失败回滚：与现有 `worker-pool` 路径的 B4 回滚对齐——spawn 失败 → task 回滚 queued，不落 initiative_runs。
- 测试禁 mock dispatch-worker 真实调用边：`dispatchWithRotation` / `buildCommand` / `queryUsage` 不允许被 stub 为 no-op；允许 stub `runWorker`（实际 spawn 子进程）以避免真实网络请求，但账号选择逻辑必须真实执行。

## 测试计划（Failing-First）

### T1: worker-pool executor 路由（现 failing）
- 构造 `task.payload.executor='worker-pool'`、非核心 base_repo（如 `zenithjoy`）
- 调用 `spawnSkillRelaySession(task, deps)`（注入 fake spawnFn）
- 断言：当前版本走缺省 codex 路径（`deps.spawnFn` 被调用且 env.CECELIA_EXECUTOR='codex'）→ **failing**
- 接线后断言：`dispatch-worker.mjs` 被调用（deps 注入 dispatchWorkerFn 被调用），日志含账号选择记录

### T2: 核心任务护栏（回归）
- `base_repo='/Users/administrator/perfect21/cecelia'` + `executor='worker-pool'` + 合同改动路径含 `packages/brain/src/tick.js`
- 断言：任务被 terminal_failed，reason 含 `feedback_no_core_tasks_to_codex`，不进入 dispatch-worker

### T3: 白名单外 executor 值拒绝（回归）
- `task.payload.executor='unknown-bot'`
- 断言：返回 `{ ok: false, error: ... }`，不调用任何 spawnFn

### T4: 真实 worker-pool 全链验收（behavior_test）
- 发一条非核心低危任务（如 `task_type='dev'`，`base_repo='zenithjoy'`，`executor='worker-pool'`）
- 观测：`dispatch-worker` 日志出现账号选择记录（vendor/name/usedPercent），任务执行原文可见

## 验收标准

1. T1 先 failing 后 passing（commit 顺序保证）
2. T2/T3 回归全绿
3. T4 真实全链跑通：`.dispatch-worker-*.log` 含账号选择行 + 执行原文，`initiative_runs.orchestrator_host='skill-relay-worker-pool'`
4. CI `brain-ci.yml` 绿

---

journey_type: feature
target_environment: brain
