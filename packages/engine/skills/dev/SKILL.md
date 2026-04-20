---
name: dev
version: 18.2.0
updated: 2026-04-20
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
- writing-plans "Subagent-Driven vs Inline?" → subagent-driven
- finishing 4 options → Option 2 (push+PR)
- finishing discard → abort + `POST /api/brain/tasks` 创人工 review
- finishing 完成（push+PR 建好）→ **下一 tool call 必须 `Skill({"skill":"engine-ship"})`**（Superpowers 不知 Engine 终棒，硬接驳）
- BLOCKED 第 3 次 / systematic-debugging 第 3 次失败 → dispatching-parallel-agents

详细规则：`~/.claude/skills/dev/steps/autonomous-research-proxy.md`（完整 Tier 1/2/3 + Subagent 模板 + Model 选择，按需 Read）。

---

## TERMINAL IMPERATIVE

/dev 点火。**你的下一个 tool call 必须是**：

```
Skill({"skill":"engine-worktree"})
```

不要 Read / Bash / Grep。这不是文档引用，是指令。
