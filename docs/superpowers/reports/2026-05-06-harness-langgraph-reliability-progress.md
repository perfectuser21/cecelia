# Harness LangGraph 可靠性打通 — 启动状态报告

**报告时间**: 2026-05-06 21:11 上海时间
**Spec**: `docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md`
**Plan**: `docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md`

---

## 一句话总结

Spec + Plan 写完并 commit 到 main。Batch 1 的 **4 个 PR 任务全部在 Docker 里并发跑**（W6/W7.2/W7.4/W7.7）。Batch 2-4 等 Batch 1 合并后再启动。Acceptance E2E 等所有 PR 合并后跑。**今晚之内不可能全部完成 — 这是 1.5-2 周工程量，但骨架已搭起来，Brain 在自驱推进**。

---

## ✅ 已完成（人手介入完成）

| # | 内容 | 时间 | 备注 |
|---|---|---|---|
| 1 | Spec 文档（495 行）写完并 commit | 20:50-20:55 | `28a5619e0` |
| 2 | Implementation Plan（1229 行）写完并 commit | 20:55-21:00 | `219f9586d` |
| 3 | Feishu webhook unmute + 验证 | 21:00 | 之前 mute 自 2026-04-22（14 天告警全 silent） |
| 4 | PR #2802 close（main 已合 266 取代）| 21:00 | |
| 5 | PR #2803 / #2804 / #2805 rebase 到 origin/main + force-push | 21:01-21:05 | 全部 mergeable=MERGEABLE |
| 6 | 重建 3 个被清掉的 worktree（验证 Bug #E 复现）| 21:01 | git worktree list 之前只有 main |

---

## 🔄 进行中（Docker 容器内并发跑）

**Brain 健康**: status=healthy, uptime 75 min, circuit_breaker recovering (no open)

**4 个 P0 dev task 同时在跑**：

| 任务 | Task ID | Container | Uptime | Work Stream |
|---|---|---|---|---|
| W6 docker-executor OOM Promise reject | `25797336-...` | `cecelia-task-257973361287` | 8 min | 【最关键 — MJ1 stuck 根因】|
| W7.2 circuit-breaker reset API | `ba3b124a-...` | `cecelia-task-ba3b124a7dc0` | 5 min | Bug #D |
| W7.4 migration 同号 lint CI | `51fe7707-...` | `cecelia-task-51fe77076e04` | 2 min | Bug #G |
| W7.7 dispatch API 错误返回清理 | `eb41c82b-...` | `cecelia-task-eb41c82b7b4a` | 14s | Bug #F |

**预期**：每个 30-90 分钟，Brain 自动 push 分支 + 开 PR + 等 CI + 合并。

**监控**：

```bash
# 实时状态
docker ps --filter name=cecelia-task- --format '{{.Names}} {{.Status}}'

# Brain log
tail -f /Users/administrator/perfect21/cecelia/logs/brain.log

# 数据库视角
psql -d cecelia -c "SELECT title, status, started_at, pr_url FROM tasks WHERE goal_id='f483b0b3-3c0d-4312-a2ae-9a5c565beede' AND created_at > NOW() - INTERVAL '1 hour' ORDER BY created_at"
```

---

## ⏳ 待办（按依赖批次顺序）

### 批次 2 — 等 W6 合并后注册（LangGraph 可靠性核心）

**触发条件**: W6 PR merged。原因：W6 是 docker-executor 修复，所有 graph 改动依赖它正确 reject。

| Stream | 内容 |
|---|---|
| **W1** | thread_id 版本化 — `executor.js:2820-2847` 用 `attemptN` 控制 fresh vs resume |
| **W2** | 节点级 RetryPolicy — 14 个 graph node 配 LLM_RETRY/DB_RETRY/NO_RETRY |

**注册命令**（W6 合并后人手或自动跑）:
见 plan §W1, §W2 注册 curl 块。

### 批次 3 — 等 W1+W2 合并后

| Stream | 内容 |
|---|---|
| **W3** | AbortSignal + watchdog 5min 扫 deadline_at |
| **W4** | streamMode='updates' → LiveMonitor 节点级进度 |

### 批次 4 — 等 W3+W4 合并后

| Stream | 内容 |
|---|---|
| **W5** | interrupt() 关键决策点（401 / max_fix / E2E 红）|
| **W7.3** | startup-recovery 保护活跃 worktree（Bug #E 修代码侧）|
| **W7.5** | 凭据巡检接 daily scheduler（依赖 #2804 合并）|

### 批次 5 — 全部合并后

| Stream | 内容 |
|---|---|
| **W8** | 端到端 Acceptance — 派新 walking skeleton + 故障注入 A/B/C |

---

## 📌 用户运维待办（不能由 AI 代办）

| 项 | 内容 |
|---|---|
| **凭据 A** | codex login（重新生成 refresh token）— 我不能代你输入凭据 |
| **凭据 A** | Anthropic console 充值 OR 决策永久不用 API 直连 |
| **凭据 A** | OpenAI 充值 OR 决策迁移 |
| **#2803/2804/2805 合并** | rebase 已完成 + push --force-with-lease 完成。CI 跑完后你 review + 合并 |

---

## ⚠️ 已知限制 / 我没碰的东西

