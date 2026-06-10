# 设计：harness 子图等待逻辑三根因修复

日期：2026-06-10
分支：cp-0610213046-harness-liveness-timeout-fix
关联：Issue 5a4faede-abb1-4568-a642-2fe9fc5ddd8f（P0）/ Brain Task bdc5f75a-2bf2-4ad0-a703-7958e6701e0f / Decision 5e5605ce

## 问题（实证）

最近 harness_initiative 连续失败，两种失败面相同根因簇：

- **Line 07（a2463d95，06-10）**：generator 容器 r1 活着且在干活（worktree 5 个真实
  commit），spawnedAt+100min 时被 `_waitForSubGraphCompletion` 的 callback_timeout
  fail-fast 判死（该检查排在 liveness 检查之前，docker inspect 结果被无视）。判死后
  容器不 kill（继续烧配额），已完成 commits 被丢弃。
- **同一 Run 内 r0**：跑 80 turns/$3.84 后 OAuth 401（"Failed to authenticate"），
  被当普通 `container_exit` 进 fix round；账号不标 auth-failed、不轮换。
- **Agent 模块化（b249b808，06-08）**：watchdog staleMinutes=3 过敏感，运行中父图被
  re-claim 5 次，产生并发 poller；外层 90min deadline 到期路径返回 status channel
  默认值 `'queued'`（harness-task.graph.js:120）→ Serial gate 判 "did not merge
  (status=queued)" 挂掉 initiative。

## 修法（三个独立 fix，一个 PR）

### Fix 1：liveness 感知的等待（harness-initiative.graph.js `_waitForSubGraphCompletion`）

- **callback_timeout 分支（:984-1007）**：触发前先调 `checkLiveness`。容器确认
  running → 不 fail，继续等待；容器死/不可达 → 走原 fail 路径。
- **新增 hard ceiling**：`CECELIA_CALLBACK_HARD_TIMEOUT_MS`（默认 240min，从持久化的
  `spawnedAt` 起算）。超过 hard ceiling 即使容器活着也放弃：先 `docker kill
  <containerId>`（仅 executor=claude；codex 远程跳过），再 resume failed
  （error='callback_hard_timeout'）。
- **外层 while deadline（:1051-1053）**：到期时若容器确认 running 且未到 hard
  ceiling → 延长等待（继续循环）；否则按现状返回。修掉 `'queued'` 透传问题：超时
  返回的 status 不再用 channel 默认值兜底成 queued（明确标 failed 或继续等）。
- **docker kill helper**：在 harness-container-cleanup.js 新增导出
  `killContainerById(containerId)`（容器以 `--name <containerId>` 启动，按名直杀），
  通过 `opts._killContainer` DI 注入测试。

### Fix 2：401 auth 分类 + 账号熔断（harness-task.graph.js）

- 抽纯函数 `_classifyCallbackFailure(payload)`（export，便于直接单测）：exit≠0 时
  检测 `payload.stdout` 含 `"api_error_status":401`、"Failed to authenticate"、
  "Invalid authentication credentials"（不区分大小写）→ 返回 `'auth_failure'`，
  否则 `'container_exit'`。
- `awaitCallbackNode`：用分类结果写 `ci_fail_type`；auth_failure 且
  `state.executor !== 'codex'` 且 `state.accountId` 非空 → 调
  `markAuthFailure(state.accountId)`（account-usage.js:186，注意函数名是
  markAuthFailure）。下一轮 spawn 的 resolveAccount 因 isAuthFailed 自动轮换账号。
- spawnNode 新增 state channel `accountId`（照 executor/daemonUrl 模式，
  harness-task.graph.js:107-112），值取 resolveAccount 后的
  `accountEnv.CECELIA_CREDENTIALS || null`（rotation 可能早退不写，需容 null）。

### Fix 3：watchdog 阈值（harness-watchdog.js:107）

- `staleMinutes` 默认 3→10。唯一生产调用方 tick-runner.js:395 不传参，改默认值即
  生效。同步更新 :94/:104 注释与测试文件头注释。

## 测试策略（unit 档，全部 DI，无真实 docker/DB）

1. **Fix 1**（workflows/__tests__/harness-subgraph-wait-failfast.test.js，纯 DI 模式）：
   - 新增：spawnedAt 超 CALLBACK_TIMEOUT 但 `_checkLiveness` 返回 null（活着）→
     不 fail，继续 poll；
   - 新增：spawnedAt 超 hard ceiling → `_killContainer` 被调用 + resume failed；
   - 新增：外层 deadline 到期 + 容器活着 → 不返回 queued；
   - **改写现有 :48-84 用例**（旧行为"活着也 callback_timeout fail"已被设计反转）。
2. **Fix 2**（新增 await-callback-auth.test.js）：直接单测
   `_classifyCallbackFailure`：401 JSON / Failed to authenticate / 普通 exit=1 三类；
   awaitCallbackNode 集成断言用 vi.mock('@langchain/langgraph') 先例
   （harness-task.graph.xian-spawn.test.js:38）验证 markAuthFailure 调用与 codex/null
   guard。
3. **Fix 3**（src/__tests__/harness-driver-heartbeat-watchdog.test.js，mockPoolQuery
   模式）：断言 SQL 参数为 `['10']`。

## 不做（YAGNI）

- 不动 GAN 无上限设计、不加 MAX_GAN_ROUNDS。
- 不改 interrupt() 节点为 throw（memory 明令禁止）。
- 不在本 PR 修 orphan-pr-worker 的 execSync 事件循环阻塞（已知潜在冻结源，
  watchdog 阈值加固已覆盖其症状；如复发另立 Issue）。
- 不实现"抢救未 push commits 续跑"（涉及 generator 协议改动，另立 Initiative）。

## 风险

- codex 远程 liveness 是 daemon 级粗判：Fix 1 后西安挂死任务最长占位 hard ceiling
  240min（原 100min），可接受。
- DoD：Brain 改动，需过 DevGate（facts-check / version sync / dod-mapping）。
