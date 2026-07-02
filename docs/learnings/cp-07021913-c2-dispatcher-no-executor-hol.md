# C-2: dispatcher no_executor 静默失败 + 队头阻塞（HOL）

Issue: 0014cd42 ｜ 分支: cp-0702191321-c2-dispatcher-hol

## 现象

cecelia-bridge（host:3457）掉线时，队头一个需要 bridge 的 harness_intervention
反复占位，不需要 bridge 的 harness_initiative（豁免 bridge check）被堵死 13 小时。
且 no_executor 只写 working_memory / decision_log，无 console 日志，完全静默。

### 根本原因

`dispatchNextTask` 的候选选择循环只包住 pre-flight / codex-pool HOL skip，
而 `checkCeceliaRunAvailable()`（bridge check）在循环之外、候选 claim 成功之后执行。
bridge 不可用时 revert + 释放 claim 后**直接 return {reason:'no_executor'}**，
不回到候选循环试下一个 → 队头任务形成 Head-of-Line 阻塞。加上该路径没有任何
tickLog，故障 13 小时无人察觉。

### 修复

1. 外层 `dispatchLoop` 把「claim 后的 bridge check」纳入候选重选：no_executor 时
   revert + 记入 `noExecutorSkipIds`，回循环选下一候选；跳过次数上限复用
   `MAX_SKIP_HEAD_FOR_BLOCKED`（10）防无限循环；全部候选耗尽/达上限时最终仍
   return no_executor（与旧行为一致）。
2. circuit_breaker / cortex / retired / harness 并发上限等分支保持原
   「直接 return 让位」语义不变；fabf6bd6 的 post-claim 异常兜底抽成
   `postClaimException` 供两段 try 共用，语义不变。
3. 可观测性：每次 no_executor 跳过、达上限、队列耗尽、pool_exhausted /
   pool_c_full / user_team_mode 最终 return 前各加一行 tickLog。
4. Regression tests：`src/__tests__/dispatcher-hol-skip.test.js`（5 用例，
   修前全红）永久进 CI。

### 下次预防

- [ ] dispatcher 任何「revert 后直接 return」的新分支，先问：是否会造成队头阻塞？
      能跳过就跳过（记 skipIds 回循环），必须让位的写明理由注释。
- [ ] 任何 dispatch 失败终态（return dispatched:false）必须至少一行 tickLog，
      禁止只写 working_memory / decision_log 的静默失败。
- [ ] 涉及「候选选择 + claim + 可用性检查」的重构，跑齐 dispatcher-*.test.js
      全家桶（claim-leak / circuit-exempt / hol / executor-fail / dedup 等 11 个文件）。
