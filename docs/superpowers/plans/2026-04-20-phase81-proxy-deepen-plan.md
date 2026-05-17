# Phase 8.1 proxy 深度化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Superpowers 32 个交互点中 13 个关键路径点（brainstorming 6 + SDD 3 + RCR 4）的 proxy prompt 深度化，落入 `autonomous-research-proxy.md`，配 Structured Review Block 规范。

**Architecture:** 单文件扩展——`packages/engine/skills/dev/steps/autonomous-research-proxy.md` 在现有 Tier 1/2/3 总表之后追加"13 点深度规则" section + "Structured Review Block 规范" + "Appendix A Research Subagent Prompts"。Engine 版本 bump 17 → 18.0.0（major，proxy 行为根本性扩展）。

**Tech Stack:** Node.js + vitest；Engine 版本 6 处同步；feature-registry.yml 新 changelog；path-views 自动重生。

---

## File Structure

- **Modify**：`packages/engine/skills/dev/steps/autonomous-research-proxy.md`（87 行 → ~300 行）
- **Create**：`packages/engine/tests/proxy/phase81-13-points.test.ts`
- **Modify（版本同步 6 处）**：
  - `packages/engine/VERSION`
  - `packages/engine/package.json`
  - `packages/engine/package-lock.json`（2 处 `"version"` 字段）
  - `packages/engine/.hook-core-version`
  - `packages/engine/hooks/VERSION`
  - `packages/engine/regression-contract.yaml`
- **Modify**：`packages/engine/feature-registry.yml`（新 phase-8.1 entry）
- **Regen**：`packages/engine/docs/path-views/*`（脚本生成）
- **Create**：`docs/learnings/cp-0420093736-phase81-proxy-deepen.md`（Learning file，push 前必须有）

---

## Task 1：写 phase81-13-points.test.ts（失败态）

**Files:**
- Create: `packages/engine/tests/proxy/phase81-13-points.test.ts`

- [ ] **Step 1.1：创建测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROXY_PATH = resolve(__dirname, '../../skills/dev/steps/autonomous-research-proxy.md');

describe('Phase 8.1 proxy 13-point deepening', () => {
  const content = readFileSync(PROXY_PATH, 'utf8');

  const anchors = [
    'B-1 视觉陪伴',
    'B-2 scope decomposition',
    'B-3 clarifying questions',
    'B-4 design review',
    'B-5 spec approval',
    'B-6 spec self-review',
    'SDD-1 implementer 问题',
    'SDD-2 spec reviewer',
    'SDD-3 code quality reviewer',
    'RCR-1 澄清 unclear',
    'RCR-2 外部冲突',
    'RCR-3 YAGNI check',
    'RCR-4 推回 reviewer',
  ];

  for (const anchor of anchors) {
    it(`contains anchor: ${anchor}`, () => {
      expect(content).toContain(anchor);
    });
  }

  it('declares Structured Review Block section', () => {
    expect(content).toContain('Structured Review Block');
  });

  it('declares data source ordering: 用户的话 > 现有代码 > OKR', () => {
    expect(content).toContain('用户的话 > 现有代码 > OKR');
  });

  it('declares "不用 decisions/learnings" rule', () => {
    expect(content).toMatch(/不(用|读).{0,10}decisions/);
  });

  it('contains Appendix A Research Subagent prompts', () => {
    expect(content).toContain('Appendix A');
    ['A.B-2', 'A.B-3', 'A.SDD-1', 'A.SDD-2', 'A.SDD-3'].forEach((p) => {
      expect(content).toContain(p);
    });
  });
});
```

- [ ] **Step 1.2：跑测试确认失败**

Run（在 worktree 根）：
```bash
cd packages/engine && npx vitest run tests/proxy/phase81-13-points.test.ts 2>&1 | tail -20
```

Expected：16+ assertions FAIL（anchor 不存在、Structured Review Block 不存在等）

- [ ] **Step 1.3：commit 失败的测试**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04200937-phase81-proxy-deepen
git add packages/engine/tests/proxy/phase81-13-points.test.ts
git commit -m "test: phase8.1 proxy 13-point anchors (failing baseline)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：扩写 autonomous-research-proxy.md

**Files:**
- Modify: `packages/engine/skills/dev/steps/autonomous-research-proxy.md`

- [ ] **Step 2.1：更新 frontmatter version 2.0.0 → 3.0.0**

把 header 改为：
```yaml
---
id: autonomous-research-proxy
version: 3.0.0
updated: 2026-04-20
changelog:
  - 3.0.0: Phase 8.1 — 13 个关键路径点深度化（brainstorming 6 + SDD 3 + RCR 4）+ Structured Review Block 规范 + Appendix A 5 个 Research Subagent prompt 模板 + 数据源排序（用户的话 > 现有代码 > OKR，不用 decisions/learnings）
  - 2.0.0: Phase 6 瘦身 — 删 F4 17 项交互点审计表、POC 参考、覆盖率统计、已删文件映射。加 Phase 6 Tier 1 两条（enrich + decisions/match）吸收已删的 engine-enrich / engine-decision skill 能力。
  - 1.0.0: 初版
