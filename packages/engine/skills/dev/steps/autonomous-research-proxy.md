---
id: autonomous-research-proxy
version: 3.1.0
updated: 2026-04-20
changelog:
  - 3.1.0: Phase 8.2 — 剩余 10 个交互点深度化（writing-plans / executing-plans / TDD / finishing / systematic-debugging / requesting-code-review / dispatching-parallel-agents / using-git-worktrees）+ Appendix A 追加 4 个 prompt（A.WP-1 / A.EP-1 / A.DPA-1 / A.DPA-2）。
  - 3.0.0: Phase 8.1 — 13 个关键路径点深度化（brainstorming 6 + SDD 3 + RCR 4）+ Structured Review Block 规范 + Appendix A 5 个 Research Subagent prompt 模板 + 数据源排序（用户的话 > 现有代码 > OKR，不用 decisions/learnings）
  - 2.0.0: Phase 6 瘦身 — 删 F4 17 项交互点审计表、POC 参考、覆盖率统计、已删文件映射。加 Phase 6 Tier 1 两条（enrich + decisions/match）吸收已删的 engine-enrich / engine-decision skill 能力。
  - 1.0.0: 初版
---

# Autonomous Research Proxy — User 交互点 → Research Subagent 替换规则

/dev SKILL.md 列了 Tier 1 固定默认；本文件是完整规则集 + Subagent 调用模板 + 13 点深度 prompt。主 agent 按需 Read。

## Tier 1 — 工作流阻塞（必须替换，不停下问用户）

| Skill | 交互点 | Research Subagent 职责 |
|-------|-------|---------------------|
| brainstorming | **Phase 6 新**：启动前 PRD 丰满度 | 跑 `bash packages/engine/skills/dev/scripts/enrich-decide.sh .raw-prd-<branch>.md`；thin 则 deep-research 代用户答 clarifying question，产出 `.enriched-prd-<branch>.md` |
| brainstorming | **Phase 8.1**：clarifying question / 方案对比 | 按数据源排序（用户的话 > 现有代码 > OKR）代答；见 §Phase 8.1 B-3 |
| brainstorming | HARD-GATE "user approved design" | 独立审 design，APPROVED + Structured Review Block（见 §Phase 8.1 B-4） |
| brainstorming | **TDD 强化**：spec 必须含「测试策略」段 | design APPROVE 前验证 spec 含「测试策略」段（E2E / integration / unit / trivial 四档分类）；缺则 reject、不 APPROVE，回去补。详见 SKILL.md Tier 1 默认表 |
| brainstorming | "Spec written, please review" | 独立审 spec，APPROVED + Structured Review Block（见 §Phase 8.1 B-5） |
| writing-plans | "Subagent-Driven vs Inline?" | subagent-driven |
| subagent-driven-development | **TDD 强化**：派 subagent 时 prompt 必须 inline TDD iron law | prompt 必须 inline 4 条："NO PRODUCTION CODE WITHOUT FAILING TEST FIRST"（Superpowers TDD iron law）/ "throwaway prototype 才 skip — 你不是写 prototype" / "每 plan task 必须 git commit 顺序：commit-1 fail test → commit-2 impl" / "controller (team-lead) 会 verify commit 顺序，不符合让你重做"。详见 SKILL.md Tier 1 默认表 |
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
- 逐段 "看起来对吗" → 合并成一次 Structured Review Block

## Research Subagent 调用模板（通用）

Task tool / general-purpose / model 按下表 / description "Research: <brief>" / prompt：

