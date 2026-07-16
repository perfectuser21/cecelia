# Sprint PRD — A8-2：新处置器 + S0 团灭恢复 + L1 链路补齐

- 日期：2026-07-16
- Sprint：A8-2（接 A8-1 分类器+路由骨架）
- 任务 ID：fe5c660f-db8d-4e8d-a5d7-d031acdbeaf1
- 挂靠 PRD：docs/prd/2026-07-15-self-healing-golden-path.prd.md §2 S3/S0、§6 切分第②刀

---

## Invariant 约束

**来自 PRD 第5节铁律（INV-01～05）：**
- INV-01：测试禁 mock 真实外部命令行为（A4/A5/A6 根因，EVA v3 口径）——L1 测试只 mock docker/gh/tmux 最外层
- INV-02：不改 attempt cap 数值与全局并发闸
- INV-03：OOM 升档最多一级（oom_upgraded 标记防二次）
- INV-04：分类器判不出 → 保守走现行路径（log_only + 普通重点火）
- INV-05：金丝雀任务打独立标记，禁污染真实任务统计（A8-2 不涉及，留 A8-3）
- INV-06（PRD §4）：死因分类日志可审计——每次收尸打 `cause=<分类> action=<处置> initiative=<id>`

**来自 A8-1 分类器的不变量：**
- INV-07：classifyDeath 纯函数，无副作用，无 async/fs/net/db
- INV-08：7 种 cause 枚举固定（oom / auth / rate_limit / interactive_stuck / ci_red / green_waiting_merge / unknown），新处置器不得新增 cause 字符串
- INV-09：classifyDeath 优先级顺序不变（exit 137 最高，fallback 兜底）

**来自 relay-watchdog 的安全约束：**
- INV-10：oom_upgraded=true + exit=137 → 禁止二次升档，走 oom_wall（现有 GP2，不触碰）
- INV-11：MAX_RELAY_ATTEMPTS=5（codex 路径 2），新处置器 rate_limit defer 不计入 attempt，blocked 不重点火
- INV-12：rate_limit defer 不调用 spawnFn（不烧 attempt）
- INV-13：auth 换号重点火须复用 resolveAccount() / selectBestAccount()，不自研选号逻辑
- INV-14：green_waiting_merge 收尾棒须复用 spawnSkillRelaySession()，加 opts.resume_stage='finish'

---

## 累积 FR

**A8-1 已有（不重新实现）：**
- FR-01：classifyDeath() 三源取证（exitCode + stdoutTail + tmuxPane），7 种 cause
- FR-02：watchdog 路由表骨架（classifyDeath 审计日志 + OOM 升档路由）
- FR-03：L1 串链测试框架（oom / ci_red / unknown 三条）

**A8-2 新增：**
- FR-04：auth 处置器——cause=auth → 换账号重点火（resolveAccount 复用，不自研选号）
- FR-05：auth 连续失败保护——同 initiative 连续 2 次 auth → task 标 blocked，Bark 告警附 codex-login 手册路径
- FR-06：rate_limit 处置器——不烧 attempt；task.payload 写 defer_until（取 Retry-After 头，取不到 +60min）；watchdog tick 在 defer_until 前跳过该 run
- FR-07：green_waiting_merge 处置器——PR OPEN + CI 绿 + 容器亡 → spawnSkillRelaySession(task, { resume_stage:'finish', pool })，prompt 前缀注明跳过 generator
- FR-08：interactive_stuck 处置器——kill tmux session + 普通重点火（计 attempt）
- FR-09：S0 宿主团灭恢复——startup-sync 阶段扫描全部 in_progress skill-relay 任务，容器已消失者批量调 classifyDeath 路由（防 OrbStack 嗝后集体干等）
- FR-10：L1 串链用例补齐至 7 条（覆盖 auth / rate_limit / green_waiting_merge / interactive_stuck 四条新路由 + S0）

---

## NFR

- NFR-01：watchdog 单次 tick 处理时延 ≤5s（rate_limit defer 判定为纯内存比较，不做额外网络调用）
- NFR-02：S0 批量扫描在 brain 启动后首次 tick 内完成（不阻塞后续 tick）
- NFR-03：auth blocked Bark 告警延迟 ≤30s

---

## 功能描述

### FR-04/05 auth 处置器

- **输入**：cause=auth，task（含 initiative_id、payload.CECELIA_CREDENTIALS）
- **处置**：
  1. 调 resolveAccount(opts, { taskId }) 换号（复用 account-rotation.js，opts.env.CECELIA_CREDENTIALS = 当前账号，isAuthFailed 标记触发换号逻辑）
  2. 调 markAuthFailed(currentAccount) 记录本次失败
  3. 查 task.payload.auth_fail_count（或 initiative 最近2次 run 的 cause=auth 记录）
  4. 若 auth_fail_count < 2 → spawnSkillRelaySession(task, { pool, env: { CECELIA_CREDENTIALS: newAccount } })
  5. 若 auth_fail_count ≥ 2 → UPDATE tasks SET status='blocked'；触发 Bark 告警（消息含 task.id、initiative_id、codex-login 手册路径 docs/runbooks/codex-login.md）
- **输出**：spawn 参数含新账号 | task.status='blocked' + Bark
- **错误路径**：selectBestAccount 无可用账号 → blocked + Bark（同连续失败路径）

### FR-06 rate_limit 处置器

- **输入**：cause=rate_limit，task，可选 Retry-After HTTP 头（存于 payload.retry_after_ts）
- **处置**：
  1. 不调 spawnFn（不消耗 attempt）
  2. 计算 defer_until：优先取 task.payload.retry_after_ts；取不到则 Date.now() + 60*60*1000
  3. UPDATE tasks SET payload = payload || '{"defer_until": <ts>}' WHERE id=$1
  4. 审计日志：cause=rate_limit action=rate_limit_defer defer_until=<iso> initiative=<id>
