# Phase 8.1 设计：autonomous-research-proxy 关键路径 13 点深度化

**日期**：2026-04-20
**分支**：`cp-0420093736-cp-04200937-phase81-proxy-deepen`
**Engine 版本**：v17.x → v18.0.0（major — proxy 行为根本性扩展）

---

## 背景

Phase 5/6/7 把 Cecelia /dev 工作流重构成 7 棒接力链 + 多 worktree session 路由修复。当前 proxy（`packages/engine/skills/dev/steps/autonomous-research-proxy.md` 87 行）只覆盖 Superpowers 32 个交互点中的 17 个（53%），且覆盖点以"给固定默认值"的浅层代答为主，不是"深度研究后回答"。

用户 2026-04-20 对话确立的方向：

- Cecelia /dev 要**完全自主**，0 个人为 gate
- 把 Superpowers 所有"问用户"点替换为"AI 深度研究后给答案"
- 数据源排序：**用户的话 > 现有代码 > OKR 方向**。**不用 decisions / learnings**（用户说"不一定准"）
- 每个自主决策必须生成 structured review（依据 + confidence + 质量分 + 风险），供事后追踪

---

## 范围

### 做（13 个关键路径点）

| 分组 | 点 | Superpowers 原问 |
|------|-----|------------------|
| brainstorming | B-1 visual companion | "Some of what we're working on might be easier to explain if I can show it in a browser. Want to try it?" |
| | B-2 scope decomposition | "If the project is too large for a single spec, help the user decompose into sub-projects" |
| | B-3 clarifying questions | 一次一个 Q，问 purpose / constraints / success criteria |
| | B-4 design review | "Ask after each section whether it looks right so far" |
| | B-5 spec approval | "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes" |
| | B-6 spec self-review | placeholder / consistency / scope / ambiguity 四检 |
| subagent-driven-development | SDD-1 implementer questions | "If subagent asks questions: Answer clearly and completely" |
| | SDD-2 spec reviewer | "Spec reviewer confirms code matches spec? yes/no" |
| | SDD-3 code quality reviewer | "Code quality reviewer approves? yes/no" |
| receiving-code-review | RCR-1 澄清 unclear | "IF any item is unclear: STOP - ASK for clarification" |
| | RCR-2 外部冲突 | "IF conflicts with your human partner's prior decisions: Stop and discuss with your human partner first" |
| | RCR-3 YAGNI check | "grep codebase for actual usage. IF unused: 'Remove it (YAGNI)?'" |
| | RCR-4 推回 reviewer | "Push back with technical reasoning" |

### 不做

- Phase 8.2 的 10 点（writing-plans / executing-plans / TDD / FAD / SD / RCR-REQ / DPA / UGW）
- Phase 8.3 的基础设施（PR 行数阈值全局规则 / 打分机制落地到 Brain）
- 不改 Superpowers 原生 SKILL.md（只改 Cecelia 的 proxy.md）
- 不改 hook 行为 / CI workflow / SDD 或 brainstorming 原文

---

## 方案：扩展 proxy.md 为"按点深化"结构

**选 A（实施方案）**：单文件 proxy.md，扩到"按 skill 分组 × 按点给完整 prompt"结构。保持 Tier 1/2/3 总表作为索引，每个深化点追加子章节。

备选（已否决）：
- 选 B：每个 skill 拆一个子文件（proxy-brainstorming.md / proxy-sdd.md / proxy-rcr.md）。否决理由：Phase 6 刚把 enrich/decision skill 合进 proxy.md，再拆回去违反"集中规则"原则。
- 选 C：把规则写进 /dev SKILL.md 主体。否决理由：/dev SKILL.md 现 228 行（Phase 6 瘦身结果），不再扩。proxy.md 是"按需 Read"设计，扩它不影响主 agent 每次调用的 token。

---

## 深化后的 proxy.md 结构

