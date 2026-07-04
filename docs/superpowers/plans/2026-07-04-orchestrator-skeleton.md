# T2 orchestrator 骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。
> SSOT：docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md（v2，含 12 条对抗修订）+ docs/current/harness-orchestration-redesign/routing-extraction.md。**实现语义一律以这两个文件为准**，本 plan 只定切分/顺序/验收。

**Goal:** packages/brain/src/orchestrator/ 骨架：纯函数层（derive/gates/counters）+ IO 薄层（ground-truth/decision-log/heartbeat）+ loop/run 入口 + 全分支单测。

**Architecture:** reconcile loop（外部真相驱动），LLM 只在 dispatcher（注入，T3 实现，本任务 fake）。

**Tech Stack:** Node ESM（跟 packages/brain 现有风格）/ vitest / pg（复用 ../db.js pool）

**Global Constraints:**
- derive.js/gates.js/counters.js 禁 Date.now()/Math.random()/new Date(（有守卫测试）
- 每个模块一个职责一个文件；测试放 packages/brain/src/orchestrator/__tests__/
- TDD：每个 plan task 内 commit-1 = failing tests(Red)，commit-2 = 实现(Green)
- 常量集中 constants.js：MAX_FIX_ROUNDS=20 / MAX_POLL_COUNT=20 / POLL_INTERVAL_MS=90000 / MAX_NO_PUSH_STREAK=2 / MAX_NO_VERDICT_STREAK=3 / MAX_REBASE_ATTEMPTS=3 / MAX_HOPS=200 / BLOCKED_SAME_STATE_CAP=2 / BUDGET_CAP_USD=10（全部照抄旧图数值，出处见 routing-extraction）

### Task A: 纯函数核心 derive.js + gates.js + constants.js
**Files:** Create packages/brain/src/orchestrator/{constants.js,derive.js,gates.js}；Test __tests__/{derive.test.js,gates.test.js,determinism.test.js}
**Interfaces (Produces):**
- `derive(observed) → {phase, action, reason}`——observed schema 与 action 枚举照 spec §推导语义/§action 枚举
- `mergeGate({evaluateVerdict, judgeVerdict, prHeadSha, reviewRequired, reviewApproved}) → {allow, reason}`（verdict 对象含 {verdict, pr_head_sha}，sha 不匹配=拒）
- `caps` 各上限判断纯函数
**Steps:** 写 failing tests（spec 测试策略 §1/§2/§5 全清单）→ 验证全红 → commit-1 → 实现 → 全绿 → commit-2
验收：derive 覆盖 spec 推导表 0-5 每条规则+守护；gates 覆盖 mergeGate 全分支+stale sha 拒绝。

### Task B: counters.js + decision-log.js + heartbeat.js
**Files:** Create {counters.js,decision-log.js,heartbeat.js}；Test __tests__/{counters.test.js,decision-log.test.js}
**Interfaces:** Consumes Task A 的 action 枚举。
- `deriveCounters(logRows, {proposeBranchMaxRn}) → {hops, fixRound, ganRound, noPushStreak, noVerdictStreak}`（纯；ganRound 权威=分支 rN，COUNT 交叉校验；streak 从 (action, observed) 序列尾部推导）
- `appendHop(pool, {runId, hop, observed, derivedPhase, gateVerdict, action, detail})`——intent-before-dispatch；UNIQUE 冲突抛 SingletonConflictError
- `writeHeartbeat(pool, {runId, host, pid, now})`——now 注入
decision-log.test 用真实 pg？否——mock pool（断言 SQL 形状+参数），append-only 行为已由 migration 312 测试+真库 proven-to-fire 覆盖。
**Steps:** Red → commit-1 → Green → commit-2。

### Task C: ground-truth.js + loop.js + run.js + selfcheck bump
**Files:** Create {ground-truth.js,loop.js,run.js}；Modify src/selfcheck.js:23（'293'→'312'）+ __tests__/selfcheck.test.js:150-154 与 __tests__/learnings-vectorize.test.js:434-435 的地板断言（'293'→'312'，注释更新为"312=orchestrator 代码强依赖 312 列，issue 14d66027 语义不变：只有代码依赖才 bump"）；Test __tests__/{loop.test.js,ground-truth.test.js}
**Interfaces:** Consumes A+B 全部。
- `collectGroundTruth(deps, {taskId, runId}) → observed`——deps 注入 {pool, gh, git, docker, fs}（全部可 fake；真实现用 execSync gh/git/docker，薄，不测真外部）
- `runLoop(deps, {taskId, dryRun}) → exitReason`——deps 含 dispatch；四态最小语义；terminal 退出；--dry-run 不派发只打印
- run.js：parseArgs + 组装真实 deps + runLoop；顶部注释声明 host 进程用法
**Steps:** Red → commit-1 → Green → commit-2。loop.test 覆盖 spec 测试策略 §4 全部场景（含"崩溃在 log 与 dispatch 之间"、BLOCKED×2→failed、singleton 冲突退出）。

### Task D: 收尾
DoD.md（[BEHAVIOR] manual:node -e 白名单格式）+ Learning + DevGate 三件套（node scripts/facts-check.mjs / bash scripts/check-version-sync.sh / node packages/quality/scripts/devgate/check-dod-mapping.cjs）+ 全量目标测试 + push + PR（正文含 Red/Green 证据、spec v2 修订说明、T1 承诺的 selfcheck bump 落实说明）。PR title: `feat(brain): orchestrator 骨架——reconcile loop + 路由/门禁纯函数 [T2/7 harness-orchestration-redesign]`