- **watchdog 跳过逻辑**：tick 内扫描 in_progress 任务时，若 payload.defer_until > Date.now() → continue（跳过，不重点火）
- **输出**：task.payload.defer_until 更新，本次 tick 不 spawn
- **错误路径**：defer_until 写库失败 → log error，不 throw（watchdog 继续处理下一任务）

### FR-07 green_waiting_merge 处置器

- **输入**：cause=green_waiting_merge，task（含 pr_url）
- **处置**：
  1. 验证 pr_url 存在且 PR 状态为 OPEN（调 gh pr view --json state）
  2. 验证 CI 全绿（复用 mapCiStatus，期望 'pass'）
  3. 调 spawnSkillRelaySession(task, { pool, resume_stage: 'finish' })
  4. prompt goal 前缀注明：skip generator, only judge→merge→report
- **输出**：新 run 行（phase=A_planning），spawn opts.resume_stage='finish'
- **错误路径**：pr_url 为空 / PR 已 MERGED / CI 仍 pending → log_only（不 spawn，不计 attempt）

### FR-08 interactive_stuck 处置器

- **输入**：cause=interactive_stuck，tmux session name（从 run 记录取）
- **处置**：
  1. execFn(`tmux kill-session -t <session>`)（容忍非零退出，session 已消失不报错）
  2. spawnSkillRelaySession(task, { pool })（普通重点火，计 attempt）
- **输出**：新 run 行，attempt+1
- **错误路径**：tmux kill 失败 → log warn，继续重点火

### FR-09 S0 宿主团灭恢复

- **触发时机**：brain startup-sync 阶段（server.js 启动时）
- **处置**：
  1. 查 SELECT t.*, r.* FROM tasks t JOIN initiative_runs r ON r.initiative_id=t.id WHERE t.status='in_progress' AND r.orchestrator_version='v2' AND r.phase NOT IN ('done','failed')
  2. 对每条 run：检查容器/session 是否存活（execFn docker/tmux has-session）
  3. 容器已消失 → classifyDeath({ exitCode: payload.last_container_exit_code, stdoutTail: payload.stdout_tail, tmuxPane: null }) → 走对应处置器路由
  4. 容器存活 → 跳过
- **输出**：批量触发死因分类+处置，审计日志每条打 source=startup-sync
- **错误路径**：单条任务处理失败 → log warn + continue（non-fatal，不阻塞后续 run 处理）

---

## 实现范围

| 文件 | 动作 | 说明 |
|------|------|------|
| `packages/brain/src/harness-relay-watchdog.js` | 修改 | 在死因分类路由段补充 auth/rate_limit/green_waiting_merge/interactive_stuck 四条 if 分支；新增 defer_until 跳过逻辑 |
| `packages/brain/src/harness-death-handlers.js` | 新建 | 四个处置器函数（handleAuth / handleRateLimit / handleGreenWaitingMerge / handleInteractiveStuck）；可测试的纯逻辑，副作用通过 deps 注入 |
| `packages/brain/src/startup-sync.js` | 新建或修改 | S0 批量扫描函数 scanOrphanedRelayTasks()，在 server.js 启动后调用 |
| `packages/brain/src/server.js` | 修改 | startup-sync 处调用 scanOrphanedRelayTasks()（一次性，异步不阻塞） |
| `packages/brain/src/__tests__/harness-death-chain.test.js` | 修改 | 补齐 auth / rate_limit / green_waiting_merge / interactive_stuck / s0 四条新链路用例（共 7 条） |

---

## 测试策略

**规则**：不 mock 被改的边（classifyDeath→处置器→spawn 参数→watchdog 判定真调用），只 mock docker/gh/tmux/Bark 最外层。必须先写 failing test 再写处置器代码。

**L1 串链用例（补齐至 7 条）：**

1. **oom**（A8-1 已有）：exit=137 首次 → cause=oom → spawn memoryTier=oom_upgrade → db 写 oom_upgraded=true
2. **ci_red**（A8-1 已有）：stdoutTail=CI_RED → cause=ci_red → spawn 无 memoryTier
3. **unknown**（A8-1 已有）：无特征 exitCode=1 → cause=unknown → 不触发 spawn
4. **auth 首次**（新增）：stdoutTail 含 401 → cause=auth → resolveAccount 换号 → spawn 带新 CECELIA_CREDENTIALS，auth_fail_count=1
5. **auth 连续2次 blocked**（新增）：auth_fail_count=2 → cause=auth → task.status='blocked' → Bark 告警触发 → spawn 不调用
6. **rate_limit defer**（新增）：stdoutTail 含 429 → cause=rate_limit → 不调 spawn → task.payload.defer_until 写入 ≥ Date.now()+3599000；再次 tick 时 defer_until 未到 → 跳过（continue）
7. **green_waiting_merge 收尾棒**（新增）：stdoutTail=GREEN_WAITING + PR OPEN + CI pass → cause=green_waiting_merge → spawnSkillRelaySession 调用且 opts.resume_stage='finish'

**补充用例（可合并进同文件）：**

8. **interactive_stuck kill+重点火**：tmuxPane 含 'Press Enter' → cause=interactive_stuck → tmux kill-session 调用 → spawn 调用且 attempt+1
9. **S0 startup-sync 团灭恢复**：2 条 in_progress run，容器消失 → scanOrphanedRelayTasks → 各自触发 classifyDeath → 路由正确（可验证 spawn 调用次数与参数）

---

journey_type: self-healing-chain
target_environment: local_api
