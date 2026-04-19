---
id: autonomous-research-proxy
version: 2.0.0
updated: 2026-04-19
changelog:
  - 2.0.0: Phase 6 瘦身 — 删 F4 17 项交互点审计表、POC 参考、覆盖率统计、已删文件映射。加 Phase 6 Tier 1 两条（enrich + decisions/match）吸收已删的 engine-enrich / engine-decision skill 能力。
  - 1.0.0: 初版
---

# Autonomous Research Proxy — User 交互点 → Research Subagent 替换规则

/dev SKILL.md 列了 Tier 1 固定默认；本文件是完整规则集 + Subagent 调用模板。主 agent 按需 Read。

## Tier 1 — 工作流阻塞（必须替换，不停下问用户）

| Skill | 交互点 | Research Subagent 职责 |
|-------|-------|---------------------|
| brainstorming | **Phase 6 新**：启动前 PRD 丰满度 | 跑 `bash packages/engine/skills/dev/scripts/enrich-decide.sh .raw-prd-<branch>.md`；thin 则 deep-research 代用户答 clarifying question，产出 `.enriched-prd-<branch>.md` |
| brainstorming | **Phase 6 新**：clarifying question / 方案对比 | 必 curl `http://localhost:5221/api/brain/decisions/match` 拿 Alex 历史决策；结合代码 + OKR + learnings 回答 |
| brainstorming | HARD-GATE "user approved design" | 独立审 design，APPROVED（无硬阻碍） |
| brainstorming | "Spec written, please review" | 独立审 spec |
| writing-plans | "Subagent-Driven vs Inline?" | subagent-driven |
| finishing-a-development-branch | "4 options" | Option 2 (push + PR) |
| finishing-a-development-branch | discard confirm | autonomous abort + `POST /api/brain/tasks` 人工 review |
| using-git-worktrees | 被 engine-worktree skill 替代 | 不触发（接力链不走此 skill） |
| subagent-driven-development | main branch consent | branch-protect hook 已强制 |

## Tier 2 — 异常升级

| Skill | 原 escalate user | Research Subagent 处理 |
|-------|----------------|---------------------|
| executing-plans | "Raise concerns with human" | 写 `.concerns-<branch>.md` 继续，PR body 列出 |
| systematic-debugging | 3+ fix 失败 | 派 dispatching-parallel-agents |
| receiving-code-review | architectural | 派 architect-reviewer subagent |
| subagent BLOCKED | "escalate to human" | 升模型 Sonnet→Opus；连 3 BLOCKED → 创 Brain task |

## Tier 3 — 丢弃

- visual companion → autonomous 永不启用
- 逐段 "看起来对吗" → 合并成一次 self-review

## Research Subagent 调用模板

Task tool / general-purpose / model 按下表 / description "Research: <brief>" / prompt：

```
You are Research Subagent. User-facing interaction point came from superpowers:<skill>. You answer INSTEAD of the user.

## Original Interaction Point
<Superpowers question/approval/choice verbatim>

## Anchors（必查）
1. Code reality (grep/glob/read)
2. OKR: curl localhost:5221/api/brain/okr/current
3. Historical decisions: curl -X POST localhost:5221/api/brain/decisions/match -d '{"prd":"..."}'
4. Related Learnings: ls docs/learnings/
5. First-principles reasoning

## Return
**答案**: <one sentence>
**理由**: <3 reasons citing specific findings>
**置信度**: high / medium / low
**假设**: <if any>
**Superpowers 怎么继续**: <e.g. "proceed with X">
```

## Model Selection

| 问题类型 | 模型 |
|---|---|
| 架构 / 数据 / 安全 | Opus |
| 代码细节 / 路径 | Sonnet（默认） |
| 快速事实 | Haiku |

## Confidence Handling

| 置信度 | 主 agent 行为 |
|---|---|
| high | 注入 Superpowers 流程继续 |
| medium | 继续，PR body 标 "autonomous decision, review recommended" |
| low | 暂停，`POST /api/brain/tasks` "需决策: <问题>"；`.dev-mode` 设 `awaiting_human_decision`；等 Alex |

---

## Phase 5 硬规则：finishing → engine-ship

Superpowers `finishing-a-development-branch` 完成（push+PR 已建）→ **下一 tool call 必须 `Skill({"skill":"engine-ship"})`**。Superpowers 不知 Engine 终棒，靠本规则硬接驳。违反的症状：step_4_ship 永远 pending → PR 永不自动合并 → orphan-pr-worker 30min 兜底才接管。
