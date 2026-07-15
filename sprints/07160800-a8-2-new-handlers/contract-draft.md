# 合同草案 — A8-2：新处置器 + S0 团灭恢复

- Sprint：A8-2
- 任务 ID：fe5c660f-db8d-4e8d-a5d7-d031acdbeaf1
- 挂靠 PRD：sprints/07160800-a8-2-new-handlers/sprint-prd.md
- 起草日期：2026-07-15

---

## 功能行为描述

### 处置器一：auth 换号重点火（FR-04）

**输入**：
- `classifyDeath()` 返回 `cause=auth`（stdoutTail 含 401/403/unauthorized/invalid api key/credentials）
- `task.payload.auth_fail_count` < 2（或 initiative 近2次 run 无 auth 记录）
- `task.payload.CECELIA_CREDENTIALS` = currentAccount（当前失效账号）

**行为**：
1. 调用 `markAuthFailure(currentAccount)` 将当前账号写入熔断 Map（防下次再选到它）
2. 调用 `resolveAccount(opts, { taskId })` / `selectBestAccount()` 选出 newAccount（不等于 currentAccount）
3. 调用 `spawnSkillRelaySession(task, { pool, env: { CECELIA_CREDENTIALS: newAccount } })`
4. 打审计日志 `cause=auth action=auth_retry initiative=<id>`

**状态迁移**：task.status 保持 `in_progress`，initiative_runs 新增一行，attempt+1

**输出**：spawn 被调用一次，opts.env.CECELIA_CREDENTIALS !== currentAccount

**错误路径**：`selectBestAccount()` 返回 null（无可用账号）→ 走 blocked 路径（同连续失败）

---

### 处置器二：auth 连续失败 blocked（FR-05）

**输入**：
- `cause=auth`
- `task.payload.auth_fail_count` ≥ 2（或 initiative 已连续2次 auth fail）

**行为**：
1. 不调用 `spawnFn`（不烧 attempt）
2. `UPDATE tasks SET status='blocked' WHERE id=$1`
3. 调用 `barkFn()` 发出告警，消息含：
   - `task.id`
   - `initiative_id`
   - 手册路径 `docs/runbooks/codex-login.md`
   - 关键词 `blocked`、`codex-login`
4. 打审计日志 `cause=auth action=auth_blocked initiative=<id>`

**状态迁移**：task.status: `in_progress` → `blocked`

**输出**：task.status='blocked'，Bark 告警已发，spawnFn 未被调用

---

### 处置器三：rate_limit defer（FR-06）

**输入**：
- `cause=rate_limit`（stdoutTail 含 429/quota/rate limit/overloaded/too many requests）
- `task.payload.retry_after_ts` 可为空

**行为**：
1. 不调用 `spawnFn`（不烧 attempt，INV-11/INV-12）
2. 计算 `defer_until`：优先取 `task.payload.retry_after_ts`，取不到则 `Date.now() + 60*60*1000`
3. `UPDATE tasks SET payload = payload || '{"defer_until": <ts>}' WHERE id=$1`
4. 打审计日志 `cause=rate_limit action=rate_limit_defer defer_until=<iso> initiative=<id>`

**watchdog 跳过逻辑**：
- tick 扫描 in_progress 任务时，若 `task.payload.defer_until > Date.now()` → `continue`（跳过，不触发处置）
- defer_until 到期后自然参与下次 tick 的正常重点火路径

**状态迁移**：task.status 保持 `in_progress`，task.payload 写入 defer_until

**输出**：`task.payload.defer_until` 已写库，本次 tick 未调用 spawnFn

**错误路径**：defer_until 写库失败 → log error，不 throw（watchdog 继续下一任务，non-fatal）

---

### 处置器四：green_waiting_merge 收尾棒（FR-07）

**输入**：
- `cause=green_waiting_merge`（stdoutTail 含 GREEN_WAITING）
- `task.payload.pr_url` 存在
- PR 状态为 OPEN（`gh pr view --json state` 验证）
- CI 全绿（`mapCiStatus` 返回 'pass'）

**行为**：
1. 验证 `pr_url` 存在且 PR OPEN
2. 验证 CI 全绿
3. 调用 `spawnSkillRelaySession(task, { pool, resume_stage: 'finish' })`
4. prompt goal 前缀注明 "skip generator, only judge→merge→report"
5. 打审计日志 `cause=green_waiting_merge action=await_merge initiative=<id>`

**状态迁移**：task.status 保持 `in_progress`，initiative_runs 新增一行（phase=A_planning，resume_stage='finish'）

**输出**：spawn 被调用一次，`opts.resume_stage === 'finish'`

**错误路径**：pr_url 为空 / PR 已 MERGED / CI 仍 pending → `log_only`（不 spawn，不计 attempt）

---

### 处置器五：interactive_stuck kill+重点火（FR-08）

**输入**：
- `cause=interactive_stuck`（tmuxPane 含 Press Enter/press esc/choose/select/[y/n]）
- tmux session name（从 run 记录取）

**行为**：
1. 调用 `execFn('tmux kill-session -t <session>')` — 容忍非零退出（session 已消失不报错）
2. 调用 `spawnSkillRelaySession(task, { pool })` — 普通重点火，计 attempt
3. 打审计日志 `cause=interactive_stuck action=kill_refire initiative=<id>`

**状态迁移**：attempt+1，initiative_runs 新增一行

**输出**：execFn 含 `kill-session`，spawnFn 被调用一次