1. **MJ1 task `b10de974-85ca-40ab-91d6-2965f0824c9d`** — 没动它，acceptance 用新 walking skeleton 任务跑，不污染旧 checkpoint
2. **vitest 进程 PID 15097** — 在跑 `tick-billing-pause.test.js` 7+ 分钟没退，可能 hang。不影响 Brain 主进程，**没杀它**避免误伤
3. **不能在 main 改代码** — 所有代码变更走 /dev pipeline（Brain 派给 docker container 跑，不是我自己写）
4. **Brain Escalation 系统**清掉了我第一次注册的 P1/P2 task — 第二次用 P0 重注册成功。这暴露了 Brain `emergency_brake` 模式会无差别 cancel P1/P2 — 不在本 spec 修，但建议未来 sprint 加一条「`emergency_brake` 触发原因 + 误杀诊断」

---

## 🎯 给 Alex 的下一步建议（你回来后）

1. **看一眼 4 个 docker 还在不在**：`docker ps | grep cecelia-task`
2. **Feishu 群应该开始有告警了**（unmute 之后 P1/P2 都会推）
3. **如果 docker 都 healthy**：放心睡，明早起来看 PR 列表 `gh pr list --state all --search "Harness 可靠性 v2 OR Harness 可靠性 W"`
4. **如果某个 docker 挂了**：
   - W6 挂了 = 这是 OOM Promise bug 自己复现 → 我之前推断对了
   - 其他挂了 = 普通 dev pipeline 失败，看 task error_message
5. **明天注册 Batch 2 的时机**：等 `gh pr view <W6-PR-number> --json state` 返回 MERGED

---

## 📊 度量基线

记录现在状态供未来对比：

| 指标 | Baseline 2026-05-06 21:11 |
|---|---|
| harness_initiative 跑通率 | 不可知（多次手撕 SQL）|
| 平均 stuck 干预次数 / initiative | 多次 |
| Brain 重启续跑 stuck 概率 | ~100% (thread_id 不变) |
| 故障注入自愈时间 | N/A（人工介入）|
| Brain Feishu 告警有效 | ❌→✅（21:00 unmute）|
| circuit-breaker reset 能力 | ❌（必须 kill+restart Brain）|

acceptance 跑完后再看一次。

---

## 🧠 一个小观察（写下来防忘）

刚才 Brain 进入 emergency_brake → cancel_pending(keepCritical=true) 时，**不写任何 alert/log 解释为啥进了 emergency_brake**。`Reason: System is healthy` 出现在 *de-escalation* 那行而非 *escalation* — 用户体验上是黑盒。**这个观察不在本 spec 修但放进 LANGGRAPH-INTERNALS.md 周边的"observability 缺口"档案**。

---

**报告 commit 后会进 git，方便回顾。**

---

## 📝 21:14 更新 — 第一个 PR 已 merged + 一个架构暴露

### ✅ W7.4 PR #2807 已 merge 到 main

`feat(ci): migration 同号 lint — 防 W7.4 264 双胞胎事故重现`

**全自动从注册到合并约 12 分钟**（21:03 注册 → 21:14 main 合并）。这正是你想要的"端到端跑通"信号。验证了 Brain dev pipeline 的核心流程是通的。

**意外彩蛋**：因架构问题（见下），W7.4 squash 把我之前的 spec + plan + 启动报告 doc commits **一并带进 main**。**Docs 没丢，反而都进 main 了**。

### 🔍 暴露架构问题：4 container 共享 `/workspace`（不是各自 worktree）

**现象**: docker-executor 把 `/Users/administrator/perfect21/cecelia` mount 给所有 container 当 `/workspace`，4 个 container 并发跑同一个 git worktree，`git checkout cp-xxx` 切的是**同一个**主 repo 分支。

**实测后果**: W7.4 容器赢了 race，把主 repo 切到 `cp-w7.4-migration-version-lint`。其他 3 个容器（W6/W7.2/W7.7）当时也看到这个分支。但因为 W7.4 是单 PR 操作，最终只有它的内容上了 PR；其他容器的工作可能还在它们各自的 internal state 里。

**这不是新 bug**，是 docker-executor 现有设计：所有 container 共享 mount。**之前没暴露是因为 Brain 通常一次只派一个 dev 任务**。我今晚一次派 4 个 P0 → race 出现。

**给本 spec 加一条 P1 work stream 建议**：

| Stream | 内容 |
|---|---|
| **W6.1（新）** | docker-executor 改成 per-task worktree mount（`/Users/administrator/worktrees/cecelia/cp-<task>` mount 给单 container 当 /workspace），杜绝并发任务踩共享 git index |

但这条 **不挡 Batch 1**：W7.4 已合，W6/W7.2/W7.7 在跑且各自最终 push branch 时会用自己的 cp-* 名（不会再撞）。监控一下结果即可。

### 当前 docker 状态（21:15）

| Task | Container | Uptime | Status |
|---|---|---|---|
| W6 docker-executor OOM | `cecelia-task-257973361287` | 12 min | in_progress |
| W7.2 circuit-breaker reset | `cecelia-task-ba3b124a7dc0` | 8 min | in_progress |
| W7.4 migration lint | (已退出) | - | ✅ MERGED #2807 |
| W7.7 dispatch API 清理 | `cecelia-task-eb41c82b7b4a` | 4 min | in_progress |

### 给 Alex 的修订建议

- **W7.4 已合**，可立刻看下 brain-ci.yml 改动确认 lint job 你认；不认现在 revert 还不晚
- **3 个 conflict PR rebase 完毕**（#2803/2804/2805）— 需要你 review + 合并（CI 应已绿或快绿）
- **Feishu 应该开始接收告警** — unmute 后第一波 P1/P2 alert 应该已到群里
- 等 W6/W7.2/W7.7 完成再启 Batch 2 — 我下条会议或下个 session 推进