```
## Tier 1 — 工作流阻塞（必须替换）
<现有总表保留>

## Tier 2 — 异常升级
<现有总表保留>

## Tier 3 — 丢弃
<现有总表保留>

## Research Subagent 调用模板（通用）
<现有保留，去掉 "历史 decisions / learnings" anchor>

## Model Selection
<现有保留>

## Confidence Handling
<现有保留>

## Phase 5 硬规则
<现有保留>

## ===== Phase 8.1 新增：13 点深度规则 =====

### brainstorming

#### B-1 视觉陪伴（visual companion）
- Superpowers 原问：<verbatim>
- 规则：Tier 3 已丢弃，不启用（所有内容走 terminal 文本）
- 输出：无（跳过 offer 步骤）

#### B-2 scope decomposition
- Superpowers 原问：<verbatim>
- 数据源：PRD 字数 + capacity-budget API + PR 行数阈值
- 规则：
  - 预估改动 ≤ 200 行 → 不拆（单 PR）
  - 200-400 行 → 评估拆分（派 subagent 判）
  - > 400 行 → 强制拆（派 subagent 产出拆分清单）
- Research Subagent prompt：见下方 Appendix A.B-2

#### B-3 clarifying questions
- Superpowers 原问：<verbatim>
- 数据源（有序）：
  1. 用户的话（PRD + .raw-prd-*.md + dev-mode.<branch> 对话）
  2. 现有代码（grep + glob + read）
  3. OKR 方向（curl localhost:5221/api/brain/okr/current）
- **不读** decisions / learnings / design-docs
- Research Subagent prompt：见下方 Appendix A.B-3

#### B-4 design review
- Superpowers 原问：<verbatim>
- 规则：直接 APPROVE（不给用户逐段确认机会）；把 3 方案对比 + 推荐 + 理由写进 design doc
- Output：structured review block（见下方"Structured Review Block 规范"）

#### B-5 spec approval
- Superpowers 原问：<verbatim>
- 规则：AI 自动进入 writing-plans；同时生成 structured review 写进 design doc 末尾
- Output：structured review block

#### B-6 spec self-review（placeholder/consistency/scope/ambiguity）
- Superpowers 原问：<verbatim>
- 规则：派 reviewer subagent 对照 4 项清单扫，发现问题 inline 修
- Output：structured review block（附 "fix_count: N"）

### subagent-driven-development

#### SDD-1 implementer 问题
- Superpowers 原问：<verbatim>
- 规则：orchestrator 用三件套数据源（用户的话 > 代码 > OKR）给答复
- 不升级用户
- Research Subagent prompt：见 Appendix A.SDD-1

#### SDD-2 spec reviewer
- Superpowers 原问：<verbatim>
- 规则：reviewer subagent 按 spec compliance 清单审 + 输出 structured review
- PASS 条件：spec_match_score ≥ 8/10 且 quality_score ≥ 7/10
- Research Subagent prompt：见 Appendix A.SDD-2

#### SDD-3 code quality reviewer
- Superpowers 原问：<verbatim>
- 规则：reviewer subagent 按 Cecelia 硬规则扫：
  - `feat:` 必须含 `*.test.ts`
  - 不加 fallback / 未来需求 / 无必要 abstraction（全局 CLAUDE.md）
  - DoD 三要素（BEHAVIOR / push 前勾选 / feat 有测试）
  - 单文件 > 500 行拆分；重复 3 次提取函数
- Output：structured review block
- Research Subagent prompt：见 Appendix A.SDD-3

### receiving-code-review

#### RCR-1 澄清 unclear
- Superpowers 原问：<verbatim>
- 规则：派 subagent 读 diff + 本 PR 改动的文件 + reviewer 评论上下文推断
- 推断 confidence ≥ medium → 回复 "我理解是 X，如不对请明示" 并实施
- confidence low → 在 thread 中留 "无法确定 X，列出两种解释 + 选 Y"

#### RCR-2 外部冲突（reviewer 建议 vs 用户规则）
- Superpowers 原问：<verbatim>
- 优先级（硬规则）：
  1. 全局 CLAUDE.md + 项目 .claude/CLAUDE.md + 用户的话
  2. Cecelia DoD / 提交规则 / 版本规则
  3. Reviewer 建议
- 前者胜 → AI 在 thread 中写 "按用户规则 X，不接受此建议，理由..." 并继续
- 不询问用户

#### RCR-3 YAGNI check
- Superpowers 原问：<verbatim>
- 规则：派 subagent `grep` 代码找使用点
- 未使用 → 推回 "grep 未找到 usage，按 YAGNI 不加"
- 有使用 → 实施

#### RCR-4 推回 reviewer
- Superpowers 原问：<verbatim>
- 规则：基于三件套数据源（用户的话 > 代码 > OKR）写推回理由，post 到 PR thread
- 不问用户；推回理由必须引用具体代码/规则/OKR 方向

## ===== Structured Review Block 规范 =====

四个自审点（B-4 / B-5 / B-6 / SDD-2 / SDD-3）输出格式：

```markdown
## Review（autonomous，<point-code>）

