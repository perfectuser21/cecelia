# B42 — propose_branch Mismatch Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 放宽 harness-gan.graph.js proposer 节点的 propose_branch 匹配检查（warn + accept 代替 throw），并在 prompt 中注入字面量分支名消除 LLM 自行计算的问题。

**Architecture:** 修改 `packages/brain/src/workflows/harness-gan.graph.js` 两处：(1) `buildProposerPrompt` 加 `proposeBranch` 参数并注入字面量；(2) mismatch check 改为 warn + fallback。新增测试文件 `harness-gan-b42.test.js`，复用 B39 的 `createGanContractNodes` + `mockExecutor` 模式。

**Tech Stack:** Node.js ESM, vitest, harness-gan.graph.js

---

## File Structure

- **Modify:** `packages/brain/src/workflows/harness-gan.graph.js`
  - `buildProposerPrompt(prdContent, feedback, round)` → 加第4参数 `proposeBranch`，在 parts 数组注入字面量
  - proposer 节点 line ~297: 调用 `buildProposerPrompt` 时传入 `computedBranch`
  - proposer 节点 line ~321-326: 改 throw 为 warn + fallback

- **Create:** `packages/brain/src/workflows/__tests__/harness-gan-b42.test.js`
  - 3 个测试：match 场景 / mismatch 场景 / buildProposerPrompt 字面量注入

---

### Task 1: 写失败测试（TDD 红）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-gan-b42.test.js`

- [ ] **Step 1: 创建测试文件**

```js
// packages/brain/src/workflows/__tests__/harness-gan-b42.test.js
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGanContractNodes, buildProposerPrompt } from '../harness-gan.graph.js';

const TASK_ID = 'aabbccdd-0000-1111-2222-333344445555';
const SPRINT_DIR = 'sprints/w99-b42-test';

// 构造 mockExecutor，往 worktreePath 写 .brain-result.json（模拟容器行为）
function makeExecutor(proposeBranchOverride) {
  return vi.fn(async ({ worktreePath, env }) => {
    const actualBranch = proposeBranchOverride ?? env.PROPOSE_BRANCH;
    writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
      propose_branch: actualBranch,
      workstream_count: 1,
      task_plan_path: `${SPRINT_DIR}/task-plan.json`,
    }));
    mkdirSync(join(worktreePath, SPRINT_DIR), { recursive: true });
    writeFileSync(join(worktreePath, SPRINT_DIR, 'contract-draft.md'), '# contract');
    return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.05 };
  });
}

describe('B42 — propose_branch mismatch tolerance', () => {
  it('match 场景: propose_branch = computedBranch → 正常返回，proposeBranch = 注入值', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b42-'));
    try {
      const { proposer } = createGanContractNodes(makeExecutor(undefined), {
        taskId: TASK_ID,
        initiativeId: 'init-b42',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const result = await proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] });

      // computedBranch = cp-harness-propose-r1-aabbccdd（TASK_ID 前8位）
      expect(result.proposeBranch).toBe('cp-harness-propose-r1-aabbccdd');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('mismatch 场景: propose_branch ≠ computedBranch → console.warn，proposeBranch = 实际写入值', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b42-'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 容器写入不同的分支名（模拟 LLM 用了时间戳）
      const { proposer } = createGanContractNodes(makeExecutor('cp-harness-propose-r1-05152044'), {
        taskId: TASK_ID,
        initiativeId: 'init-b42',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const result = await proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] });

      // 不 throw，但 warn 了
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('propose_branch mismatch')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('cp-harness-propose-r1-05152044')
      );
      // proposeBranch 用实际写入值（不是 computedBranch）
      expect(result.proposeBranch).toBe('cp-harness-propose-r1-05152044');
    } finally {
      warnSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('buildProposerPrompt 注入字面量 PROPOSE_BRANCH', () => {
    const proposeBranch = 'cp-harness-propose-r1-aabbccdd';
    const prompt = buildProposerPrompt('# PRD content', null, 1, proposeBranch);

    // prompt 必须包含字面量字符串（不是 ${PROPOSE_BRANCH}）
    expect(prompt).toContain(`PROPOSE_BRANCH="${proposeBranch}"`);
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd /Users/administrator/worktrees/cecelia/b42-propose-branch-mismatch-tolerance
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b42.test.js 2>&1 | tail -30
```

