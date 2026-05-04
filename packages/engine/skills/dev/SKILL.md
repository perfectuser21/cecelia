---
name: dev
version: 18.20.1
updated: 2026-05-04
description: Cecelia /dev 点火入口。接力链 — engine-worktree → superpowers:brainstorming → writing-plans → subagent-driven-development → finishing → engine-ship。所有"问用户"交互点由 Research Subagent 代答，不停下等用户。
trigger: /dev, --task-id <id>
---

> **CRITICAL LANGUAGE RULE**: 所有输出简体中文。

## Autonomous 行为（所有 Superpowers skill 通用，必遵守）

**绝不停下问用户**。Superpowers 每个"问用户"交互点 → 派 **Research Subagent**（Task tool，general-purpose）代答。

**Tier 1 固定默认**：
- brainstorming design approval / spec review → Research Subagent APPROVE（除非发现硬阻碍）
- brainstorming clarifying question → Research Subagent 查代码 + `curl localhost:5221/api/brain/decisions/match`（历史决策）+ `docs/learnings/` 回答
- brainstorming 启动前 → Research Subagent 跑 `bash packages/engine/skills/dev/scripts/enrich-decide.sh .raw-prd-<branch>.md` 判 thin，thin 则先 deep-research 补足 PRD
- brainstorming spec 必须含「测试策略」段（Research Subagent 在 design APPROVE 时验证）：
  - 跨进程/重启/持久化/I/O 行为 → E2E test
  - 跨多模块行为 → integration test
  - 单函数行为 → unit test
  - Trivial wrapper（< 20 行无 I/O）→ 1 unit test 即可
  - spec 缺测试策略段 → Research Subagent reject design approval（不 APPROVE）
- writing-plans "Subagent-Driven vs Inline?" → subagent-driven
- subagent-driven-development 派 subagent 时 → prompt 必须 inline TDD 摘要：
  - "NO PRODUCTION CODE WITHOUT FAILING TEST FIRST"（Superpowers TDD iron law）
  - "Throwaway prototype 才 skip — 你不是写 prototype"
  - "每 plan task 必须 git commit 顺序：commit-1 fail test / commit-2 impl"
  - "controller (team-lead) 会 verify commit 顺序，不符合让你重做"
- finishing 4 options → Option 2 (push+PR)
- finishing discard → abort + `POST /api/brain/tasks` 创人工 review
- finishing 完成（push+PR 建好）→ **下一 tool call 必须 `Skill({"skill":"engine-ship"})`**（Superpowers 不知 Engine 终棒，硬接驳）
- BLOCKED 第 3 次 / systematic-debugging 第 3 次失败 → dispatching-parallel-agents

详细规则：`~/.claude/skills/dev/steps/autonomous-research-proxy.md`（完整 Tier 1/2/3 + Subagent 模板 + Model 选择，按需 Read）。

---

## TDD 纪律强化（v18.6.0 新增）

历史教训：subagent-driven-development 派 subagent 时若 prompt 没显式要求 TDD，subagent 经常先写实现再补测试，违反 Superpowers TDD iron law。brainstorming spec 若不强制「测试策略」段，design 通过后到 plan 阶段才发现测试盲区，回炉成本高。

**两道 gate**：

1. **brainstorming spec 「测试策略」段** — Research Subagent 在 design APPROVE 前 grep spec 是否含此段；缺则 reject + 回去补。四档分类（E2E / integration / unit / trivial）锚定 Cecelia 测试金字塔，避免新功能"裸奔"上线。

2. **subagent prompt inline TDD iron law** — orchestrator 派 implementer subagent 时，prompt 必须复制 4 条 TDD 红线（见 Tier 1 默认表第 26-30 行）。subagent 收到任务后必须先 commit-1（fail test）再 commit-2（impl），controller 在合并前 `git log --oneline` 验证 commit 顺序，不符合则让 subagent 重做。

详见 `packages/engine/skills/dev/steps/autonomous-research-proxy.md` Tier 1 表新增的 2 行 TDD 强化条目。

---

## smoke.sh 必须 — 行为类 PR 真环境验证（v18.7.0 新增）

历史教训：单元测试全绿不等于功能可用。Brain 多次合并后才发现真启动 SyntaxError、容器化后 host.docker.internal 解析失败、迁移漏跑导致表缺失。CI 跑 vitest mock 不挂真服务，覆盖不到这类"系统已起来但行为崩"的盲区。

**新规则（PR 合并前强制）**：

1. **新行为类 PR 必须含 `packages/brain/scripts/smoke/<feature>-smoke.sh` 真环境验证脚本**
   - "行为类" = 改动了 `packages/brain/src/`（runtime 行为），且 commit 类型为 `feat:`
   - smoke.sh 在真起的 Brain（docker compose / 本机 server.js）上执行 curl/psql/node 链路验证，不是 mock
   - 命名约定：`packages/brain/scripts/smoke/<feature>-smoke.sh`，例如 `e1-observer-smoke.sh` / `tick-runner-smoke.sh`

2. **smoke.sh 必须在 CI `real-env-smoke` job 跑过才能 merge**
   - 该 job 起真 docker compose（postgres + brain），逐个执行 `packages/brain/scripts/smoke/*.sh`
   - 任一 smoke.sh exit ≠ 0 → CI fail → 不能合并

3. **writing-plans 第一个 task 必须是「写 fail E2E + smoke.sh」**
   - 在 plan 文件里，第一个 implementation task 的标题必须含 "E2E" 或 "smoke" 关键字
   - subagent-driven-development 派 implementer 时，第一个 subagent 的产物必须是失败的 E2E test + 空 smoke.sh 骨架（commit 1）
   - 第二个 subagent 才写 impl 让 E2E + smoke.sh 同时变绿（commit 2）

**CI 强制门禁（机器化）**：

`.github/workflows/ci.yml` 添加 4 个 lint job 实现机器化执行：

- `lint-test-pairing` — 新增 `brain/src/*.js` 必须配套 `*.test.js`（同目录 / `__tests__/`）
- `lint-feature-has-smoke` — `feat:` PR 触及 `brain/src/` 必须新增 `packages/brain/scripts/smoke/*.sh`
- `lint-base-fresh` — PR 落后 main ≤ 5 commits（避免 stale base 合并冲突）
- `lint-tdd-commit-order` — 含 `brain/src/*.js` 的 commit 之前必须有 `*.test.js` commit（TDD 顺序）

实现脚本：`.github/workflows/scripts/lint-*.sh`，本地可手跑 `bash .github/workflows/scripts/lint-test-pairing.sh origin/main` 提前验证。

---

## TERMINAL IMPERATIVE

/dev 点火。**你的下一个 tool call 必须是**：

```
Skill({"skill":"engine-worktree"})
```

不要 Read / Bash / Grep。这不是文档引用，是指令。
