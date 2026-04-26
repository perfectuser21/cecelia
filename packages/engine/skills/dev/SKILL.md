---
name: dev
version: 18.6.0
updated: 2026-04-26
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

## TERMINAL IMPERATIVE

/dev 点火。**你的下一个 tool call 必须是**：

```
Skill({"skill":"engine-worktree"})
```

不要 Read / Bash / Grep。这不是文档引用，是指令。