```
You are Research Subagent. User-facing interaction point came from superpowers:<skill>. You answer INSTEAD of the user.

## Original Interaction Point
<Superpowers question/approval/choice verbatim>

## Anchors 数据源排序（STRICT — 用户的话 > 现有代码 > OKR）
1. **用户的话**（最高）：PRD / .raw-prd-*.md / .dev-mode.<branch> 对话记录
2. **现有代码**（客观）：grep / glob / read 相关文件
3. **OKR 方向**（战略）：curl localhost:5221/api/brain/okr/current

## 不读
decisions / learnings / design-docs（用户说"不一定准"）

## Return
**答案**: <one sentence>
**理由**: <3 reasons citing specific anchor findings>
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

---

## Phase 8.1 — 13 点深度规则

### brainstorming

#### B-1 视觉陪伴（visual companion）

Superpowers 原问（brainstorming SKILL.md）：
> "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it?"

**规则**：Tier 3 丢弃，autonomous 下不启用。跳过 offer 步骤。

#### B-2 scope decomposition

Superpowers 原问：
> "If the project is too large for a single spec, help the user decompose into sub-projects."

**数据源**：
- PRD 长度
- `curl localhost:5221/api/brain/capacity-budget` → 读 `.pr_loc_threshold.soft` / `.pr_loc_threshold.hard`（Phase 8.3 起 SSOT 在 Brain）
- `git diff main...HEAD --stat` 估算 LOC

**阈值（行业对齐 SmartBear + Microsoft Research，SSOT: Brain `pr_loc_threshold`）**：
- ≤ soft（默认 200 LOC）→ 不拆，单 PR
- soft-hard 之间（默认 200-400）→ 评估拆分，派 Research Subagent 判
- \> hard（默认 400 LOC）→ 强制拆分

**Prompt**：见 Appendix A.B-2

#### B-3 clarifying questions

Superpowers 原问：
> "Ask questions one at a time to refine the idea... purpose / constraints / success criteria."

**数据源排序（STRICT）**：
1. 用户的话：PRD + .raw-prd-*.md + .dev-mode.<branch>
2. 现有代码：grep / glob / read
3. OKR：curl localhost:5221/api/brain/okr/current

**不读**：decisions / learnings / design-docs（用户说"不一定准"）

**Prompt**：见 Appendix A.B-3

#### B-4 design review

Superpowers 原问：
> "Ask after each section whether it looks right so far."

**规则**：直接 APPROVE；把 3 方案对比 + 推荐 + 理由写进 design doc。不逐段问用户。

**输出**：Structured Review Block（见下方规范）

#### B-5 spec approval

Superpowers 原问：
> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

**规则**：AI 自动进入 writing-plans；同时生成 Structured Review Block 附加到 design doc 末尾。

**输出**：Structured Review Block

#### B-6 spec self-review

Superpowers 原问（自审 4 项）：placeholder scan / internal consistency / scope check / ambiguity check

**规则**：派 reviewer subagent 按 4 项清单扫，inline fix。

**输出**：Structured Review Block（附 `fix_count: N`）

### subagent-driven-development

#### SDD-1 implementer 问题

Superpowers 原问（subagent-driven-development SKILL.md）：
> "If subagent asks questions: Answer clearly and completely. Provide additional context if needed."

**规则**：orchestrator 用三件套数据源（用户的话 > 代码 > OKR）给答复。不升级用户。

**Prompt**：见 Appendix A.SDD-1

#### SDD-2 spec reviewer

Superpowers 原问：
> "Spec reviewer confirms code matches spec? yes / no"

**规则**：reviewer subagent 按 spec 清单审 + Structured Review Block。

**PASS 条件**：`spec_match_score ≥ 8/10`

**Prompt**：见 Appendix A.SDD-2

#### SDD-3 code quality reviewer

Superpowers 原问：
> "Code quality reviewer approves? yes / no"

**规则**：reviewer subagent 按 Cecelia 硬规则扫：
- `feat:` 提交必须含 `*.test.ts`（全局 CLAUDE.md）
- DoD 三要素：[BEHAVIOR] / push 前 [x] / feat 有测试
- 不加 fallback / 未来需求 / 无必要 abstraction
- 单文件 > 500 行拆分；重复 3 次提取函数
- 无 console.log / 注释代码 / 未用 import

**PASS 条件**：`code_quality_score ≥ 7/10` 且无硬规则违反

**Prompt**：见 Appendix A.SDD-3

### receiving-code-review

#### RCR-1 澄清 unclear

Superpowers 原问（receiving-code-review SKILL.md）：
> "IF any item is unclear: STOP - do not implement anything yet. ASK for clarification on unclear items."

**规则**：派 subagent 读 diff + 本 PR 改动的文件 + reviewer 评论上下文推断。
- confidence ≥ medium → 在 thread 中回复 "我理解是 X，如不对请明示" 并实施
- confidence low → 写 "无法确定 X，列出两种解释 + 选 Y"

#### RCR-2 外部冲突

Superpowers 原问：
> "IF conflicts with your human partner's prior decisions: Stop and discuss with your human partner first."

**优先级硬规则**：
1. 全局 CLAUDE.md + 项目 .claude/CLAUDE.md + 用户的话
2. Cecelia DoD / 提交规则 / 版本规则
3. Reviewer 建议

**规则**：前者胜 → AI 在 thread 写 "按用户规则 X，不接受此建议，理由..."。不询问用户。

#### RCR-3 YAGNI check

Superpowers 原问：
> "IF reviewer suggests 'implementing properly': grep codebase for actual usage. IF unused: 'This endpoint isn't called. Remove it (YAGNI)?'"

**规则**：派 subagent grep 代码找使用点。
- 未使用 → 推回 "grep 未找到 usage，按 YAGNI 不加"
- 有使用 → 实施

#### RCR-4 推回 reviewer

Superpowers 原问：
> "Push back when: breaks functionality / lacks context / violates YAGNI / incorrect for stack / legacy reasons / architectural conflicts."

**规则**：基于三件套数据源（用户的话 > 代码 > OKR）写推回理由，post 到 PR thread。推回理由必须引用具体代码路径 / 规则条款 / OKR 方向。不问用户。

---

## Phase 8.2 — 剩余 10 点规则

### writing-plans

#### WP-1 Subagent-Driven vs Inline？

Superpowers 原问（writing-plans SKILL.md）：
> "Is this work appropriate for subagent-driven implementation, or should it be inline?"

**硬默认（Tier 1 既定）**：subagent-driven。

**规则**：按 step 性质判——
- **独立研究 / 并行任务 / 可隔离验证** → **subagent-driven**（派 implementer subagent 执行 + reviewer subagent 验收）
- **主线实现（前后 step 强依赖 / 需共享 orchestrator 状态 / Cecelia 核心 workflow 编排）** → **inline**（在主 session 直接写）

**判断标准**：
- step 产出物可 `git diff` 隔离审查 → subagent-driven
- step 需读取前 step 结果做条件分支 → inline
- step 是 Cecelia 关键路径（brain tick / thalamus / task-router）→ inline（硬规则）

**Prompt**：见 Appendix A.WP-1

### executing-plans

#### EP-1 Raise concerns with human

Superpowers 原问（executing-plans SKILL.md）：
> "Raise concerns with human partner before proceeding when uncertain about architectural decisions."

**规则**：不停下问用户。AI 自主决策 + **写入 `.concerns-<branch>.md`** + PR body Summary 段落末尾列出所有 concerns。

**文件路径**：worktree 根目录 `.concerns-<branch>.md`（与 `.raw-prd-*.md` / `.enriched-prd-*.md` 平级）。

**concerns 内容**：每条至少含 `## Concern <N>` + 依据（三件套数据源）+ AI 的决策 + confidence。medium/low confidence 的 concern 必须在 PR body 显式列出，供 reviewer 评估。