预期输出（3个FAIL）：
- match 场景：可能 PASS（因为 computedBranch 逻辑未变）或 FAIL（取决于返回值）
- mismatch 场景：**FAIL** — 当前代码 throw ContractViolation，不会 warn
- buildProposerPrompt 字面量：**FAIL** — 当前签名只有3个参数，没有注入

- [ ] **Step 3: Commit 红测试**

```bash
cd /Users/administrator/worktrees/cecelia/b42-propose-branch-mismatch-tolerance
git add packages/brain/src/workflows/__tests__/harness-gan-b42.test.js
git commit -m "test(b42): failing tests — propose_branch mismatch tolerance + buildProposerPrompt literal injection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现修改（TDD 绿）

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js:138,297,321-326`

- [ ] **Step 1: 修改 buildProposerPrompt 签名，注入字面量**

当前代码（line 138-156）：
```js
export function buildProposerPrompt(prdContent, feedback, round) {
  const skillContent = loadSkillContent('harness-contract-proposer');
  const parts = [
    '你是 harness-contract-proposer agent。按下面 SKILL 指令工作。',
    '',
    skillContent,
    '',
    '---',
    '',
    `round: ${round}`,
    '',
    '## PRD',
    prdContent,
  ];
  if (feedback) {
    parts.push('', '## 上轮 Reviewer 反馈（必须处理）', feedback);
  }
  return parts.join('\n');
}
```

修改为：
```js
export function buildProposerPrompt(prdContent, feedback, round, proposeBranch) {
  const skillContent = loadSkillContent('harness-contract-proposer');
  const parts = [
    '你是 harness-contract-proposer agent。按下面 SKILL 指令工作。',
    '',
    skillContent,
    '',
    '---',
    '',
    `round: ${round}`,
    '',
  ];
  if (proposeBranch) {
    parts.push(
      `**重要**: PROPOSE_BRANCH="${proposeBranch}"（由 Brain 注入的确定性值，你必须使用此值作为分支名，不得修改）`,
      ''
    );
  }
  parts.push('## PRD', prdContent);
  if (feedback) {
    parts.push('', '## 上轮 Reviewer 反馈（必须处理）', feedback);
  }
  return parts.join('\n');
}
```

- [ ] **Step 2: 修改 proposer 节点调用 buildProposerPrompt，传入 computedBranch**

当前代码（line ~297）：
```js
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound),
```

修改为：
```js
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound, computedBranch),
```

- [ ] **Step 3: 放宽 mismatch check（throw → warn + fallback）**

当前代码（line ~319-326）：
```js
    // 读容器写入的结果文件（双重验证：Brain 计算值 vs 容器写入值必须一致）
    const resultData = await readBrainResult(worktreePath, ['propose_branch']);
    if (resultData.propose_branch !== computedBranch) {
      const err = new Error(`ContractViolation: propose_branch_mismatch — expected=${computedBranch} got=${resultData.propose_branch}`);
      err.code = 'propose_branch_mismatch';
      throw err;
    }
    const proposeBranch = computedBranch;
```

修改为：
```js
    // 读容器写入的结果文件；LLM 有时会自行计算分支名（不用 env var），改为 warn + 接受实际值
    const resultData = await readBrainResult(worktreePath, ['propose_branch']);
    if (resultData.propose_branch !== computedBranch) {
      console.warn(`[harness-gan] propose_branch mismatch — expected=${computedBranch} got=${resultData.propose_branch}, accepting got value`);
    }
    const proposeBranch = resultData.propose_branch || computedBranch;
```

- [ ] **Step 4: 运行测试，确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/b42-propose-branch-mismatch-tolerance
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b42.test.js 2>&1 | tail -20
```

预期：3 tests passed

- [ ] **Step 5: 运行完整 harness-gan 测试套件，确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/b42-propose-branch-mismatch-tolerance
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b39.test.js packages/brain/src/workflows/__tests__/harness-gan.graph.test.js packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js 2>&1 | tail -20
```

