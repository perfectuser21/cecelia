# Harness v2 M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harness v2 M3 — 把 GAN 合同从 v1 的 `## Workstreams` 模板升级为 v2 的 `## Tasks` 模板（强制测试金字塔 + E2E Acceptance），Reviewer 从"避免过度挑剔"改为强 skeptical（每轮 ≥2 风险点），新增 DAG/E2E/测试金字塔 3 挑战维度。

**Architecture:** 只改 SKILL.md（4 份同步）+ harness-graph.js 的 parseTasks/reviewer prompt。保留 parseWorkstreams 向后兼容。不动 Generator/Evaluator 节点（M4）。不改 initiative_contracts 写入（M2/M4）。

**Tech Stack:** Node.js ESM (Vitest for tests)，Markdown skills。

---

## File Structure

- **Create**：
  - `packages/brain/src/__tests__/harness-parse-tasks.test.js` — parseTasks 单元测试 + SKILL 格式校验
- **Modify**：
  - `packages/brain/src/harness-graph.js` — 新增 `parseTasks()`；proposer 调用 parseTasks 作为主，parseWorkstreams 作为 fallback；reviewer prompt 删"避免无限挑剔"+注入 3 挑战维度
  - `~/.claude-account1/skills/harness-contract-proposer/SKILL.md`（+ account2/account3/~/.claude 共 4 份同步）
  - `~/.claude-account1/skills/harness-contract-reviewer/SKILL.md`（+ account2/account3/~/.claude 共 4 份同步）

---

### Task 1: 新增 parseTasks + 单元测试（TDD 开头）

**Files:**
- Test: `packages/brain/src/__tests__/harness-parse-tasks.test.js`
- Modify: `packages/brain/src/harness-graph.js`（export parseTasks）

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/src/__tests__/harness-parse-tasks.test.js`，含 5 块测试：

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseTasks, parseWorkstreams } from '../harness-graph.js';

describe('parseTasks', () => {
  const contractV2 = `
# Sprint Contract Draft

## Tasks

### Task: task-alpha
**title**: 实现 A 功能
**scope**: 只动 moduleA
**depends_on**: []
**files**: [src/a.js]

#### DoD
- [ARTIFACT] 文件 src/a.js 存在
- [BEHAVIOR] 调 /api/a 返回 200

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: moduleA.funcA 返回值

#### Integration Test Plan（强制）
- 场景 1: moduleA + moduleB 联调

#### 验证命令
- manual:node -e "require('./src/a.js')"

### Task: task-beta
**title**: 实现 B 功能
**scope**: 只动 moduleB
**depends_on**: [task-alpha]
**files**: [src/b.js]

#### DoD
- [BEHAVIOR] 调 /api/b 返回 200

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: moduleB.funcB

#### Integration Test Plan（强制）
- 场景 1: moduleB 读 DB

#### 验证命令
- manual:curl localhost:5221/api/b

### Task: task-gamma
**title**: 实现 C 功能
**scope**: 只动 moduleC
**depends_on**: [task-beta]
**files**: [src/c.js]

#### DoD
- [ARTIFACT] 文件 src/c.js 存在

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: moduleC.funcC

#### Integration Test Plan（强制）
- 场景 1: moduleC + moduleA 联调

#### 验证命令
- manual:node -e "require('./src/c.js')"

## E2E Acceptance

- Given 用户 X，When 调 /api/a，Then 返回 ...
- curl: curl -sf localhost:5221/api/a
`;

  const contractV1 = `
# Old Contract

## Workstreams

workstream_count: 2

### Workstream 1: ws-alpha
**范围**: 改 A
**DoD**:
- [ ] [BEHAVIOR] 行为 A
  Test: curl localhost:5221/api/a