**Prompt**：见 Appendix A.EP-1

### test-driven-development

#### TDD-1 跳过 TDD 例外？

Superpowers 原问（test-driven-development SKILL.md）：
> "Is there a valid reason to skip TDD for this change?"

**规则（硬判断，按 commit type）**：
- `feat:` → **必须 TDD**（Cecelia DoD 三要素：feat PR 必须含 `*.test.ts` / `*.spec.ts` 变动）
- `fix:` → **必须 TDD**（先写 regression test 再修）
- `[CONFIG]` / `config:` / `docs:` / `chore:` → **免测**（配置/文档改动走 DoD [ARTIFACT] 校验即可）
- `refactor:` → 无行为变化则免；有行为变化等同 `feat:`

**无 Research Subagent**：规则纯靠 commit type 枚举判断，不需要 prompt。

### finishing-a-development-branch

#### FAD-1 4 options（merge / save-as-draft / discard / keep-working）

Superpowers 原问（finishing-a-development-branch SKILL.md）：
> "Choose one: (1) merge, (2) save as draft PR, (3) discard, (4) keep working."

**硬默认（Tier 1 既定）**：**Option 2 — push + PR**。

**规则**：
- Cecelia /dev 接力链终点永远 push + PR（不直接 merge to main，不 discard，不 keep-working）
- PR 创建后立即走 engine-ship（Phase 5 硬规则）+ Stop Hook 等 CI + 合并
- FAD-2（discard confirm）按 Phase 8.1 结论"理论人为但流程永不触发"——不做 deep prompt，保持 Tier 1 "abort + POST /api/brain/tasks 人工 review"即可