预期：所有测试通过（无回归）

- [ ] **Step 6: Commit 实现**

```bash
cd /Users/administrator/worktrees/cecelia/b42-propose-branch-mismatch-tolerance
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "fix(harness): B42 — propose_branch mismatch 改 warn+fallback，buildProposerPrompt 注入字面量

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: DoD + Learning + 版本 bump

**Files:**
- Modify: `packages/brain/package.json` (version)
- Create: `docs/learnings/cp-0515215119-b42-propose-branch-mismatch-tolerance.md`

- [ ] **Step 1: Brain 版本 bump（patch）**

读当前版本：
```bash
cd /Users/administrator/worktrees/cecelia/b42-propose-branch-mismatch-tolerance
node -e "console.log(require('./packages/brain/package.json').version)"
```

在 `packages/brain/package.json` 中将 `"version": "X.Y.Z"` 改为 `"X.Y.(Z+1)"`。

- [ ] **Step 2: 写 DoD 到 .dev-mode 文件**

```bash
BRANCH="cp-0515215119-b42-propose-branch-mismatch-tolerance"
DEV_MODE_FILE=".dev-mode.${BRANCH}"
```

读当前 .dev-mode 文件，在 `dod:` 字段写入：

```yaml
dod: |
  [ARTIFACT] fix(harness-gan): buildProposerPrompt 接受 proposeBranch 参数
  Test: node -e "const {buildProposerPrompt}=await import('./packages/brain/src/workflows/harness-gan.graph.js');const p=buildProposerPrompt('prd',null,1,'cp-test-br');if(!p.includes('PROPOSE_BRANCH=\"cp-test-br\"'))process.exit(1)"
  Status: [x]
  
  [BEHAVIOR] mismatch 时 warn 而非 throw
  Test: tests/packages/brain/src/workflows/__tests__/harness-gan-b42.test.js
  Status: [x]
  
  [BEHAVIOR] buildProposerPrompt 字面量注入
  Test: tests/packages/brain/src/workflows/__tests__/harness-gan-b42.test.js
  Status: [x]
```

- [ ] **Step 3: 写 Learning 文件**

创建 `docs/learnings/cp-0515215119-b42-propose-branch-mismatch-tolerance.md`：

```markdown
## B42 propose_branch mismatch tolerance（2026-05-15）

### 根本原因

LLM 在容器内执行时，prompt 里的 `${PROPOSE_BRANCH}` 被 LLM "展开"成自己计算的时间戳分支名（如 `cp-harness-propose-r1-05152044`），而不是 Brain 注入的确定性值。Brain 的严格 ContractViolation 因此阻断了整个 pipeline。

### 下次预防

- [ ] env var 在 prompt 里以 `${VAR}` 形式出现时，LLM 倾向于"展开"它。改为在 prompt 文本中直接注入字面值（`VAR="literal-value"`）
- [ ] Brain 对 LLM 容器输出的匹配检查，应先 warn + 接受实际值，而非直接 throw；strict throw 适用于协议层（文件缺失、schema 损坏），不适用于 LLM 语义层（值内容偏差）
- [ ] 类似 proposer/evaluator 的 prompt 构建函数，每次派发时显式传入确定性的外部注入值，不依赖容器的 env var 展开
```

- [ ] **Step 4: Commit DoD + Learning + version bump**

```bash
cd /Users/administrator/worktrees/cecelia/b42-propose-branch-mismatch-tolerance
git add packages/brain/package.json \
    docs/learnings/cp-0515215119-b42-propose-branch-mismatch-tolerance.md
git commit -m "docs(b42): DoD + learning — propose_branch mismatch tolerance

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 自审（Self-Review）

**Spec coverage:**
- ✅ mismatch → warn + fallback（Task 2 Step 3）
- ✅ buildProposerPrompt 注入字面量（Task 2 Step 1）
- ✅ 单元测试覆盖 match/mismatch/字面量（Task 1）

**Placeholder scan:** 无 TBD/TODO。

**Type consistency:** `buildProposerPrompt` 第4参数 `proposeBranch`，在 Task 1 测试和 Task 2 实现保持一致。
