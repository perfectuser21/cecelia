# PRD: harness 子图等待逻辑三根因修复

## 背景

harness_initiative 连续失败（Line 07 a2463d95、Agent 模块化 b249b808）。实证三根因：

1. callback 超时（100min）排在 liveness 检查前，docker inspect 确认 running 的 generator
   被误杀（被判死时 worktree 已有 5 个真实 commit）；判死后容器不 kill 继续烧配额。
2. 容器内 OAuth 401 被当普通 container_exit，账号不熔断不轮换，fix round 同账号复发。
3. watchdog staleMinutes=3 过敏感，活驱动被 re-claim 5 次，并发 poller 的 90min deadline
   到期透传 status channel 默认值 'queued' → Serial gate 误判。

## 方案

- `_waitForSubGraphCompletion`：超时先验 liveness；running 且未到 hard ceiling
  （CECELIA_CALLBACK_HARD_TIMEOUT_MS，默认 240min）→ 继续等；超 hard ceiling →
  killContainerById（codex 跳过）+ resume failed；外层 deadline 同理且不再透传 queued。
- `awaitCallbackNode`：`_classifyCallbackFailure` 识别 401 → ci_fail_type='auth_failure'
  + markAuthFailure(state.accountId) 熔断轮换；routeAfterCallback 对 auth_failure 走 fix。
- watchdog staleMinutes 默认 3→10。

## 成功标准

- 三组 regression test 全绿（见 DoD），brain 套件无回归
- CI 全绿