**无 Research Subagent**：硬规则直接选 Option 2，不需要 prompt。

### systematic-debugging

#### SD-1 3+ fix 失败

Superpowers 原问（systematic-debugging SKILL.md）：
> "After 3+ failed fix attempts, escalate — consider dispatching parallel agents or asking human."

**规则（硬触发）**：Cecelia 侧 `ci_fix_count >= 3` → 自动升级 `dispatching-parallel-agents` skill（不问用户）。

**判断依据**：
- `ci_fix_count` 从 `.dev-mode.<branch>` 读（每次 CI 失败 + 修复 commit 自增 1）
- 达到阈值 3 → Stop Hook 注入 dispatch 信号 → 主 agent 下一轮必须调 `Skill({"skill":"superpowers:dispatching-parallel-agents"})`
- 各 subagent 独立尝试不同修复方向（root-cause / workaround / revert），orchestrator 按成功 subagent 的 diff 合并

**无 Research Subagent**：硬阈值触发，不需要 prompt。

### requesting-code-review

#### RCR-REQ-1 reviewer 回 issue 怎么处理？

Superpowers 原问（requesting-code-review SKILL.md）：
> "When reviewer responds with issues, how do you handle them?"

**规则（按严重度分档）**：
- **Blocking**（breaks functionality / security / DoD 硬规则违反）→ 立即修，不解释，走 RCR-1 澄清 + 修
- **建议**（可改进但不阻塞合并：命名 / 结构 / 性能优化）→ 评估 confidence，medium+ 接受并实施；low 则写回 "建议评估后暂不采纳，理由..." 引用代码/OKR
- **风格偏好**（个人习惯 / 无硬规则支撑）→ 按 RCR-2 外部冲突规则：Cecelia 项目 CLAUDE.md 优先，忽略并在 thread 说明 "按 Cecelia 代码规范 § X，保持现状"

**严重度判断锚**：
1. 是否违反 `.claude/CLAUDE.md` / 全局 CLAUDE.md → 硬规则违反 = Blocking
2. 是否让 test 失败 / CI 失败 → Blocking
3. 是否让 PR LOC 超 `pr_loc_threshold.hard` → Blocking（须拆分）
4. 其他 → 建议或风格偏好

**无 Research Subagent**：按锚直接分档，不需要 prompt。

### dispatching-parallel-agents

#### DPA-1 独立判断：任务独立就并行

Superpowers 原问（dispatching-parallel-agents SKILL.md）：
> "Can these tasks run in parallel, or do they have dependencies?"

**规则**：orchestrator 看任务依赖图，无依赖则并行派 subagent。

**判断方法**：
- 读 spec 的 task 列表 + files 字段
- 两个 task 改动文件集合 **无交集** + **无调用链依赖**（前 task 的 export 不被后 task import）→ **可并行**
- 有交集或依赖 → **串行**

**Prompt**：见 Appendix A.DPA-1

#### DPA-2 结果集成：多 subagent 输出冲突怎么合

Superpowers 原问（dispatching-parallel-agents SKILL.md）：
> "How to integrate results when subagents' outputs conflict?"

**规则**：orchestrator 按 spec 目标 merge，不问用户。

**合并策略**：
- 同文件不同行改动 → 直接 3-way merge
- 同文件同行冲突 → 以 **更贴合 spec DoD 文字** 的 subagent 输出为准
- 不同 subagent 的 test 互斥（test A 改的 mock 让 test B 失败）→ 分析后 merge test setup；仍冲突则升级 Tier 2（创 Brain task）
- 任何集成决策写入 Structured Review Block 附到 PR body

**Prompt**：见 Appendix A.DPA-2

### using-git-worktrees

#### UGW-1 worktree 目录位置

Superpowers 原问（using-git-worktrees SKILL.md）：
> "Where should the worktree directory live?"

**规则（硬规则 — Cecelia 固定）**：`/Users/administrator/worktrees/cecelia/<branch>`

