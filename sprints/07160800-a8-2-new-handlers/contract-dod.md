# DoD 检查清单 — A8-2：新处置器 + S0 团灭恢复

- Sprint：A8-2
- 任务 ID：fe5c660f-db8d-4e8d-a5d7-d031acdbeaf1
- 对应合同：contract-draft.md

---

## DoD 检查清单

### BEHAVIOR 条目（功能行为断言）

[BEHAVIOR-1] auth 首次换号重点火：cause=auth + auth_fail_count<2 → 调用 markAuthFailed(currentAccount) → 通过 resolveAccount/selectBestAccount 选出 newAccount（newAccount !== currentAccount）→ spawnFn 被调用1次，opts.env.CECELIA_CREDENTIALS === newAccount
（对应 FR-04，INV-13）

[BEHAVIOR-2] auth 连续 blocked：cause=auth + auth_fail_count≥2 → spawnFn 未被调用 → task.status='blocked' 写库 → barkFn 被调用1次且消息含 'blocked' 和 'codex-login'
（对应 FR-05，INV-11）

[BEHAVIOR-3] rate_limit defer 写库：cause=rate_limit + payload.retry_after_ts 为空 → spawnFn 未被调用 → dbQuery SQL 含 defer_until → 写入值 ≥ Date.now()+3599000（≈60min，±5min 容忍）
（对应 FR-06，INV-12）

[BEHAVIOR-4] rate_limit defer 跳过：payload.defer_until = Date.now()+30*60*1000（未到期）→ watchdog tick 对该 run 执行 continue → spawnFn 未被调用 → dbQuery 无状态变更写入
（对应 FR-06 watchdog 跳过逻辑）

[BEHAVIOR-5] green_waiting_merge 收尾棒：cause=green_waiting_merge + pr_url 存在 + PR OPEN + CI pass → spawnFn 被调用1次 → opts.resume_stage === 'finish'
（对应 FR-07，INV-14）

[BEHAVIOR-6] interactive_stuck kill+重点火：cause=interactive_stuck → execFn 含 'kill-session' → spawnFn 被调用1次（attempt+1）
（对应 FR-08）

[BEHAVIOR-7] S0 startup-sync 批量恢复：2条 in_progress run 容器已消失 → scanOrphanedRelayTasks() → classifyDeath 真实路由 → spawnFn 被调用次数 = 非 blocked/rate_limit 的 run 数（按分类结果）
（对应 FR-09）

---

### CONSTRAINT 条目（铁律绑定断言）

[CONSTRAINT-INV01] mock 范围限制：L1 测试只 mock docker/gh/tmux/Bark 最外层接口；classifyDeath、处置器路由条件、spawn 参数构造不得 mock，必须真实执行

[CONSTRAINT-INV02] attempt 不变：rate_limit defer 不调 spawnFn，不写 attempt_count，dbQuery 中不含 attempt 字段变更

[CONSTRAINT-INV06] 审计日志：每次处置必须打日志行，格式含 `cause=<> action=<> initiative=<id>`；S0 路径额外含 `source=startup-sync`

[CONSTRAINT-INV08] cause 枚举固定：新处置器不得引入任何新 cause 字符串（仅限 oom/auth/rate_limit/interactive_stuck/ci_red/green_waiting_merge/unknown）

[CONSTRAINT-INV11] attempt cap 不变：auth blocked 时 spawnFn 不被调用；rate_limit defer 时 spawnFn 不被调用；两者均不增加 attempt_count

[CONSTRAINT-INV12] rate_limit 不烧 attempt：BEHAVIOR-3 和 BEHAVIOR-4 测试均断言 spawnFn.mock.calls.length === 0

[CONSTRAINT-INV13] auth 换号复用 resolveAccount：BEHAVIOR-1 测试通过注入 deps.resolveAccount stub 验证调用；不允许手写选号逻辑

[CONSTRAINT-INV14] green_waiting_merge 复用 spawnSkillRelaySession：BEHAVIOR-5 测试验证 spawnFn 调用时 opts.resume_stage==='finish'，不得绕过

---

### 文件交付物

- [ ] `packages/brain/src/harness-death-handlers.js` — 新建，含 handleAuth/handleRateLimit/handleGreenWaitingMerge/handleInteractiveStuck 四函数，副作用通过 deps 注入
- [ ] `packages/brain/src/harness-relay-watchdog.js` — 修改，路由段补 auth/rate_limit/green_waiting_merge/interactive_stuck 四条分支 + defer_until 跳过逻辑
- [ ] `packages/brain/src/startup-sync.js` — 新建或修改，含 scanOrphanedRelayTasks()
- [ ] `packages/brain/src/server.js` — 修改，startup-sync 处调用 scanOrphanedRelayTasks()（异步非阻塞）
- [ ] `packages/brain/src/__tests__/harness-death-chain.test.js` — 修改，补齐 7+2 条用例（共9条）
- [ ] `sprints/07160800-a8-2-new-handlers/tests/harness-death-handlers.contract.test.js` — 合同测试骨架（Red 占位）

---

### NFR 验收

- [ ] NFR-01：watchdog 单次 tick 处理时延 ≤5s（rate_limit defer 为纯内存比较，不做额外网络调用）
- [ ] NFR-02：S0 批量扫描在 brain 启动首次 tick 内完成（非阻塞）
- [ ] NFR-03：auth blocked Bark 告警延迟 ≤30s

---

manual:bash cd /workspace && npx vitest run packages/brain/src/__tests__/harness-death-chain.test.js sprints/07160800-a8-2-new-handlers/tests/ --reporter=verbose 2>&1 | tail -30