---
```

- [ ] **Step 2.2：修改 Research Subagent 调用模板 section**

把原 Anchors（5 条含"Historical decisions / Related Learnings"）改为数据源排序版：

```markdown
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
```

- [ ] **Step 2.3：在 "## Phase 5 硬规则..." 之前追加新 section**

追加内容（在 `---` 分隔符之后）：

```markdown
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

**数据源**：PRD 长度 / capacity-budget API / `git diff main...HEAD --stat` 估算 LOC
**阈值（行业对齐 SmartBear + Microsoft Research）**：
- ≤ 200 LOC（软）→ 不拆，单 PR
- 200-400 LOC → 评估拆分，派 Research Subagent 判
- > 400 LOC（硬）→ 强制拆分

**Prompt**：见 Appendix A.B-2

#### B-3 clarifying questions

Superpowers 原问：
> "Ask questions one at a time to refine the idea... purpose / constraints / success criteria."

**数据源排序（STRICT）**：
1. 用户的话：PRD + .raw-prd-*.md + .dev-mode.<branch>
2. 现有代码：grep / glob / read
3. OKR：curl localhost:5221/api/brain/okr/current

**不读**：decisions / learnings / design-docs（用户"不一定准"）

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

**规则**：基于三件套数据源（用户的话 > 代码 > OKR）写推回理由，post 到 PR thread。
推回理由必须引用具体代码路径 / 规则条款 / OKR 方向。不问用户。

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
- Baseline: git diff main...HEAD --stat

## Task
Estimate LOC delta this PRD will produce.

## Rules
- ≤ 200 → {decision: "single_pr", loc: N}
- 200-400 → {decision: "evaluate_split", splits: [...]}
- > 400 → {decision: "must_split", splits: [{title, loc, deps}]}

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
```

- [ ] **Step 2.4：跑测试确认通过**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/cp-04200937-phase81-proxy-deepen/packages/engine && npx vitest run tests/proxy/phase81-13-points.test.ts 2>&1 | tail -10
```

Expected：所有 assertions PASS

- [ ] **Step 2.5：commit proxy 扩展**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04200937-phase81-proxy-deepen
git add packages/engine/skills/dev/steps/autonomous-research-proxy.md
git commit -m "feat(engine)[CONFIG]: phase8.1 proxy 13-point deepening

- B-1/B-2/B-3/B-4/B-5/B-6 (brainstorming)
- SDD-1/SDD-2/SDD-3 (subagent-driven-development)
- RCR-1/RCR-2/RCR-3/RCR-4 (receiving-code-review)
- Structured Review Block spec (B-4/B-5/B-6/SDD-2/SDD-3)
- Data source rule: 用户的话 > 现有代码 > OKR, 不用 decisions/learnings
- PR LOC thresholds: soft 200 / hard 400
- Appendix A 5 Research Subagent prompts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：Engine 版本 bump 17 → 18.0.0（6 处）

**Files:**
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/hooks/VERSION`
- Modify: `packages/engine/regression-contract.yaml`

- [ ] **Step 3.1：VERSION**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04200937-phase81-proxy-deepen
echo "18.0.0" > packages/engine/VERSION
```

- [ ] **Step 3.2：package.json**

Edit `packages/engine/package.json`：`"version": "17.0.0"` → `"version": "18.0.0"`

- [ ] **Step 3.3：package-lock.json（2 处）**

用 node 脚本改两处 version 字段（不改其他 dep lock）：
```bash
node -e "
const fs = require('fs');
const p = 'packages/engine/package-lock.json';
let c = fs.readFileSync(p, 'utf8');
// 顶层 version + packages[''].version
c = c.replace(/\"version\": \"17\.0\.0\"/g, '\"version\": \"18.0.0\"');
fs.writeFileSync(p, c);
console.log('bumped');
"
```

Expected：两处 `17.0.0` → `18.0.0`

- [ ] **Step 3.4：.hook-core-version**

```bash
echo "18.0.0" > packages/engine/.hook-core-version
```

- [ ] **Step 3.5：hooks/VERSION**

```bash
echo "18.0.0" > packages/engine/hooks/VERSION
```

- [ ] **Step 3.6：regression-contract.yaml**