**不问用户**：engine-worktree skill 已固化此路径，任何 cp-* 分支 worktree 一律走此位置。Superpowers 原生 using-git-worktrees skill 在 Cecelia /dev 接力链里**不触发**（被 engine-worktree 替代，见 Tier 1 表）。

**无 Research Subagent**：硬路径，不需要 prompt。

#### UGW-2 baseline 失败

Superpowers 原问（using-git-worktrees SKILL.md）：
> "What if baseline tests fail in the worktree before any changes?"

**规则（self-heal，不问用户）**：
1. 重跑 `npm ci`（dep 可能缺失）
2. 若仍失败 → 删 `package-lock.json` + 重 `npm install`（lock 与 node_modules 不一致）
3. 若仍失败 → `git checkout main -- package-lock.json`（回退 baseline）
4. 仍失败 → 升级 Tier 2（创 Brain task + 等人工）

参考：`packages/engine/memories/worktree-patterns.md`（记录了 baseline 失败的常见根因）。

**无 Research Subagent**：硬 self-heal 流程，不需要 prompt。

---

## Structured Review Block 规范

四个自审点（B-4 / B-5 / B-6 / SDD-2 / SDD-3）输出格式（markdown）：

```markdown
## Review（autonomous，<point-code>）

**依据**：
- 用户的话：<引用 PRD / 对话哪几行>
- 代码：<grep 出的路径 / 函数>
- OKR：<curl /api/brain/okr/current 哪条 KR>

**判断**：APPROVE / REQUEST_CHANGES / PASS_WITH_CONCERNS

**confidence**：HIGH / MEDIUM / LOW

**质量分**：X/10（B-4 design_quality / B-5 spec_completeness / B-6 spec_cleanliness / SDD-2 spec_match / SDD-3 code_quality）

**风险**：
- <具体风险 + 影响>

**下一步**：<推进到下一棒 / 修完再审 / 升级人工 review>
```

---

## Appendix A：Research Subagent Prompts

### A.B-2 scope decomposition

```
You are Research Subagent. Estimate PRD scope.

## Inputs
- PRD path: {{prd_path}}
- Capacity API: curl localhost:5221/api/brain/capacity-budget
  → 读 .pr_loc_threshold.soft / .pr_loc_threshold.hard (Phase 8.3 SSOT)
- Baseline: git diff main...HEAD --stat

## Task
Estimate LOC delta this PRD will produce.

## Rules (阈值从 capacity-budget.pr_loc_threshold 读)
- ≤ soft (default 200) → {decision: "single_pr", loc: N}
- soft..hard (default 200-400) → {decision: "evaluate_split", splits: [...]}
- > hard (default 400) → {decision: "must_split", splits: [{title, loc, deps}]}

## Return
JSON above + confidence + anchors used (user_words/code/okr).
```

### A.B-3 clarifying questions

```
You are Research Subagent answering clarifying question INSTEAD of user.

## Clarifying question (verbatim)
{{question}}

## Anchors (STRICT ORDER)
1. User's words: Read {{prd_path}} + .raw-prd-*.md + .dev-mode.{{branch}}
2. Code: grep / glob relevant paths
3. OKR: curl localhost:5221/api/brain/okr/current

## DO NOT READ
- docs/decisions/ / decisions API / docs/learnings/ / docs/superpowers/specs/*-design.md

## Return
**答案**: 1 sentence
**理由**: 3 lines, each citing anchor ("PRD line X / grep Y / OKR KR-Z")
**置信度**: high / medium / low
**Superpowers 怎么继续**: <one-liner>
```

### A.SDD-1 implementer questions

```
You are orchestrator answering implementer subagent's question INSTEAD of user.

## Question
{{question}}

## Anchors (STRICT ORDER)
1. User's words: spec + PRD + conversation
2. Code: grep spec-referenced files
3. OKR: curl localhost:5221/api/brain/okr/current

## Return
Single-paragraph answer citing specific anchor. No hedging. Implementer proceeds.
```

### A.SDD-2 spec reviewer

```
You are spec compliance reviewer.

## Inputs
- Spec: {{spec_path}}
- Task: {{task_text}}
- Diff: {{git_diff_since_task_start}}

## Check
Code implements task requirements (neither less nor more).

## Output: Structured Review Block (see 规范 above)

PASS requires: spec_match_score ≥ 8/10
```