**错误路径**：tmux kill 失败 → log warn，继续重点火（non-fatal）

---

### 处置器六：S0 宿主团灭恢复（FR-09）

**输入**：
- Brain startup-sync 阶段触发
- DB 中 `tasks.status='in_progress'` 且关联 `initiative_runs.orchestrator_version='v2'` 且 `phase NOT IN ('done','failed')`

**行为**：
1. `scanOrphanedRelayTasks()` 查询全部满足条件的 in_progress run
2. 对每条 run：检查容器/session 是否存活（`execFn docker ps` / `tmux has-session`）
3. 容器已消失 → `classifyDeath({ exitCode, stdoutTail, tmuxPane: null })` → 走对应处置器路由
4. 容器存活 → 跳过
5. 每条处置打审计日志 `source=startup-sync cause=<> action=<> initiative=<id>`

**状态迁移**：按各自 cause 路由，批量触发处置器

**输出**：orphan run 逐一被分类处置，spawnFn 按分类结果被调用（oom/auth_first → spawn，blocked/rate_limit → 不 spawn）

**错误路径**：单条任务处理失败 → log warn + continue（non-fatal，不阻塞后续 run）

---

## E2E 验收

> 因本 sprint 全为 headless 调度逻辑（无 UI 交互、无视频/媒体输出、无外部平台发布），
> E2E 验收以 L1 串链测试（vitest）为准，不需要 Playwright/浏览器驱动。

**E2E 验收标准**：

```bash
# 完整 L1 串链测试（7条主链 + 2条补充用例）必须全绿
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-death-chain.test.js \
  sprints/07160800-a8-2-new-handlers/tests/ \
  --reporter=verbose 2>&1 | tail -30
```

**验收断言（技术可验证）**：

1. **auth 首次** — spawnFn 调用1次，`spawn._calls[0].opts.env.CECELIA_CREDENTIALS !== currentAccount`（新账号与旧账号不同）
2. **auth blocked** — spawnFn 调用0次，barkFn 调用1次，消息含 'blocked' 和 'codex-login'，task.status='blocked'
3. **rate_limit** — spawnFn 调用0次，dbQuery SQL 含 `defer_until`，写入值 ≥ Date.now()+3599000
4. **defer 跳过** — 再次 tick 时 defer_until 未到期，spawnFn 调用0次，dbQuery 无状态写入
5. **green_waiting_merge** — spawnFn 调用1次，`spawn._calls[0].opts.resume_stage === 'finish'`
6. **interactive_stuck** — execFn 含 'kill-session'，spawnFn 调用1次
7. **S0 批量** — 2条 orphan run，spawnFn 被调用次数与非-blocked 分类数一致

---

## 未覆盖真实链路清单

以下链路在 L1 测试中以 mock/stub 替代，豁免说明如下：

| 链路 | Mock 范围 | 豁免理由 |
|------|-----------|---------|
| `docker ps` / `docker inspect` | execFn stub | 无真实 Docker 守护进程，容器不存在 |
| `gh pr view --json state` | execFn stub 或 vi.mock | 无 GitHub 凭据，需测试环境外部 |
| `tmux has-session` / `tmux kill-session` | execFn stub | 测试环境无 tmux session |
| Bark HTTP 推送 | barkFn stub（vi.fn） | 无 Bark token，告警属外部副作用 |
| DB PostgreSQL 真实写入 | dbPool stub（makeDbStub） | 无测试数据库，测试 SQL 参数正确性即可 |
| `spawnSkillRelaySession` 真实 spawn | spawnFn stub | 避免测试创建真实容器，验证参数即可 |

**未 mock 的边（真实调用）**：
- `classifyDeath()`（纯函数，必须真实调用，INV-01/INV-07）
- 处置器路由条件判断逻辑（cause 分支）
- spawn 参数构造（env.CECELIA_CREDENTIALS、resume_stage 等）
- auth_fail_count 判定逻辑

---

## 铁律符合性确认

| 铁律 | 合同对应覆盖 |
|------|------------|
| INV-01：L1 测试只 mock docker/gh/tmux/Bark 最外层 | 未覆盖真实链路清单已列出所有 mock 点 |
| INV-02：不改 attempt cap 与全局并发闸 | rate_limit defer 不计 attempt，blocked 不 spawn |
| INV-03：OOM 升档最多一级 | A8-1 已有，A8-2 不触碰 |
| INV-04：分类器判不出 → 保守路径 | unknown → log_only，沿用 A8-1 |
| INV-05：金丝雀标记 | A8-3 再处理，A8-2 不涉及 |
| INV-06：死因分类日志可审计 | 每个处置器均打 cause= action= initiative= |
| INV-07：classifyDeath 纯函数 | 不修改分类器，处置器在路由层调用 |
| INV-08：7种 cause 枚举固定 | 新处置器不新增 cause 字符串 |
| INV-09：classifyDeath 优先级不变 | 不修改分类器代码 |
| INV-10：oom_upgraded=true 禁二次升档 | A8-1 已有，A8-2 不触碰 |
| INV-11：MAX_RELAY_ATTEMPTS=5 | blocked 不重点火，rate_limit 不计 attempt |
| INV-12：rate_limit defer 不调 spawnFn | 处置器三行为描述明确 |
| INV-13：auth 换号复用 resolveAccount/selectBestAccount | 处置器一行为描述第2步 |
| INV-14：green_waiting_merge 复用 spawnSkillRelaySession + resume_stage='finish' | 处置器四行为描述第3步 |