`;

  it('V2 合同：parseTasks 返回 3 个 task', () => {
    const tasks = parseTasks(contractV2);
    expect(tasks).toHaveLength(3);
    expect(tasks.map(t => t.task_id)).toEqual(['task-alpha', 'task-beta', 'task-gamma']);
  });

  it('V2 合同：每个 task 含 dod / unit_test_plan / integration_test_plan 字段', () => {
    const tasks = parseTasks(contractV2);
    for (const t of tasks) {
      expect(t.dod).toBeTruthy();
      expect(t.unit_test_plan).toBeTruthy();
      expect(t.integration_test_plan).toBeTruthy();
    }
    expect(tasks[0].dod).toMatch(/ARTIFACT|BEHAVIOR/);
    expect(tasks[0].unit_test_plan).toMatch(/覆盖点/);
    expect(tasks[0].integration_test_plan).toMatch(/场景/);
  });

  it('V2 合同：task 含 title / scope / depends_on / files 字段', () => {
    const tasks = parseTasks(contractV2);
    expect(tasks[0].title).toContain('A 功能');
    expect(tasks[0].scope).toContain('moduleA');
    expect(tasks[0].depends_on).toEqual([]);
    expect(tasks[1].depends_on).toEqual(['task-alpha']);
    expect(tasks[0].files).toContain('src/a.js');
  });

  it('V1 合同（Workstreams 格式）：parseTasks 返回空数组', () => {
    const tasks = parseTasks(contractV1);
    expect(tasks).toEqual([]);
  });

  it('V1 合同：parseWorkstreams 仍能解析（向后兼容）', () => {
    const ws = parseWorkstreams(contractV1);
    expect(ws.length).toBeGreaterThan(0);
    expect(ws[0].index).toBe(1);
  });

  it('空/非字符串输入：parseTasks 返回空数组', () => {
    expect(parseTasks(null)).toEqual([]);
    expect(parseTasks('')).toEqual([]);
    expect(parseTasks(undefined)).toEqual([]);
  });
});

describe('SKILL.md 格式校验', () => {
  const account1 = join(homedir(), '.claude-account1', 'skills');
  const proposerPath = join(account1, 'harness-contract-proposer', 'SKILL.md');
  const reviewerPath = join(account1, 'harness-contract-reviewer', 'SKILL.md');

  it.runIf(existsSync(proposerPath))('Proposer SKILL.md 含 "## Tasks"', () => {
    const content = readFileSync(proposerPath, 'utf8');
    expect(content).toMatch(/##\s+Tasks/);
  });

  it.runIf(existsSync(proposerPath))('Proposer SKILL.md 含 "E2E Acceptance"', () => {
    const content = readFileSync(proposerPath, 'utf8');
    expect(content).toMatch(/E2E Acceptance/i);
  });

  it.runIf(existsSync(reviewerPath))('Reviewer SKILL.md 含 "找不到 ≥2 个" 或 "at least 2"', () => {
    const content = readFileSync(reviewerPath, 'utf8');
    expect(/找不到\s*≥\s*2\s*个|at least 2/i.test(content)).toBe(true);
  });

  it.runIf(existsSync(reviewerPath))('Reviewer SKILL.md 不含 "避免无限挑剔" 或 "避免过度挑剔"', () => {
    const content = readFileSync(reviewerPath, 'utf8');
    expect(content).not.toMatch(/避免无限挑剔/);
    expect(content).not.toMatch(/避免过度挑剔/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-parse-tasks.test.js 2>&1 | tail -30`
Expected: parseTasks 相关测试 FAIL（parseTasks 未导出），SKILL 测试也会 FAIL（文件未改）

- [ ] **Step 3: 实现 parseTasks**

在 `packages/brain/src/harness-graph.js`，紧接 `parseWorkstreams` 函数之后（约 352 行后）插入：

```javascript
/**
 * 从合同正文中解析 `## Tasks` 区块（Harness v2 M3 格式）。
 *
 * 每个 Task 子块结构：
 *   ### Task: <task_id>
 *   **title**: ...
 *   **scope**: ...
 *   **depends_on**: [id1, id2]
 *   **files**: [path1, path2]
 *
 *   #### DoD
 *   - [ARTIFACT] ...
 *   - [BEHAVIOR] ...
 *
 *   #### Unit Test Plan（强制测试金字塔）
 *   - 覆盖点 1: ...
 *
 *   #### Integration Test Plan（强制）
 *   - 场景 1: ...
 *
 *   #### 验证命令
 *   - manual:node -e "..."
 *
 * 返回数组；每项 `{ task_id, title, scope, depends_on[], files[], dod, unit_test_plan, integration_test_plan, verify_commands }`。
 * 若合同没有 `## Tasks` 区块或为空，返回空数组（调用方应 fallback 到 parseWorkstreams）。
 *
 * @param {string} contract 合同 markdown 原文
 * @returns {Array<{task_id:string,title:string,scope:string,depends_on:string[],files:string[],dod:string,unit_test_plan:string,integration_test_plan:string,verify_commands:string}>}
 */