Edit `packages/engine/regression-contract.yaml`：`version: 17.0.0` → `version: 18.0.0`

- [ ] **Step 3.7：跑 version sync check**

```bash
bash scripts/check-version-sync.sh 2>&1 | tail -10
```

Expected：pass（6 处同步）

- [ ] **Step 3.8：commit 版本 bump**

```bash
git add packages/engine/VERSION packages/engine/package.json packages/engine/package-lock.json packages/engine/.hook-core-version packages/engine/hooks/VERSION packages/engine/regression-contract.yaml
git commit -m "chore(engine): bump version 17.0.0 → 18.0.0 (phase 8.1 major)

proxy 行为根本性扩展——13 点深度 prompt + Structured Review Block。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：feature-registry.yml + path-views regen

**Files:**
- Modify: `packages/engine/feature-registry.yml`
- Regen: `packages/engine/docs/path-views/*`

- [ ] **Step 4.1：查 feature-registry 结构**

```bash
head -60 packages/engine/feature-registry.yml
```

- [ ] **Step 4.2：追加 phase-8.1 entry**

在 `changelog:` 顶部（最新在上）加：

```yaml
  - version: 18.0.0
    date: 2026-04-20
    phase: phase-8.1
    summary: "autonomous-research-proxy 13 点深度化（brainstorming 6 + SDD 3 + RCR 4）+ Structured Review Block 规范 + 数据源排序（用户的话 > 现有代码 > OKR，不用 decisions/learnings）+ PR LOC 软 200 / 硬 400 阈值"
    changed_files:
      - packages/engine/skills/dev/steps/autonomous-research-proxy.md
      - packages/engine/tests/proxy/phase81-13-points.test.ts
```

（若 feature-registry 结构不同，按现有模式调整）

- [ ] **Step 4.3：regen path-views**

```bash
bash packages/engine/scripts/generate-path-views.sh 2>&1 | tail -5
```

- [ ] **Step 4.4：commit registry + path-views**

```bash
git add packages/engine/feature-registry.yml packages/engine/docs/path-views/
git commit -m "chore(engine): feature-registry + path-views for phase 8.1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：Learning file + DoD 勾选

**Files:**
- Create: `docs/learnings/cp-0420093736-phase81-proxy-deepen.md`
- Modify: `docs/superpowers/specs/2026-04-20-phase81-proxy-deepen-design.md`（勾选 DoD）

- [ ] **Step 5.1：写 Learning 文件**

```markdown
# cp-0420093736-phase81-proxy-deepen — Learning

## 背景

Phase 8.1：把 Superpowers 32 个交互点中 13 个关键路径点的 proxy prompt 深度化。

## 根本原因

Phase 6 瘦身后 proxy.md 只覆盖 17 个交互点且为"浅层固定默认值"，用户要求"完全自主 + AI 深度研究"。走偏根因：把 decisions/learnings 列为核心 anchor（用户说"不一定准"），没有围绕"用户的话 > 代码 > OKR"建立数据源排序。

## 下次预防

- [ ] 任何 autonomous 回答规则：数据源排序声明必须放在 prompt 首部，且明确"不读 X"
- [ ] 任何"问用户"的交互点新增 → 默认先写 proxy 深度规则，再写人为 gate 否决
- [ ] Structured Review Block 规范落地到 Brain（Phase 8.3），替代"打分"口头约定
```

- [ ] **Step 5.2：DoD 勾选**

把 spec 末尾 DoD 6 条全部 `[ ]` → `[x]`（push 前硬规则）：

```bash
cd /Users/administrator/worktrees/cecelia/cp-04200937-phase81-proxy-deepen
node -e "
const fs = require('fs');
const p = 'docs/superpowers/specs/2026-04-20-phase81-proxy-deepen-design.md';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/- \[ \]/g, '- [x]');
fs.writeFileSync(p, c);
"
```

- [ ] **Step 5.3：commit Learning + DoD 勾选**

```bash
git add docs/learnings/cp-0420093736-phase81-proxy-deepen.md docs/superpowers/specs/2026-04-20-phase81-proxy-deepen-design.md
git commit -m "docs: learning + DoD ticked for phase 8.1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 最终检查

- [ ] **Step 6.1：全量测试**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04200937-phase81-proxy-deepen/packages/engine
npx vitest run tests/proxy/phase81-13-points.test.ts 2>&1 | tail -5
```

Expected：全绿

- [ ] **Step 6.2：version sync**

```bash
bash scripts/check-version-sync.sh 2>&1 | tail -5
```

- [ ] **Step 6.3：git log 看 commit 历史**

```bash
git log --oneline main..HEAD
```

Expected：5 commits（spec / test / proxy / version / registry / learning — 或合并相邻）
