---
id: dev-step-autonomous-research-proxy
version: 1.0.0
created: 2026-04-15
changelog:
  - 1.0.0: 初版 — Superpowers user 交互点全替换为 Research Subagent
---

# Autonomous Research Proxy — User 交互点替换清单

> **autonomous_mode=true 时必须加载到系统 context**
> POC 已验证可行（2026-04-15，.bak gitignore 任务，27s Subagent 调研给出高置信度结论+发现原任务冗余）

## 使用时机

主 agent 在执行 Superpowers skill 时，碰到以下任一触发点 -> 派 Research Subagent 代 user 回答。

## Tier 1 — 工作流阻塞（必须替换）

| Skill | 交互点 | Research Subagent 职责 |
|-------|-------|---------------------|
| brainstorming | Clarifying question (one at a time) | 深度调研 code + OKR + decisions 回答 |
| brainstorming | Present 2-3 approaches, recommend | 深度对比, 推荐并记录理由 |
| brainstorming | HARD-GATE "user approved design" | 独立审 design 文件, APPROVED/REJECT |
| brainstorming | "Spec written, please review" | 独立审 spec |
| writing-plans | "Subagent-Driven vs Inline?" | 默认 subagent-driven |
| finishing-a-development-branch | "4 options: merge/PR/keep/discard" | 默认 Option 2 push + PR |
| using-git-worktrees | "no dir preference -> ask user" | 用 ~/worktrees/cecelia/ 约定 |
| subagent-driven-development | "main branch consent" | 已被 branch-protect 强制 |

## Tier 2 — 异常升级点

| Skill | 原本 escalate 到 user | Research Subagent 处理 |
|-------|-------------------|---------------------|
| executing-plans | "Raise concerns with your human partner" | 写 .concerns-<branch>.md, 继续, PR body 列出 |
| systematic-debugging | "3+ fix 失败 -> discuss with human" | 派 dispatching-parallel-agents 独立分析 |
| receiving-code-review | "architectural -> involve human" | 派 architect-reviewer subagent 独立判断 |
| subagent BLOCKED | "escalate to the human" | 升级模型 Sonnet->Opus; 连 3 BLOCKED -> 创 Brain task |

## Tier 3 — 边缘

| 点 | 处理 |
|---|------|
| brainstorming "Offer visual companion" | autonomous 永不启用 |
| brainstorming 逐段"看起来对吗" | 合并成一次 self-review |
| 所有 skill "Announce at start" | 保留作日志输出 |

## Research Subagent 调用模板

主 agent 识别触发点后, 用 Task tool 派遣:

```
Task tool call:
  subagent_type: general-purpose
  model: <per Model Selection>
  description: "Research: <brief>"
  prompt: |
    You are Research Subagent. A user-facing interaction point came from
    superpowers:<skill-name> skill. You answer INSTEAD of the user.

    ## Original Interaction Point
    <Superpowers question/approval/choice verbatim>

    ## Your Job — Deep Research, Not Guess

    Do real research grounded in external anchors:
    1. Code reality (grep, glob, read files)
    2. OKR strategic direction: curl localhost:5221/api/brain/okr/current
    3. Historical decisions: curl localhost:5221/api/brain/decisions
    4. Related Learnings: ls docs/learnings/
    5. First-principles reasoning

    ## Return Format

    **答案**: <one sentence direct answer>

    **理由**:
    - <reason 1 citing specific code/finding>
    - <reason 2>
    - <reason 3>

    **置信度**: high / medium / low

    **假设** (if any):
    - <assumption that can be overridden later>

    **建议 Superpowers 如何继续**:
    - <e.g. "proceed with X" or "skip, task is redundant because Y">
```

## Model Selection Rules

| 问题类型 | 模型 | 理由 |
|---|---|---|
| 架构 / 数据层 / 安全 / 协议 | Opus | 复杂推理 |
| 代码细节 / 命名 / 文件路径 | Sonnet | 默认 |
| 快速事实查询 (文件存在? 配置值?) | Haiku | 低成本 |

## Confidence Handling

| 置信度 | 主 agent 行为 |
|-------|-----------|
| high | 把答案注入 Superpowers 流程, 继续 |
| medium | 继续, 但 PR body 列为 "autonomous decision, review recommended" |
| low | 暂停 autonomous, 创 Brain task "需决策: <问题>", 设 .dev-mode step_1_spec: awaiting_human_decision 等 Alex 异步回复 |

## 与现有层的分工

| Step | 角色 | 变化 |
|------|-----|------|
| Step 0.5 Enrich | PRD 丰满化 | 不变 |
| Step 0.7 Decision Query | ~~主流程自动执行~~ -> Research Subagent 可选调用的查询工具 | v1.1.0 重塑 |
| autonomous-research-proxy (本文件) | 主 agent 的 interaction 替换规则 | 新增 |

## POC 参考

2026-04-15 验证: 主 agent 在 brainstorming 的 clarifying question 步骤派 haiku Research Subagent, 27 秒内完成 grep + find + git log + 脚本分析, 返回 high confidence 答案并发现原 PRD 冗余（root gitignore 已覆盖）。模式成立。