export function parseTasks(contract) {
  if (!contract || typeof contract !== 'string') return [];

  // 找到 ## Tasks 标题（兼容"任务列表"/"Tasks"）
  const headRe = /^##\s+(?:Tasks|tasks|TASKS|任务列表)\s*$/im;
  const headMatch = contract.match(headRe);
  if (!headMatch) return [];

  const startIdx = headMatch.index + headMatch[0].length;
  const rest = contract.slice(startIdx);
  // 下一个同级 `## ` 或 EOF（避免吃掉 ### Task 子块）
  const nextHead = rest.match(/\n##\s+(?!#)\S/);
  const section = nextHead ? rest.slice(0, nextHead.index) : rest;

  // 按 `### Task:` 切块
  const taskBlockRe = /###\s+Task\s*[:：]\s*([^\n]+)\n([\s\S]*?)(?=\n###\s+Task\s*[:：]|\n##\s+\S|$)/gi;
  const tasks = [];
  let m;
  while ((m = taskBlockRe.exec(section)) !== null) {
    const taskId = (m[1] || '').trim();
    const body = m[2] || '';
    if (!taskId) continue;

    const title = extractBoldField(body, 'title');
    const scope = extractBoldField(body, 'scope');
    const depsRaw = extractBoldField(body, 'depends_on') || '[]';
    const filesRaw = extractBoldField(body, 'files') || '[]';

    const dod = extractSubSection(body, 'DoD');
    const unit = extractSubSection(body, 'Unit Test Plan');
    const integ = extractSubSection(body, 'Integration Test Plan');
    const verify = extractSubSection(body, '验证命令') || extractSubSection(body, 'Verify Commands');

    tasks.push({
      task_id: taskId,
      title: title || '',
      scope: scope || '',
      depends_on: parseListField(depsRaw),
      files: parseListField(filesRaw),
      dod: dod || '',
      unit_test_plan: unit || '',
      integration_test_plan: integ || '',
      verify_commands: verify || '',
    });
  }

  return tasks;
}

/**
 * 从 Task 子块正文里抓 `**field**: value` 到行尾。
 * @private
 */
function extractBoldField(body, field) {
  const re = new RegExp(`\\*\\*${field}\\*\\*\\s*[:：]\\s*([^\\n]*)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : '';
}

/**
 * 从 Task 子块正文里抓 `#### <name>` 到下一个 `#### ` 或块结束之间的内容。
 * @private
 */
function extractSubSection(body, name) {
  // name 允许带括号后缀（如 "Unit Test Plan（强制测试金字塔）"）
  const re = new RegExp(`####\\s+${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n####\\s+|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : '';
}

/**
 * 解析类似 `[id1, id2]` 或 `id1, id2` 的列表字段。
 * @private
 */
function parseListField(raw) {
  if (!raw) return [];
  const inner = raw.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner.split(/[,，]/).map(s => s.trim()).filter(Boolean);
}
```

- [ ] **Step 4: 运行测试确认 parseTasks 测试通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-parse-tasks.test.js 2>&1 | tail -30`
Expected: `parseTasks` describe 下 6 个测试全 PASS；SKILL.md 校验 4 个测试 FAIL（还没改 SKILL）

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-m3-gan-contract
git add packages/brain/src/harness-graph.js packages/brain/src/__tests__/harness-parse-tasks.test.js
git commit -m "feat(brain): add parseTasks for Harness v2 Tasks contract format"
```

---

### Task 2: proposer 节点调用 parseTasks + reviewer prompt 升级

**Files:**
- Modify: `packages/brain/src/harness-graph.js`

- [ ] **Step 1: 改 proposer 节点**

找到 proposer 节点中 `const workstreams = parseWorkstreams(output || '');` 行（约 486 行），改为：

```javascript
    // Harness v2 M3：先尝试解析 `## Tasks` 格式（新）
    // 老合同用 `## Workstreams` 则 fallback（向后兼容）
    let tasks = parseTasks(output || '');
    let workstreams;
    if (tasks.length > 0) {
      // 把 tasks 投影为 workstreams 形状，保证下游 Generator/Evaluator 继续能跑
      workstreams = tasks.map((t, i) => ({
        index: i + 1,
        name: t.task_id,
        ...(t.files?.length ? { files: t.files } : {}),
      }));
      console.log(
        `[harness-graph] proposer parsed Tasks(v2) count=${tasks.length} task=${taskId}: ${tasks.map(t => t.task_id).join(', ')}`
      );
    } else {
      workstreams = parseWorkstreams(output || '');
      console.log(
        `[harness-graph] proposer parsed Workstreams(v1) count=${workstreams.length} task=${taskId}: ${workstreams.map(w => `WS${w.index}(${w.name})`).join(', ')}`
      );
    }
```

并删除原有 `console.log(...)` 行（因为新代码已经各自打了 log）。

还要把 tasks 加入 return：

```javascript
    return {
      contract_content: output || null,
      acceptance_criteria: acceptanceCriteria,
      workstreams,
      tasks,                                      // v2 M3 新字段
      review_round: round,
      error: error || null,
      trace: `proposer(R${round},${tasks.length > 0 ? `tasks=${tasks.length}` : `ws=${workstreams.length}`})${error ? '(ERROR)' : ''}`,
    };
```

- [ ] **Step 2: 改 reviewer 节点 prompt**

找到 reviewer 节点的 prompt 模板（约 507-534 行），把"审查要求"段落整体替换：

```javascript
    const prompt = `你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${taskId}
**sprint_dir**: ${sprintDir}
**review_round**: ${round}

## PRD 内容
${state.prd_content || '（PRD 未生成）'}

## 合同草案
${state.contract_content || '（合同未生成）'}

## 验收标准（Given-When-Then）
${state.acceptance_criteria || '（验收标准未生成）'}

## 审查要求（Harness v2 M3 — skeptical tuning）

你的工作是**找风险**，不是认可合同。以下 3 个维度**每轮必须都真实挑战过**：

1. **DAG 合理性**：Task 之间的 depends_on 是否有隐藏耦合（应该依赖却没写）？是否可以更细粒度拆？是否有循环依赖？
2. **Initiative 级 E2E 覆盖**：合同 ## E2E Acceptance 是否覆盖跨 Task 行为（而不只是单 Task 级的用例）？Given-When-Then 里关键分支/异常路径是否完整？
3. **测试金字塔完整性**：每个 Task 是否同时有 **Unit Test Plan** 和 **Integration Test Plan**？只有 unit 没 integration（或反之）→ 必须 REVISION。

此外保持 v1 已有的挑战：
- 验证命令严格性（能否被假实现蒙混）
- 命令广谱（API→curl/UI→playwright/DB→psql/逻辑→node -e）
- DoD 条目格式（[ARTIFACT]/[BEHAVIOR] 标签 + Test 字段必填）

## 裁决规则（硬约束）

- **每一轮必须列出 ≥2 个具体风险点**（覆盖上述 3 维度中任意组合）。
- **找不到 ≥2 个具体风险点时不允许输出 APPROVED**，至少要选出 2 个挑战建议放到 REVISION 反馈。
- **APPROVED 唯一条件**：3 个维度（DAG / E2E / 测试金字塔）都真实挑战过且真的找不到新风险。
- 输出裁决：`VERDICT: APPROVED` 或 `VERDICT: REVISION`
- REVISION 时必须给出具体修改建议。`;
```

注意：务必**删除**原有"避免无限挑剔导致对抗循环无法收敛"整句。

- [ ] **Step 3: 跑已有相关测试确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-parse-tasks.test.js 2>&1 | tail -20`
Expected: parseTasks 部分 6 个测试 PASS（SKILL 测试仍 FAIL 待 Task 3/4 修）

- [ ] **Step 4: grep 确认"避免无限挑剔"在 harness-graph.js 中已删**

Run: `grep -n "避免无限挑剔\|避免过度挑剔" packages/brain/src/harness-graph.js || echo NONE`
Expected: NONE

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/harness-graph.js
git commit -m "feat(brain): proposer uses parseTasks with v1 fallback + reviewer skeptical prompt"
```

---

### Task 3: 改 harness-contract-proposer SKILL.md（4 份同步）

**Files:**
- Modify: `~/.claude-account1/skills/harness-contract-proposer/SKILL.md`
- Sync：account2 / account3 / `~/.claude`

- [ ] **Step 1: 重写 account1 SKILL.md**

用 Write 工具把 `/Users/administrator/.claude-account1/skills/harness-contract-proposer/SKILL.md` 整个替换为：

```markdown
---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v5.0 / v2 M3 GAN Layer 2a：
  Generator 角色，读取 PRD，提出合同草案（功能范围 + Tasks 拆分 + DoD + 测试金字塔 + 验证命令 + Initiative 级 E2E）。
  合同必须包含 ## Tasks 区块（每 Task 一个子块，强制 Unit + Integration test plan）+ ## E2E Acceptance 区块。
version: 5.0.0
created: 2026-04-08
updated: 2026-04-19
changelog:
  - 5.0.0: Harness v2 M3 — `## Workstreams` → `## Tasks`；每 Task 强制 Unit + Integration test plan；新增 Initiative 级 `## E2E Acceptance` 区块
  - 4.4.0: contract-dod-ws{N}.md 写入路径改为 ${SPRINT_DIR}/contract-dod-ws{N}.md
  - 4.3.0: 每个 workstream 输出独立 contract-dod-ws{N}.md
  - 4.2.0: 合同新增 ## Workstreams 区块
  - 4.1.0: 合同格式恢复验证命令代码块
  - 3.0.0: Harness v4.0 Contract Proposer（独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-contract-proposer — Harness v2 M3 Contract Proposer

**角色**: Generator（合同起草者）
**对应 task_type**: `harness_contract_propose`

---

## 职责

读取 sprint-prd.md，提出合同草案。合同必须包含：
- 每个 Task 的**行为描述**（可观测的外部行为，不引用内部实现）
- 每个 Task 的**DoD 条目**（[ARTIFACT] / [BEHAVIOR] 标签 + Test 字段）
- 每个 Task 的**测试金字塔**（Unit Test Plan + Integration Test Plan，两者均强制）
- 每个 Task 的**验证命令**（广谱：curl / npm test / psql / playwright / node -e）
- Initiative 级的 **## E2E Acceptance**（跨 Task 的 Given-When-Then + curl/playwright 命令列表）

**这是 GAN 对抗的起点**：Proposer 提出合同，Reviewer 从 DAG / E2E / 测试金字塔 / 验证严格性 4 个维度挑战，直到双方对齐。

---

## 执行流程

### Step 1: 读取 PRD

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_ROUND 由 cecelia-run 通过 prompt 注入，直接使用：
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || \
  cat "${SPRINT_DIR}/sprint-prd.md"
```

**如果是修订轮（propose_round > 1）**，读取上轮 Reviewer 的反馈：
```bash
if [ -n "$REVIEW_BRANCH" ]; then
  git fetch origin "${REVIEW_BRANCH}" 2>/dev/null || true
  git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/contract-review-feedback.md" 2>/dev/null || true
fi
```

### Step 2: 写合同草案 — ## Tasks 区块（v2 M3 新格式）

写入 `${SPRINT_DIR}/contract-draft.md`：

````markdown
# Sprint Contract Draft (Round {N})

## 范围总览

{Initiative 的 What，一段话}

## Tasks

下面每个 Task **必须**是 1 PR 1 分支可独立完成的单元（20–60 分钟）。
**depends_on**：列出此 Task 依赖的前序 task_id（无依赖写 `[]`）。
**files**：列出此 Task 预计会改的文件路径（尽量精确到单文件）。

### Task: task-001-<slug>

**title**: {Task 标题，一句话}
**scope**: {实现边界，与其他 Task 无交集}
**depends_on**: [task-000-xxx]
**files**: [packages/brain/src/foo.js, packages/brain/src/__tests__/foo.test.js]

#### DoD
- [ARTIFACT] {文件/配置 存在且格式正确}
  Test: node -e "require('fs').accessSync('packages/brain/src/foo.js'); console.log('OK')"
- [BEHAVIOR] {可观测行为描述}
  Test: node -e "const f = require('./packages/brain/src/foo.js'); if (f.hello() !== 'world') process.exit(1); console.log('PASS')"

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: {函数/方法名 + 预期行为}
- 覆盖点 2: {边界条件}
- 覆盖点 3: {错误路径}

#### Integration Test Plan（强制）
- 场景 1: {跨模块调用链路 + 预期结果}
- 场景 2: {与真实依赖交互的行为}

#### 验证命令
- manual:node -e "..."
- manual:curl -sf localhost:5221/api/brain/xxx

### Task: task-002-<slug>

**title**: ...
**scope**: ...
**depends_on**: []
**files**: [...]

#### DoD
- [BEHAVIOR] ...
  Test: ...

#### Unit Test Plan（强制测试金字塔）
- 覆盖点 1: ...

#### Integration Test Plan（强制）
- 场景 1: ...

#### 验证命令
- manual:...
````

**Tasks 拆分规则**：
- Initiative 级整体 4–5 个 Task（>6 个要显式 justification）
- 每个 Task 20–60 分钟内可完成
- 每个 Task 必须**独立可测试**（除 depends_on 列出的前序外）
- `depends_on` 是硬依赖（必须先合并）
- DoD 条目格式严格：`- [BEHAVIOR]` 或 `- [ARTIFACT]` 起头 + `Test:` 字段必填
- **测试金字塔强制**：每 Task 必须同时声明 Unit Test Plan **和** Integration Test Plan，二者均非空
- **Test 命令只使用 CI 白名单工具**：`node`/`npm`/`curl`/`bash`/`psql`（禁止 grep/ls/cat/sed/echo）

### Step 3: 写 Initiative 级 `## E2E Acceptance`（强制）

在合同末尾追加：

````markdown
## E2E Acceptance

Initiative 级**真实 E2E 验收**，跑在真 Brain (5222) + 真 Frontend + 真 PG。
每条场景以 Given-When-Then 描述业务行为，配套 curl/playwright 可执行命令。

### 场景 1: {端到端业务流水名}
- **Given**: {前置条件，如某种用户/数据状态}
- **When**: {用户动作或系统事件}
- **Then**: {期望的最终状态/响应}

**验证命令**:
```bash
curl -sf localhost:5222/api/.../... | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (d.status !== 'ok') { console.log('FAIL'); process.exit(1); }
  console.log('PASS');
"
```

**覆盖的 Tasks**: [task-001-xxx, task-002-yyy]

### 场景 2: {另一个端到端场景，覆盖异常/边界}
- **Given**: ...
- **When**: ...
- **Then**: ...

**验证命令**:
```bash
# 异常路径，如不存在资源返回 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5222/api/.../nonexistent")
[ "$STATUS" = "404" ] && echo PASS || (echo "FAIL: got $STATUS"; exit 1)
```

**覆盖的 Tasks**: [task-003-zzz]
````

**E2E Acceptance 写作规则**：
- 至少 2 个场景（happy path + 至少一个异常/边界）
- 每场景的 `覆盖的 Tasks` 字段指向合同里实际定义的 task_id，便于失败归因
- 命令必须可直接执行、无占位符（`{task_id}` 等）
- 命令的 exit code：成功=0，失败=非零

### Step 4: 建分支 + push + 回写 Brain

**重要**：在独立 cp-* 分支上 push，不能推 main。

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
PROPOSE_BRANCH="cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}"
git checkout -b "${PROPOSE_BRANCH}" 2>/dev/null || git checkout "${PROPOSE_BRANCH}"
mkdir -p "${SPRINT_DIR}"

# contract-draft.md 已由 Step 2/3 写入
git add "${SPRINT_DIR}/contract-draft.md"
git commit -m "feat(contract): round-${PROPOSE_ROUND} Tasks draft + E2E Acceptance"
git push origin "${PROPOSE_BRANCH}"
```

**最后一条消息**（字面量 JSON，不要用代码块包裹）：
```
{"verdict": "PROPOSED", "contract_draft_path": "${SPRINT_DIR}/contract-draft.md", "propose_branch": "cp-harness-propose-r1-xxxxxxxx", "task_count": N}
```
```

- [ ] **Step 2: 同步到 account2 / account3 / ~/.claude**

Run:
```bash
for dst in ~/.claude-account2 ~/.claude-account3 ~/.claude; do
  cp ~/.claude-account1/skills/harness-contract-proposer/SKILL.md "$dst/skills/harness-contract-proposer/SKILL.md"
done
# 验证 4 份一致
for p in ~/.claude-account1 ~/.claude-account2 ~/.claude-account3 ~/.claude; do
  md5 "$p/skills/harness-contract-proposer/SKILL.md"
done
```

Expected: 4 个 md5 相同

- [ ] **Step 3: 跑测试确认 Proposer 校验通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-parse-tasks.test.js 2>&1 | tail -20`
Expected: Proposer 相关两个 SKILL 测试 PASS（含 "## Tasks"、含 "E2E Acceptance"）

- [ ] **Step 4: 提交（注意 account/~/.claude 不在 worktree 内，只记录 commit 说明）**

`~/.claude-*` 目录不在 worktree 里（那是全局 skill 缓存），改动在本地生效无需 git add。提交本次只需推进 plan 状态，无文件变化跳过。

---

### Task 4: 改 harness-contract-reviewer SKILL.md（4 份同步）

**Files:**
- Modify: `~/.claude-account1/skills/harness-contract-reviewer/SKILL.md`
- Sync：account2 / account3 / `~/.claude`

- [ ] **Step 1: 重写 account1 SKILL.md**

用 Write 工具把 `/Users/administrator/.claude-account1/skills/harness-contract-reviewer/SKILL.md` 整个替换为：

```markdown
---
id: harness-contract-reviewer-skill
description: |
  Harness Contract Reviewer — Harness v2 M3 GAN Layer 2b：
  Reviewer 角色，skeptical 对抗性审查合同草案。你的工作是**找风险**，不是认可合同。
  每一轮必须列出 ≥2 个具体风险点，找不到 ≥2 个不允许 APPROVED。
  挑战 4 维度：DAG 合理性 / Initiative 级 E2E 覆盖 / 测试金字塔完整性 / 验证命令严格性。
version: 5.0.0
created: 2026-04-08
updated: 2026-04-19
changelog:
  - 5.0.0: Harness v2 M3 — 删除"避免无限挑剔"，强化 skeptical tuning（每轮 ≥2 风险点），新增 DAG / E2E / 测试金字塔 3 挑战维度
  - 4.4.0: 覆盖率阈值提升至 80%
  - 4.3.0: CI 白名单强制检查
  - 4.2.0: Workstream 审查维度
  - 4.1.0: 挑战验证命令严格性
  - 3.0.0: Harness v4.0 Contract Reviewer（独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-contract-reviewer — Harness v2 M3 Contract Reviewer

**角色**: Reviewer（合同挑战者）
**对应 task_type**: `harness_contract_review`

---

## 职责

**你的工作是找风险，不是认可合同。** 以对抗性视角审查 Proposer 的合同草案——找出至少 2 个风险点，标注具体可执行的反例。

**心态**: 你即将监督执行这些命令、依赖这份 DAG 推进 Task 顺序合并、依赖 E2E Acceptance 做最终验收。任何薄弱点都是 Initiative 级未来的坑。能找到的就一定要找。

---

## 执行流程

### Step 1: 拉取最新草案并读取

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_BRANCH 由 cecelia-run 通过 prompt 注入，直接使用：
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
[ -n "$PROPOSE_BRANCH" ] && git fetch origin "${PROPOSE_BRANCH}" 2>/dev/null || true

# 读 PRD（来自 planner 分支）
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || cat "${SPRINT_DIR}/sprint-prd.md"

# 读合同草案（来自 propose 分支）
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" 2>/dev/null || cat "${SPRINT_DIR}/contract-draft.md"
```

### Step 2: 对抗性审查——4 挑战维度

**每一轮必须列出 ≥2 个具体风险点（at least 2 concrete risks）**。找不到 ≥2 个具体风险点不允许输出 APPROVED——至少要输出 2 条挑战建议走 REVISION。

#### 维度 1：DAG 合理性（v2 M3 新）

- Task 之间的 `depends_on` 是否有**隐藏依赖**（A 其实要改 B 的文件但没写依赖）？
- Task 粒度是否合理？是否有可以**更细拆**的大 Task（>60 分钟）？
- 是否有**循环依赖**（A→B 且 B→A）？
- 依赖是否**过度保守**（声明依赖但实际可并行）？

#### 维度 2：Initiative 级 E2E 覆盖（v2 M3 新）

- 合同 `## E2E Acceptance` 是否存在？缺失 → REVISION。
- 场景数量是否至少 2 个（happy path + 异常/边界）？
- 场景的 `覆盖的 Tasks` 字段是否指向合同里实际存在的 task_id？
- Given-When-Then 是否覆盖**跨 Task 行为**（而非单 Task 级别的用例重复）？
- 命令是否真正跑得起（端口 5222 / 真 PG），不是 mock？

#### 维度 3：测试金字塔完整性（v2 M3 新）

- 每个 Task 是否**同时**含 `#### Unit Test Plan` **和** `#### Integration Test Plan` 两个子块？
- 缺任一 → **REVISION**（无商量余地）。
- Unit Test Plan 是否真的是单元级（单函数/单模块）？
- Integration Test Plan 是否真的是集成级（多模块交互 / 真实依赖）？
- 两者是否只是 Unit 的复述？是 → REVISION。

#### 维度 4：验证命令严格性（v1 保留）

**Triple 分析**：对每条验证命令构造 Triple：
```
{
  "command": "<原始命令>",
  "can_bypass": "Y/N",
  "proof": "<可执行代码片段>",   // 仅当 can_bypass: Y 时必填
  "fix": "<建议修复命令>"        // 仅当 can_bypass: Y 时必填
}
```

**Triple 中 can_bypass: Y 的判断标准**：
- 命令只检查 HTTP 200，不验证响应体内容 → Y
- 命令只检查文件存在，不验证文件内容 → Y
- 命令只检查进程/服务存活，不验证实际行为 → Y
- 命令用 grep 验证代码文本存在（代码可为死代码/注释） → Y
- 命令只检查字段存在，不检查字段值正确 → Y

**广谱性问题**：
- 全是 curl 命令，UI 功能没用 playwright 吗？
- DB 状态变更没用 psql 吗？
- 业务逻辑没用 node -e / npm test 吗？

**CI 白名单**：Test 命令只允许 `node`/`npm`/`curl`/`bash`/`psql`（禁 grep/ls/cat/sed/echo），否则 REVISION。

### Step 3: 做出判断

**APPROVED 条件**（全部满足，且**找不到任何新风险**）：
- 3 维度（DAG / E2E / 测试金字塔）都已真实挑战过
- 验证命令覆盖 happy path + 至少一个失败/边界路径
- 命令足够严格，能检测错误实现
- 命令广谱（非全 curl）
- Test 命令全部符合 CI 白名单
- PRD 功能点全部有对应命令
- 合同含 `## Tasks` 区块，每 Task 同时有 Unit / Integration test plan
- 合同含 `## E2E Acceptance` 区块，≥2 场景

**任何上述不满足 → REVISION**（且你本轮的反馈里必须至少列出 2 个具体风险点）。

**硬约束：找不到 ≥2 个具体风险点时不允许输出 APPROVED**（at least 2 concrete risks per round before any APPROVED）。本条保护 Evaluator 的 skepticism，防止 GAN 过早收敛到弱合同。

### Step 4a: APPROVED — 写最终合同

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-approved-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"
mkdir -p "${SPRINT_DIR}"

git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md finalized"
git push origin "${REVIEW_BRANCH}"

# 同步到 planner_branch 供后续 Agent 读
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
CONTRACT_BRANCH="cp-harness-contract-${TASK_ID_SHORT}"
git checkout -b "${CONTRACT_BRANCH}" "origin/${PLANNER_BRANCH}" 2>/dev/null || git checkout "${CONTRACT_BRANCH}"
mkdir -p "${SPRINT_DIR}"
git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/sprint-contract.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md 写入 sprint_dir" 2>/dev/null || true
git push origin "${CONTRACT_BRANCH}"
```

### Step 4b: REVISION — 写反馈（≥2 风险点，按 4 维度分类）

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-revision-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-review-feedback.md" << 'FEEDBACK'
# Contract Review Feedback (Round N)

本轮共找到 K 个风险点（K ≥ 2），分布在 4 个挑战维度下。

## 维度 1 · DAG 合理性

### 1. [隐藏依赖] Task X depends_on 漏了 Task Y
**问题**: Task X 的 files 含 packages/foo.js，但 Task Y 也改 packages/foo.js，未列依赖。
**建议**: depends_on 加入 task-id-of-Y，或合并两 Task。

## 维度 2 · Initiative 级 E2E 覆盖

### 2. [E2E 缺失] ## E2E Acceptance 场景 2（异常路径）不存在
**问题**: 合同只写了 happy path，未覆盖 404/权限/并发。
**建议**: 加 "场景 2: 不存在资源返回 404"，配套 curl 命令。

## 维度 3 · 测试金字塔完整性

### 3. [缺 Integration] Task Z 只有 Unit Test Plan，缺 Integration Test Plan
**问题**: 合同 Task-003 子块里没有 `#### Integration Test Plan` 段。
**建议**: 补充至少 1 个集成场景（多模块交互）。

## 维度 4 · 验证命令严格性

### 4. [命令太弱] Task W 验证命令可被假实现蒙混
**原始命令**:
```bash
curl -sf localhost:5221/api/w
```

**假实现片段**（proof-of-falsification）:
```javascript
app.get('/api/w', (req, res) => res.json([]));  // 空数组也过
```

**建议修复命令**:
```bash
node -e "
  const out = require('child_process').execSync('curl -sf localhost:5221/api/w').toString();
  const d = JSON.parse(out);
  if (!Array.isArray(d.items) || d.items.length === 0) { console.log('FAIL'); process.exit(1); }
  console.log('PASS');
"
```
FEEDBACK

git add "${SPRINT_DIR}/contract-review-feedback.md"
git commit -m "feat(contract): REVISION — feedback round N"
git push origin "${REVIEW_BRANCH}"
```

**最后一条消息**（字面量 JSON，不要用代码块包裹）：

APPROVED：
```
{"verdict": "APPROVED", "contract_path": "${SPRINT_DIR}/sprint-contract.md", "review_branch": "${REVIEW_BRANCH}", "contract_branch": "${CONTRACT_BRANCH}", "task_count": N}
```

REVISION：
```
{"verdict": "REVISION", "feedback_path": "${SPRINT_DIR}/contract-review-feedback.md", "issues_count": N, "review_branch": "${REVIEW_BRANCH}"}
```
```

- [ ] **Step 2: 同步到 account2 / account3 / ~/.claude**

Run:
```bash
for dst in ~/.claude-account2 ~/.claude-account3 ~/.claude; do
  cp ~/.claude-account1/skills/harness-contract-reviewer/SKILL.md "$dst/skills/harness-contract-reviewer/SKILL.md"
done
for p in ~/.claude-account1 ~/.claude-account2 ~/.claude-account3 ~/.claude; do
  md5 "$p/skills/harness-contract-reviewer/SKILL.md"
done
```

Expected: 4 个 md5 相同

- [ ] **Step 3: 跑完整测试确认 4 个 SKILL 校验全过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-parse-tasks.test.js 2>&1 | tail -30`
Expected: 全部 10 个 it 通过（6 parseTasks + 4 SKILL 校验）

- [ ] **Step 4: （~/.claude-* 不在 worktree 内，不需要 git add）**

---

### Task 5: Learning 文件 + 最终验证

**Files:**
- Create: `docs/learnings/cp-0419231924-harness-v2-m3-gan-contract.md`

- [ ] **Step 1: 写 Learning**

创建 `docs/learnings/cp-0419231924-harness-v2-m3-gan-contract.md`：

```markdown
# Learning — Harness v2 M3 GAN 合同 v2

PR 分支：cp-0419231924-harness-v2-m3-gan-contract
相关 PR：feat(brain): Harness v2 M3 — GAN 合同 v2 (Tasks + skeptical Reviewer)
日期：2026-04-19

## 做了什么
- harness-graph.js 新增 `parseTasks(contract)`，解析 `## Tasks` 区块里 N 个 Task 子块（task_id/title/scope/depends_on/files/dod/unit_test_plan/integration_test_plan/verify_commands）
- proposer 节点调用 parseTasks 作为主路径，parseWorkstreams 作为 v1 fallback（零破坏）
- reviewer 节点 prompt 重写：删掉"避免无限挑剔导致对抗循环无法收敛"，加"你的工作是找风险 / 每轮 ≥2 风险点 / 3 挑战维度"
- harness-contract-proposer SKILL.md（4 份同步）：从 `## Workstreams` 改为 `## Tasks`（强制 Unit + Integration test plan + 验证命令）+ 新增 `## E2E Acceptance`
- harness-contract-reviewer SKILL.md（4 份同步）：撤销"避免过度挑剔"字样，强化 skeptical tuning，4 挑战维度（DAG/E2E/金字塔/验证严格性）

## 根本原因
v1 的 Reviewer prompt 含"避免无限挑剔导致对抗循环无法收敛"，让 Reviewer 倾向于早 APPROVED，GAN 收敛到弱合同。Proposer 的 Workstreams 格式不强制测试金字塔也不写 Initiative 级 E2E，导致 Task 级 evaluator 无跨 Task 验收依据。M3 同步升级 Proposer 模板 + Reviewer skepticism，让对抗深度在合同层面就建立起来。

## 下次预防
- [ ] 保留 parseWorkstreams，不删（v1 合同 DB 记录仍要能读）
- [ ] M4 Evaluator 去 E2E 时，引用 Initiative 级 ## E2E Acceptance 做真 E2E
- [ ] M2 / M4 合并 initiative_contracts 写入逻辑时，要把 tasks[] 入库（本 PR 只输出到 state.tasks，未入库）
- [ ] Reviewer 若在真实对抗中仍过早 APPROVED，检查是否 SKILL.md 的硬约束不够强，可进一步提升 ≥2 到 ≥3

## 和 M2（#2442）的冲突
- harness-graph.js 如果 M2 改了 proposer 节点 workstreams 逻辑相同区段，需要 rebase 处理
- 本 PR 改动范围：新增 parseTasks 函数（纯增）+ proposer 节点 workstreams 解析行改写 + reviewer prompt 文本改写 + 测试文件新增 + 2 份 SKILL.md
```

- [ ] **Step 2: 跑最终完整测试**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-m3-gan-contract/packages/brain
npx vitest run src/__tests__/harness-parse-tasks.test.js 2>&1 | tail -30
```

Expected: 10 tests pass (6 parseTasks + 4 SKILL format)

- [ ] **Step 3: 最终 grep 自检**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-m3-gan-contract
# 确认核心字样在 reviewer
grep -E "找不到.*≥.*2.*个|at least 2" ~/.claude-account1/skills/harness-contract-reviewer/SKILL.md | head -3
# 确认"避免无限挑剔"全网清除
grep -rn "避免无限挑剔\|避免过度挑剔" packages/brain/src/harness-graph.js ~/.claude-account1/skills/harness-contract-reviewer/SKILL.md || echo CLEAN
# 确认 Proposer 含关键字
grep -E "^##\s+Tasks|E2E Acceptance" ~/.claude-account1/skills/harness-contract-proposer/SKILL.md | head -5
```

Expected: reviewer 有 "at least 2"，无 "避免无限挑剔"；proposer 含 "## Tasks" 和 "E2E Acceptance"

- [ ] **Step 4: 提交 Learning**

```bash
git add docs/learnings/cp-0419231924-harness-v2-m3-gan-contract.md
git commit -m "docs: add learning for Harness v2 M3"
```

---
