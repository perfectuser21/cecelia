# Harness v2 M2 — Initiative Planner + DAG 调度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Harness v2 阶段 A：新 Planner Skill 模板、DAG 调度器、Initiative Runner、executor 路由。

**Architecture:** Planner（Docker 节点）产 `task-plan.json` → Runner 解析入库 → `harness-dag.js` 提供拓扑排序 / 环检测 / next-runnable 查询。

**Tech Stack:** Node.js ESM、pg（Postgres）、vitest、LangGraph（只复用 executeInDocker）。

---

## 文件布局

- Create: `packages/brain/src/harness-dag.js` — 纯函数 + DB 交互（schema 校验、环检测、拓扑、upsert、nextRunnable）
- Create: `packages/brain/src/harness-initiative-runner.js` — 串 Planner → upsert → 建合同 + run
- Create: `packages/brain/src/__tests__/harness-dag.test.js` — 单测
- Create: `packages/brain/src/__tests__/integration/harness-initiative-runner.integration.test.js` — 集成测试（mock docker + 真 PG）
- Modify: `packages/brain/src/executor.js` — 加 `harness_initiative` 分支
- Modify: `~/.claude-account1/skills/harness-planner/SKILL.md`（+ account2 + ~/.claude）—— 新模板
- Modify: `packages/brain/package.json` — version bump
- Create: DoD 文件、PRD 文件、Learning 文件（按 /dev 规范）

---

### Task 1: harness-dag.js — 纯函数骨架 + 单测

**Files:**
- Create: `packages/brain/src/harness-dag.js`
- Create: `packages/brain/src/__tests__/harness-dag.test.js`

- [ ] Step 1: 写 `parseTaskPlan / detectCycle / topologicalOrder` 三个纯函数
- [ ] Step 2: 写 vitest 单测覆盖
- [ ] Step 3: `npm --workspace packages/brain run test -- harness-dag`
- [ ] Step 4: commit

### Task 2: harness-dag.js — upsertTaskPlan + nextRunnableTask

**Files:**
- Modify: `packages/brain/src/harness-dag.js`

- [ ] Step 1: 实现 `upsertTaskPlan({ initiativeId, initiativeTaskId, taskPlan, client })` 事务内建 tasks / pr_plans / task_dependencies
- [ ] Step 2: 实现 `nextRunnableTask(initiativeId)` 用 SQL 查询
- [ ] Step 3: commit

### Task 3: harness-initiative-runner.js

**Files:**
- Create: `packages/brain/src/harness-initiative-runner.js`

- [ ] Step 1: 实现 `runInitiative(task, opts)`（调 Planner、抽 JSON、upsert、建 contract + run）
- [ ] Step 2: 允许 opts.dockerExecutor 注入（便于测试）
- [ ] Step 3: commit

### Task 4: executor.js 路由

**Files:**
- Modify: `packages/brain/src/executor.js`

- [ ] Step 1: 在 2.9 LangGraph 分支之前加 `harness_initiative` 分支
- [ ] Step 2: 旧 `harness_planner` 分支保留不动
- [ ] Step 3: commit

### Task 5: harness-planner SKILL.md 新模板

**Files:**
- Modify: `~/.claude-account1/skills/harness-planner/SKILL.md`
- Modify: `~/.claude-account2/skills/harness-planner/SKILL.md`
- Modify: `~/.claude/skills/harness-planner/SKILL.md`

- [ ] Step 1: 重写 SKILL.md（v6.0.0），加 task-plan.json 强约束
- [ ] Step 2: 三处同步
- [ ] Step 3: commit（Skill 文件在 home dir，不入 repo；但在 repo 内也保留副本？先看历史）

### Task 6: integration test（Runner + 真 PG）

**Files:**
- Create: `packages/brain/src/__tests__/integration/harness-initiative-runner.integration.test.js`

- [ ] Step 1: 写 integration test（mock Docker executor，真 PG）
- [ ] Step 2: commit

### Task 7: version bump + PRD + DoD + Learning

- [ ] Step 1: bump `packages/brain/package.json` patch
- [ ] Step 2: 写 PRD.cp-*.md（worktree 根 + `packages/workflows/` 如有）
- [ ] Step 3: 写 DoD.cp-*.md
- [ ] Step 4: 写 `docs/learnings/cp-*-harness-v2-m2.md`
- [ ] Step 5: 跑 DevGate（facts-check + dod-mapping）
- [ ] Step 6: commit

### Task 8: push + PR

- [ ] Step 1: `git push -u origin HEAD`
- [ ] Step 2: `gh pr create` with 标题 `feat(brain): Harness v2 M2 — Initiative Planner + DAG 调度`