**依据**：
- 用户的话：<引用 PRD / 对话的哪几行>
- 代码：<grep 出的路径/函数>
- OKR：<curl /api/brain/okr/current 的哪条>

**判断**：APPROVE / REQUEST_CHANGES / PASS_WITH_CONCERNS

**confidence**：HIGH / MEDIUM / LOW

**质量分**：X/10（B-4 design_quality / B-5 spec_completeness / B-6 spec_cleanliness / SDD-2 spec_match / SDD-3 code_quality）

**风险**：
- <一行一条，具体风险 + 影响>

**下一步**：<推进到 writing-plans / 修完再审 / 升级人工 review>
```

---

## ===== Appendix A：Research Subagent Prompts（可直接 copy-paste） =====

### A.B-2 scope decomposition prompt

```
You are Research Subagent. Estimate PRD scope.

## Inputs
- PRD path: {{prd_path}}
- Capacity API: curl localhost:5221/api/brain/capacity-budget
- Main branch baseline: git diff main...HEAD --stat

## Task
Estimate code lines this PRD will change (LOC delta).

## Rules
- ≤ 200 LOC → return {decision: "single_pr", estimated_loc: N, reason: "within soft threshold"}
- 200-400 LOC → return {decision: "evaluate_split", splits: [...], reason: "near hard threshold"}
- > 400 LOC → return {decision: "must_split", splits: [{title, loc, deps}], reason: "exceeds 400-line hard threshold"}

## Return
JSON above + confidence (high/medium/low) + anchors used (user_words/code/okr).
```

### A.B-3 clarifying questions prompt

```
You are Research Subagent answering clarifying question INSTEAD of user.

## Clarifying question (verbatim from brainstorming)
{{question}}

## Anchors (STRICT ORDER — do not skip)
1. User's words: Read {{prd_path}} + any .raw-prd-*.md + .dev-mode.{{branch}} dialogue lines
2. Code reality: grep / glob relevant paths
3. OKR direction: curl localhost:5221/api/brain/okr/current