### A.SDD-3 code quality reviewer

```
You are code quality reviewer. Cecelia hard rules.

## Inputs
- Diff: {{git_diff}}
- CLAUDE.md (global + project)

## Hard Rules
1. feat: commit must include *.test.ts
2. DoD 三要素：[BEHAVIOR] / push 前 [x] / feat 有测试
3. No fallback / future-speculative / unnecessary abstraction
4. Single file ≤ 500 LOC (soft split)
5. No console.log / commented code / unused imports
6. No emojis unless explicitly requested

## Output: Structured Review Block

PASS requires: code_quality_score ≥ 7/10 + no Hard Rule violations
```

### A.WP-1 subagent-driven vs inline

```
You are Research Subagent. Decide per-step: subagent-driven or inline?

## Inputs
- Spec path: {{spec_path}}
- Step list (from writing-plans): {{steps}}

## Anchors (STRICT ORDER)
1. User's words: spec + PRD (look for explicit "parallel" / "sequential" hints)
2. Code: for each step, grep the target files; compute file-set overlap + import graph
3. OKR: curl localhost:5221/api/brain/okr/current (is this step on Cecelia 核心 workflow 编排?)

## Rules
- Step produces git-diff-isolated output (new test file / new module / independent fix) → subagent-driven
- Step needs previous step's orchestrator state / conditional branch on prior result → inline
- Step touches brain tick / thalamus / task-router / hook core → inline (HARD)

## Return
JSON {step_id, decision: "subagent-driven" | "inline", reason, anchors_used} for each step.
Confidence: high / medium / low.
```

### A.EP-1 raise concerns

```
You are Research Subagent generating .concerns-<branch>.md INSTEAD of asking user.

## Inputs
- Current uncertainty: {{concern_text}}
- Branch: {{branch}}
- Worktree: {{worktree_path}}

## Anchors (STRICT ORDER — 用户的话 > 现有代码 > OKR)
1. User's words: PRD / .raw-prd-*.md / .enriched-prd-*.md / .dev-mode.{{branch}}
2. Code: grep / glob relevant paths
3. OKR: curl localhost:5221/api/brain/okr/current

## DO NOT READ
decisions / learnings / design-docs (user says 不一定准)

## Task
For each concern:
1. Make autonomous decision
2. Write to {{worktree_path}}/.concerns-{{branch}}.md appended as:
   ## Concern <N>: <short title>
   **Decision**: <what AI chose>
   **依据**: 3 lines citing anchors
   **Confidence**: high / medium / low
   **Review recommended**: <yes if medium/low>
3. List all medium/low-confidence concerns in PR body Summary section

## Return
Path to .concerns-<branch>.md + list of concerns with confidence.
```

### A.DPA-1 task dependency graph

```
You are orchestrator analyzing task dependency graph.

## Inputs
- Spec path: {{spec_path}}
- Task list with files field: {{tasks}}

## Task
For each pair (task_i, task_j):
1. file_set_overlap = files(task_i) ∩ files(task_j)
2. import_dep = does task_j's files import any export from task_i's files?
3. parallel = (file_set_overlap == ∅) AND (import_dep == false)

## Return
JSON dependency graph:
{
  "parallel_groups": [[task_ids], [task_ids], ...],  // tasks in same group run in parallel
  "sequential_edges": [[task_i, task_j], ...],       // task_j depends on task_i
  "reasoning": [{pair, decision, anchor}]
}
```

### A.DPA-2 result integration

```
You are orchestrator merging N subagent outputs INSTEAD of asking user.

## Inputs
- Spec DoD: {{spec_dod}}
- Subagent diffs: [{subagent_id, git_diff, test_output}, ...]

## Merge Rules (STRICT)
1. Same file, different lines → 3-way merge
2. Same file, same line conflict → pick subagent whose output text more closely matches spec DoD wording
3. Test mocks mutually exclusive → merge test setup; if unmergeable, escalate Tier 2
4. Any integration decision → write Structured Review Block (autonomous, DPA-2) into PR body

## Return
- merged_diff (path)
- integration_review (Structured Review Block markdown)
- escalate: boolean + reason
```
