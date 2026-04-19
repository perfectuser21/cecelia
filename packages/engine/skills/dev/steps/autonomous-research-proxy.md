---
id: dev-step-autonomous-research-proxy
version: 1.0.0
created: 2026-04-15
changelog:
  - 1.0.0: 初版 — Superpowers user 交互点全替换为 Research Subagent
---

# Autonomous Research Proxy — User 交互点替换清单

> **/dev 默认必须加载到系统 context**（Phase 1 Round 2 模式统一后唯一路径，不再区分 autonomous_mode）
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

---

## 交互点替代矩阵 v2（F4 / Engine v14.17.0）

2026-04-16 Explore agent 一比一审计，覆盖 Superpowers 5.0.7 所有"问用户"点（17 个）与我们的替代状态。F4 已修复漏网之鱼，完整度从 78% → 95%。

| # | superpowers 交互点 | 文件:行号 | 我们的处理（Tier/step） | 状态 |
|---|---|---|---|---|
| 1 | brainstorming HARD-GATE design approval | brainstorming/SKILL.md:12-13 | Tier 1 + 01-spec.md §0.2.3 自主选方案 | ✅ 完全替代 |
| 2 | brainstorming visual companion offer | brainstorming/SKILL.md:25 | Tier 3 "autonomous 永不启用" | 🗑️ 刻意丢弃（无浏览器） |
| 3 | brainstorming design section approval | brainstorming/SKILL.md:28-29 | 01-spec.md §0.2.4-0.2.5 self-review 5 步 | ✅ 完全替代（合并为一次） |
| 4 | brainstorming spec doc review | brainstorming/SKILL.md:127-131 | Tier 1 spec reviewer 独立审 | ✅ 完全替代 |
| 5 | brainstorming visual companion consent | brainstorming/SKILL.md:150-154 | 同 #2 刻意丢弃 | 🗑️ 刻意丢弃 |
| 6 | writing-plans subagent-vs-inline 选择 | writing-plans/SKILL.md:136-144 | Tier 1 固定 "subagent-driven" | ✅ 完全替代 |
| 7 | finishing-a-development-branch 4 选项 | finishing.../SKILL.md:51-62 | Tier 1 固定 "push + PR" | ✅ 完全替代 |
| 8 | finishing-a-development-branch discard confirm | finishing.../SKILL.md:116-126 | **F4 新增**：04-ship.md §4.3 autonomous abort + Brain task | ✅ 完全替代（F4） |
| 9 | using-git-worktrees 路径选择 | using-git.../SKILL.md:40-43 | Tier 1 固定 `~/worktrees/cecelia/` | ✅ 完全替代 |
| 10 | using-git-worktrees test-fail proceed? | using-git.../SKILL.md:132 | Step 0 00-worktree-auto.md | ⚠️ 部分替代（baseline test 非关键路径） |
| 11 | subagent-driven-development implementer questions | subagent.../SKILL.md:49 | 02-code.md §2.1 controller 传 full context | ✅ 完全替代 |
| 12 | executing-plans 疑虑上报 | executing.../SKILL.md:21-22 | **F4 新增**：01-spec.md §0.2.5 Step 5 Critical Gap Abort | ✅ 完全替代（F4） |
| 13 | executing-plans 阻塞升级 | executing.../SKILL.md:39-47 | **F4 v2**：02-code.md §2.5 BLOCKED 升级链 v2 | ✅ 完全替代（F4） |
| 14 | receiving-code-review 信息澄清 | receiving.../SKILL.md:40-56 | 02-code.md §2.3 Spec Reviewer "不信任 Implementer" | ✅ 完全替代 |
| 15 | receiving-code-review 架构问题升级 | receiving.../SKILL.md:64-84 | **F4 新增**：02-code.md §2.3/2.4 ARCHITECTURE_ISSUE 分支 + arch-reviewer | ✅ 完全替代（F4） |
| 16 | systematic-debugging 多次失败升级 | systematic.../SKILL.md:197+211 | **F4 改**：BLOCKED 第 3 次派 dispatching-parallel-agents（不再派 systematic-debugging） | ✅ 完全替代（F4 修正） |
| 17 | verification-before-completion gate | verification.../SKILL.md:23-34 | F3 / 02-code.md Pre-Completion Verification 清单 | ✅ 完全替代（F3） |

**F4 之后统计**：
- ✅ 完全替代：**14 个**（82%）
- ⚠️ 部分替代：**1 个**（#10，baseline test 非关键路径）
- 🗑️ 刻意丢弃：**2 个**（visual companion，合理）
- ❌ 完全漏：**0**