## DO NOT READ
- docs/decisions/ / curl decisions API / docs/learnings/ / docs/superpowers/specs/*-design.md

## Return
**答案**：1 句话
**理由**：3 条，每条引用具体 anchor（"PRD 第 X 行 / grep 出的 Y / OKR KR-Z"）
**置信度**：high / medium / low
**Superpowers 怎么继续**：<one-liner>
```

### A.SDD-1 implementer questions prompt

```
You are orchestrator answering implementer subagent's question INSTEAD of user.

## Implementer's question
{{question}}

## Anchors (STRICT ORDER)
1. User's words: spec doc + PRD + conversation
2. Code: grep spec-referenced files
3. OKR: curl localhost:5221/api/brain/okr/current

## Return
Single-paragraph answer citing specific anchor. No hedging. Implementer proceeds.
```

### A.SDD-2 spec reviewer prompt

```
You are spec compliance reviewer.

## Inputs
- Spec path: {{spec_path}}
- Task: {{task_text}}
- Diff: {{git_diff_since_task_start}}

## Task
Check code implements spec's task requirements (neither less nor more).

## Output: Structured Review Block
<see Structured Review Block 规范>

PASS requires: spec_match_score ≥ 8/10
```

### A.SDD-3 code quality reviewer prompt

```
You are code quality reviewer. Cecelia hard rules.

## Inputs
- Diff: {{git_diff}}
- CLAUDE.md (global + project)

## Check List (硬规则)
1. feat: commit must include *.test.ts (per global CLAUDE.md)
2. DoD 三要素：[BEHAVIOR] label / push 前 [x] / feat 有测试
3. No fallback for impossible states / no future-speculative code
4. Single file ≤ 500 lines (soft), split if larger
5. No unused imports / commented-out code / console.log left behind
6. No emojis unless user explicitly requested

## Output: Structured Review Block
<see Structured Review Block 规范>

PASS requires: code_quality_score ≥ 7/10 且无 1-3 项违反
```

---

## Testing

`packages/engine/tests/proxy/phase81-13-points.test.ts`：

- 读取 `packages/engine/skills/dev/steps/autonomous-research-proxy.md`
- 断言 13 个锚存在：`B-1 视觉陪伴` / `B-2 scope decomposition` / `B-3 clarifying questions` / `B-4 design review` / `B-5 spec approval` / `B-6 spec self-review` / `SDD-1 implementer 问题` / `SDD-2 spec reviewer` / `SDD-3 code quality reviewer` / `RCR-1 澄清 unclear` / `RCR-2 外部冲突` / `RCR-3 YAGNI check` / `RCR-4 推回 reviewer`
- 断言 "Structured Review Block 规范" section 存在
- 断言"用户的话 > 现有代码 > OKR"数据源排序声明存在
- 断言 "不用 decisions" 或 "不读 decisions" 声明存在
- 断言 Appendix A 下 5 个 prompt 模板存在

---

## 版本同步（6 处 + registry + path-views）

| 文件 | 改动 |
|------|------|
| `packages/engine/VERSION` | `17.x.x` → `18.0.0` |
| `packages/engine/package.json` | version 18.0.0 |
| `packages/engine/package-lock.json` | 两处 version 18.0.0 |
| `packages/engine/.hook-core-version` | 18.0.0 |
| `packages/engine/hooks/VERSION` | 18.0.0 |
| `packages/engine/regression-contract.yaml` | version 18.0.0 |
| `packages/engine/feature-registry.yml` | 新 changelog 条目 |
| `packages/engine/docs/path-views/*` | `bash packages/engine/scripts/generate-path-views.sh` 重生 |

---

## DoD

- [ ] [ARTIFACT] `packages/engine/skills/dev/steps/autonomous-research-proxy.md` 含 13 个深化锚点
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');['B-1','B-2','B-3','B-4','B-5','B-6','SDD-1','SDD-2','SDD-3','RCR-1','RCR-2','RCR-3','RCR-4'].forEach(p=>{if(!c.includes(p))process.exit(1)})"`
- [ ] [ARTIFACT] proxy.md 含 Structured Review Block 规范
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');if(!c.includes('Structured Review Block'))process.exit(1)"`
- [ ] [ARTIFACT] proxy.md 声明数据源排序"用户的话 > 现有代码 > OKR"且"不用 decisions"
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');if(!c.includes('用户的话 > 现有代码 > OKR'))process.exit(1);if(!c.match(/不(用|读) decisions/))process.exit(1)"`
- [ ] [BEHAVIOR] 跑测试验证 13 点 anchor 存在
  - Test: `tests/proxy/phase81-13-points.test.ts`
- [ ] [ARTIFACT] 版本同步到 18.0.0（6 处）
  - Test: `manual:bash -c "for f in packages/engine/VERSION packages/engine/.hook-core-version packages/engine/hooks/VERSION; do grep -q '18\.0\.0' \$f || exit 1; done"`
- [ ] [ARTIFACT] `feature-registry.yml` 新 phase-8.1 条目
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('phase-8.1'))process.exit(1)"`

---

## Review（autonomous，brainstorming）

**依据**：
- 用户的话：对话记录 2026-04-20 逐点 32 交互分类结果（"30 AI 自动化 / 1 硬 gate / 1 理论人为"）+ 明确"完全自主 0 gate"
- 代码：现有 proxy.md 87 行（Phase 6 瘦身结果）+ Superpowers 三个 SKILL.md 原文
- OKR：Cecelia Engine KR — /dev 工作流自主化闭环

**判断**：APPROVE

**confidence**：HIGH

**质量分**：9/10

**风险**：
- R1：13 个 prompt 模板质量依赖于 Appendix A 的具体措辞；如果模板在 implementer 处触发 confidence LOW，会暂停流程（按 proxy.md 现有规则）
- R2：A.B-2 需要 capacity-budget API 可用；Brain 挂了此点降级

**下一步**：进入 writing-plans