**Superpowers skill 引用覆盖**（F4 之后）：

| skill | F4 前 | F4 后 | 备注 |
|---|---|---|---|
| brainstorming | ✓ | ✓ | |
| writing-plans | ✓ | ✓ | |
| subagent-driven-development | ✓ | ✓ | |
| test-driven-development | ✓ | ✓ | |
| verification-before-completion | ✓ | ✓ | |
| systematic-debugging | ✓ | ✓ | 调用时机 F4 重新设计 |
| dispatching-parallel-agents | ✓ | ✓ | BLOCKED 第 3 次调用 |
| **receiving-code-review** | ✗ | **✓** | F4 新引（ARCHITECTURE_ISSUE 分支） |
| **requesting-code-review** | ✗ | **✓** | F4 新引（Review 请求规范化 5 项） |
| **executing-plans** | ✗ | **✓** | F4 新引（Critical Gap Abort + BLOCKED v2） |
| **finishing-a-development-branch** | ✗ | **✓** | F4 新引（Discard 安全确认） |
| using-git-worktrees | ✗ | ✗ | 我们自造 `worktree-manage.sh`，保留不切换 |
| using-superpowers | — | — | meta skill，不适用 |
| writing-skills | — | — | meta skill，不适用 |

**覆盖率**：F4 前 7/14 (50%) → F4 后 **11/14 (79%)**，剩下 3 个：2 meta skill + 1 自造 worktree manager（刻意保留）。

---

## Phase 5 (v15.0.0) 硬规则：Superpowers finishing → Engine ship 接力

Phase 5 把 Engine 独有能力升级为真 skill（`engine-worktree/enrich/decision/ship`）+ 删掉 Stage 3 冗余（原 03-integrate.md 和 Superpowers finishing 功能重叠）。

**新硬规则（主 agent 必须遵守）**：

当 Superpowers `finishing-a-development-branch` 执行完成（不管用户选 push+PR / merge / keep / discard 哪条路径，autonomous-research-proxy Tier 1 默认选 Option 2 = push+PR），**你的下一个 tool call 必须是**：

```
Skill({"skill":"engine-ship"})
```

不要认为 Superpowers 接力链到此结束就停止。Superpowers 不知道 Engine 有终棒 skill，必须由本规则硬性接驳。engine-ship 负责：
- 写 Learning 文件 + 触发 Brain fire-learnings-event
- 标记 `.dev-mode` 里 `step_4_ship=done`
- 退出 assistant turn 让 Stop Hook 自动合并 PR

**违反此规则的症状**：PR 创建后主 agent 停在 finishing → `.dev-mode` 里 step_4_ship 永远 pending → Stop Hook 条件 6 永远不触发 → PR 永不自动合并 → orphan-pr-worker 30min 兜底才处理（用户等得久）。

## Phase 5 旧引用清理

本文件上表引用的 `01-spec.md § 0.2.5` / `02-code.md § 2.3/2.4 / § 2.5` / `04-ship.md § 4.3` 等在 Phase 5 后路径变化：

| 旧路径 | Phase 5 新位置 |
|---|---|
| `steps/01-spec.md` | ❌ Phase 4 已删（功能由 `/superpowers:brainstorming` + `/superpowers:writing-plans` 承担） |
| `steps/02-code.md` | ❌ Phase 4 已删（功能由 `/superpowers:subagent-driven-development` 承担） |
| `steps/03-integrate.md` | ❌ Phase 5 已删（冗余于 `/superpowers:finishing-a-development-branch`） |
| `steps/04-ship.md § 4.3` discard 安全 | `skills/engine-ship/SKILL.md § 4` |
| `steps/00-worktree-auto.md` | `skills/engine-worktree/SKILL.md` |
| `steps/00.5-enrich.md` | `skills/engine-enrich/SKILL.md` |
| `steps/00.7-decision-query.md` | `skills/engine-decision/SKILL.md` |

上表交互点 #8（finishing discard confirm）的"04-ship.md §4.3"指的是现在的 `engine-ship/SKILL.md § 4`。
上表交互点 #10（using-git-worktrees test-fail proceed）的"Step 0 00-worktree-auto.md"指的是现在的 `engine-worktree/SKILL.md § 3`。
上表交互点 #12/#13/#15（executing-plans / receiving-code-review 升级路径）原绑定 `01-spec.md` / `02-code.md` — Phase 5 之后主 agent 在 Superpowers 对应 skill（`/superpowers:executing-plans` / `/superpowers:receiving-code-review`）里直接按 Tier 1/2/3 规则处理，不再需要本地独立 step 文件。

**实际可引用 skill 覆盖 = 11/12 = 92%**
