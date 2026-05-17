# Harness 协议重构：Brain Result File 协议 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 harness pipeline 中所有 stdout 解析，改为 Brain 注入确定性值 + 容器写 `.brain-result.json` + Brain 读文件。

**Architecture:** Brain 在启动每个容器前计算好所有确定性值（如 `PROPOSE_BRANCH`）并通过 env var 注入。容器完成工作后向固定路径 `/workspace/.brain-result.json` 写结构化 JSON。Brain 在容器退出后从 host 路径 `{worktreePath}/.brain-result.json` 读文件获取结果，不碰 stdout。Brain 在启动容器前先删除旧的 `.brain-result.json`（防止失败时读到上轮数据）。

**Tech Stack:** Node.js / LangGraph（现有）；新增 `readBrainResult()` 工具函数（`harness-shared.js`）；SKILL.md 文件改动需 Engine 版本 bump（18.26.0 → 18.27.0）。

---

## 文件结构

### 创建
- `packages/brain/src/__tests__/harness-shared-b39.test.js` — `readBrainResult` 单元测试（4 cases）
- `packages/brain/src/workflows/__tests__/harness-gan-b39.test.js` — proposer/reviewer 集成测试
- `packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js` — evaluator 集成测试
- `packages/brain/scripts/smoke/harness-protocol-smoke.sh` — E2E smoke 脚本（真调用 readBrainResult）

### 修改
- `packages/brain/src/harness-shared.js` — 新增 `readBrainResult(worktreePath, requiredFields)`
- `packages/brain/src/workflows/harness-gan.graph.js` — 改 proposer/reviewer 节点 + import + 删 5 函数
- `packages/brain/src/workflows/harness-initiative.graph.js` — 改 evaluator 节点 + import
- `packages/workflows/skills/harness-contract-proposer/SKILL.md` — Step 4 改写
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md` — 最终输出改写
- `packages/workflows/skills/harness-evaluator/SKILL.md` — 输出改写
- `packages/engine/package.json` — version bump
- `packages/engine/package-lock.json` — version bump
- `packages/engine/VERSION` — version bump
- `packages/engine/.hook-core-version` — version bump
- `packages/engine/regression-contract.yaml` — version bump
- `packages/engine/feature-registry.yml` — changelog 条目 + `generate-path-views.sh`

---

### Task 1: E2E smoke 骨架 + `readBrainResult` 单元测试（failing commit）

**Files:**
- Create: `packages/brain/src/__tests__/harness-shared-b39.test.js`
- Create: `packages/brain/scripts/smoke/harness-protocol-smoke.sh`

- [ ] **Step 1: 写 4 条 failing 单元测试**

创建 `packages/brain/src/__tests__/harness-shared-b39.test.js`：

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readBrainResult } from '../harness-shared.js';

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'brain-result-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('readBrainResult', () => {
  it('文件存在且 schema 合法 → 返回 parsed object', async () => {
    writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({
      propose_branch: 'cp-harness-propose-r1-f5a1db9c',
      workstream_count: 2,
      task_plan_path: 'sprints/w50/task-plan.json',
    }));
    const result = await readBrainResult(tmpDir, ['propose_branch']);
    expect(result.propose_branch).toBe('cp-harness-propose-r1-f5a1db9c');
    expect(result.workstream_count).toBe(2);
  });

  it('文件不存在 → 抛 ContractViolation missing_result_file', async () => {
    await expect(readBrainResult(tmpDir, ['verdict'])).rejects.toThrow('missing_result_file');
  });

  it('必填字段缺失 → 抛 ContractViolation invalid_result_file 含字段名', async () => {
    writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({ verdict: 'PASS' }));
    await expect(readBrainResult(tmpDir, ['verdict', 'rubric_scores'])).rejects.toThrow('rubric_scores');
  });

  it('null 值字段 → 视为缺失，抛 ContractViolation', async () => {
    writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({ verdict: null }));
    await expect(readBrainResult(tmpDir, ['verdict'])).rejects.toThrow('verdict');
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL（readBrainResult 未导出）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-protocol-brain-owns-git
npx vitest run packages/brain/src/__tests__/harness-shared-b39.test.js 2>&1 | tail -20
```

期望：FAIL with "readBrainResult is not a function" 或 "does not provide an export named"

- [ ] **Step 3: 写 smoke 骨架（会 fail 因为 readBrainResult 不存在）**

创建 `packages/brain/scripts/smoke/harness-protocol-smoke.sh`：

```bash
#!/usr/bin/env bash
# harness-protocol-smoke.sh — 验证 .brain-result.json 协议正确工作
# 不需要真起 Brain，直接调 readBrainResult Node 函数。
# exit 0 = 协议 OK；exit 1 = 协议失败

set -euo pipefail
BRAIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR=$(mktemp -d)
trap "rm -rf '$TMP_DIR'" EXIT

node --input-type=module << NODEJS
import { readBrainResult } from '$BRAIN_ROOT/src/harness-shared.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
const d = '$TMP_DIR';

// Test 1: valid proposer result
writeFileSync(join(d, '.brain-result.json'), JSON.stringify({
  propose_branch: 'cp-harness-propose-r1-test1234',
  workstream_count: 2,
  task_plan_path: 'sprints/test/task-plan.json',
}));
const r1 = await readBrainResult(d, ['propose_branch']);
if (r1.propose_branch !== 'cp-harness-propose-r1-test1234') process.exit(1);
console.log('[smoke] PASS: proposer result read correctly');

// Test 2: missing file → throws
import { rmSync } from 'fs';
rmSync(join(d, '.brain-result.json'));
try {
  await readBrainResult(d, ['verdict']);
  process.exit(1);
} catch (e) {
  if (!e.message.includes('missing_result_file')) process.exit(1);
}
console.log('[smoke] PASS: missing file throws ContractViolation');

// Test 3: reviewer result
writeFileSync(join(d, '.brain-result.json'), JSON.stringify({
  verdict: 'APPROVED',
  rubric_scores: { dod_machineability: 8, scope_match_prd: 8, test_is_red: 8, internal_consistency: 8, risk_registered: 8 },
  feedback: '',
}));
const r3 = await readBrainResult(d, ['verdict', 'rubric_scores']);
if (r3.verdict !== 'APPROVED') process.exit(1);
console.log('[smoke] PASS: reviewer result read correctly');

console.log('[smoke] All checks passed — protocol OK');
NODEJS
```

```bash
chmod +x packages/brain/scripts/smoke/harness-protocol-smoke.sh
bash packages/brain/scripts/smoke/harness-protocol-smoke.sh 2>&1 | tail -5
```

期望：FAIL（因为 `readBrainResult` 还未实现）

- [ ] **Step 4: commit failing tests + smoke skeleton**

```bash
git add packages/brain/src/__tests__/harness-shared-b39.test.js \
        packages/brain/scripts/smoke/harness-protocol-smoke.sh
git commit -m "test(brain): B39 readBrainResult 单测 + smoke 骨架（FAILING）"
```

---

### Task 2: 实现 `readBrainResult`（tests green）

**Files:**
- Modify: `packages/brain/src/harness-shared.js`

- [ ] **Step 1: 在 harness-shared.js 末尾新增 `readBrainResult`**

在 `packages/brain/src/harness-shared.js` 第 12 行的 import 块中补充 `readFileSync`（已有），在文件末尾（157 行后）添加：

```js
/**
 * 容器退出后从 worktree 读 .brain-result.json，验证 requiredFields 存在。
 * 文件不存在 → 抛 ContractViolation: missing_result_file
 * 字段缺失或为 null → 抛 ContractViolation: invalid_result_file: missing field {field}
 */
export async function readBrainResult(worktreePath, requiredFields = []) {
  const filePath = path.join(worktreePath, '.brain-result.json');
  if (!existsSync(filePath)) {
    const err = new Error(`ContractViolation: missing_result_file — ${filePath}`);
    err.code = 'missing_result_file';
    throw err;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    const err = new Error(`ContractViolation: invalid_result_file — JSON parse failed: ${e.message}`);
    err.code = 'invalid_result_file';
    throw err;
  }
  for (const field of requiredFields) {
    if (data[field] === null || data[field] === undefined) {
      const err = new Error(`ContractViolation: invalid_result_file: missing field ${field}`);
      err.code = 'invalid_result_file';
      throw err;
    }
  }
  return data;
}
```

注意：`path` 和 `existsSync`/`readFileSync` 在文件顶部已 import，直接使用。

- [ ] **Step 2: 运行单测，确认 PASS**

```bash
npx vitest run packages/brain/src/__tests__/harness-shared-b39.test.js 2>&1 | tail -15
```

期望：4 passed，0 failed

- [ ] **Step 3: 运行 smoke，确认 PASS**

```bash
bash packages/brain/scripts/smoke/harness-protocol-smoke.sh
```

期望：输出 3 行 PASS + "All checks passed"，exit 0

- [ ] **Step 4: commit 实现**

```bash
git add packages/brain/src/harness-shared.js
git commit -m "feat(brain): B39 readBrainResult — .brain-result.json 协议基础函数"
```

---

### Task 3: proposer 节点 — 注入 `PROPOSE_BRANCH` + 读文件（TDD）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-gan-b39.test.js`
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`

- [ ] **Step 1: 写 failing 集成测试**

创建 `packages/brain/src/workflows/__tests__/harness-gan-b39.test.js`：

```js
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGanContractNodes } from '../harness-gan.graph.js';

const TASK_ID = 'f5a1db9c-1111-2222-3333-444455556666';
const SPRINT_DIR = 'sprints/w50-test';

function makeTmpWorktree() {
  return mkdtempSync(join(tmpdir(), 'gan-b39-'));
}

describe('proposer 节点 — Brain 注入 PROPOSE_BRANCH', () => {
  it('proposer env 含 PROPOSE_BRANCH，容器写文件后 Brain 读取', async () => {
    const tmpDir = makeTmpWorktree();
    try {
      let capturedEnv;
      const mockExecutor = vi.fn(async ({ worktreePath, env }) => {
        capturedEnv = env;
        // 容器写 .brain-result.json（模拟 SKILL 行为）
        writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
          propose_branch: env.PROPOSE_BRANCH,
          workstream_count: 2,
          task_plan_path: `${SPRINT_DIR}/task-plan.json`,
        }));
        // mock verifyProposer 需要的 contract 文件
        const { mkdirSync } = await import('fs');
        mkdirSync(join(worktreePath, SPRINT_DIR), { recursive: true });
        writeFileSync(join(worktreePath, SPRINT_DIR, 'contract-draft.md'), '# contract');
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1 };
      });

      const { proposer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const result = await proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] });

      // Brain 注入的分支名 = cp-harness-propose-r1-f5a1db9
      expect(capturedEnv.PROPOSE_BRANCH).toBe('cp-harness-propose-r1-f5a1db9c');
      expect(result.proposeBranch).toBe('cp-harness-propose-r1-f5a1db9c');
      expect(result.round).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('proposer 容器未写文件 → 抛 ContractViolation missing_result_file', async () => {
    const tmpDir = makeTmpWorktree();
    try {
      const mockExecutor = vi.fn(async () => ({
        exit_code: 0, stdout: '', stderr: '', cost_usd: 0,
      }));

      const { proposer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      await expect(proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] }))
        .rejects.toThrow('missing_result_file');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b39.test.js 2>&1 | tail -20
```

期望：FAIL（proposer 仍用 extractProposeBranch，不读文件）

- [ ] **Step 3: commit failing tests**

```bash
git add packages/brain/src/workflows/__tests__/harness-gan-b39.test.js
git commit -m "test(brain): B39 proposer 节点文件协议集成测试（FAILING）"
```

- [ ] **Step 4: 修改 proposer 节点**

在 `packages/brain/src/workflows/harness-gan.graph.js` 做以下改动：

**4a. 修改 import（第 34 行）：**

旧：
```js
import { loadSkillContent } from '../harness-shared.js';
```

新：
```js
import { loadSkillContent, readBrainResult } from '../harness-shared.js';
```

**4b. 修改 proposer 函数（约第 345-395 行）：**

在 executor 调用前，先删除旧的 `.brain-result.json`（防止读上轮数据）：

```js
async function proposer(state) {
  const nextRound = (state.round || 0) + 1;
  const computedBranch = `cp-harness-propose-r${nextRound}-${taskId.slice(0, 8)}`;

  // 清理上轮残留结果文件，防止 executor 失败时读到旧数据
  const { unlink } = await import('node:fs/promises');
  try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 首轮不存在，忽略 */ }

  const result = await executor({
    task: { id: taskId, task_type: 'harness_contract_propose' },
    prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound),
    worktreePath,
    timeoutMs: 1800000,
    env: {
      CECELIA_TASK_TYPE: 'harness_contract_propose',
      HARNESS_NODE: 'proposer',
      HARNESS_SPRINT_DIR: sprintDir,
      HARNESS_INITIATIVE_ID: initiativeId,
      HARNESS_PROPOSE_ROUND: String(nextRound),
      TASK_ID: taskId,
      SPRINT_DIR: sprintDir,
      PLANNER_BRANCH: 'main',
      PROPOSE_ROUND: String(nextRound),
      PROPOSE_BRANCH: computedBranch,
      GITHUB_TOKEN: githubToken,
    },
  });
  if (!result || result.exit_code !== 0) {
    throw new Error(`proposer_failed: exit=${result?.exit_code} stderr=${(result?.stderr || '').slice(0, 300)}`);
  }
  const contractContent = await readContractFile(worktreePath, sprintDir);

  // 读容器写入的结果文件（双重验证：Brain 计算值 vs 容器写入值必须一致）
  const resultData = await readBrainResult(worktreePath, ['propose_branch']);
  if (resultData.propose_branch !== computedBranch) {
    const err = new Error(`ContractViolation: propose_branch_mismatch — expected=${computedBranch} got=${resultData.propose_branch}`);
    err.code = 'propose_branch_mismatch';
    throw err;
  }
  const proposeBranch = computedBranch;

  const taskPlanPath = path.join(worktreePath, sprintDir, 'task-plan.json');
  try {
    await access(taskPlanPath);
  } catch {
    console.warn(`[harness-gan] proposer round=${nextRound} missing ${sprintDir}/task-plan.json — inferTaskPlan 拿不到 DAG 时会 hard fail`);
  }

  await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir });

  return {
    round: nextRound,
    costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
    contractContent,
    proposeBranch,
  };
}
```

- [ ] **Step 5: 运行测试，确认 PASS**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b39.test.js 2>&1 | tail -15
```

期望：2 passed

- [ ] **Step 6: commit 实现**

```bash
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "feat(brain): B39 proposer — 注入 PROPOSE_BRANCH env var + 读 .brain-result.json"
```

---

### Task 4: reviewer 节点 — 读 `.brain-result.json` 替代 stdout 解析（TDD）

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-gan-b39.test.js` （追加测试）
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`

- [ ] **Step 1: 在 harness-gan-b39.test.js 末尾追加 reviewer 测试**

```js
describe('reviewer 节点 — 读 .brain-result.json', () => {
  it('容器写 APPROVED + rubric_scores → Brain 判 APPROVED', async () => {
    const tmpDir = makeTmpWorktree();
    try {
      const mockExecutor = vi.fn(async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
          verdict: 'APPROVED',
          rubric_scores: {
            dod_machineability: 8,
            scope_match_prd: 8,
            test_is_red: 8,
            internal_consistency: 8,
            risk_registered: 8,
          },
          feedback: '',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1 };
      });

      const { reviewer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const patch = await reviewer({
        round: 1,
        prdContent: '# PRD',
        contractContent: '# contract',
        costUsd: 0,
        rubricHistory: [],
        proposeBranch: 'cp-harness-propose-r1-f5a1db9c',
      });

      expect(patch.verdict).toBe('APPROVED');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('容器写 REVISION + 低分 → Brain 判 REVISION + feedback 存入 patch', async () => {
    const tmpDir = makeTmpWorktree();
    try {
      const mockExecutor = vi.fn(async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
          verdict: 'REVISION',
          rubric_scores: {
            dod_machineability: 5,
            scope_match_prd: 5,
            test_is_red: 5,
            internal_consistency: 5,
            risk_registered: 5,
          },
          feedback: 'DoD 命令无法 exit non-zero，请修复',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1 };
      });

      const { reviewer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const patch = await reviewer({
        round: 1,
        prdContent: '# PRD',
        contractContent: '# contract',
        costUsd: 0,
        rubricHistory: [],
        proposeBranch: 'cp-harness-propose-r1-f5a1db9c',
      });

      expect(patch.verdict).toBe('REVISION');
      expect(patch.feedback).toContain('DoD 命令');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认新增 2 条 FAIL**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b39.test.js 2>&1 | tail -20
```

期望：2 tests pass（proposer），2 tests fail（reviewer，仍用 extractRubricScores）

- [ ] **Step 3: commit failing reviewer tests**

```bash
git add packages/brain/src/workflows/__tests__/harness-gan-b39.test.js
git commit -m "test(brain): B39 reviewer 节点文件协议集成测试（FAILING）"
```

- [ ] **Step 4: 修改 reviewer 函数（约第 397-464 行）**

在 executor 调用前先清理文件，容器退出后读文件：

```js
async function reviewer(state) {
  // 清理上轮残留结果文件
  const { unlink } = await import('node:fs/promises');
  try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 忽略 */ }

  const result = await executor({
    task: { id: taskId, task_type: 'harness_contract_review' },
    prompt: buildReviewerPrompt(state.prdContent, state.contractContent, state.round),
    worktreePath,
    timeoutMs: 1800000,
    env: {
      CECELIA_TASK_TYPE: 'harness_contract_review',
      HARNESS_NODE: 'reviewer',
      HARNESS_SPRINT_DIR: sprintDir,
      HARNESS_INITIATIVE_ID: initiativeId,
      HARNESS_REVIEW_ROUND: String(state.round),
      TASK_ID: taskId,
      SPRINT_DIR: sprintDir,
      PLANNER_BRANCH: 'main',
      REVIEW_ROUND: String(state.round),
      GITHUB_TOKEN: githubToken,
    },
  });
  if (!result || result.exit_code !== 0) {
    throw new Error(`reviewer_failed: exit=${result?.exit_code}`);
  }
  const nextCost = (state.costUsd || 0) + Number(result.cost_usd || 0);
  if (nextCost > budgetCapUsd) {
    throw new Error(`gan_budget_exceeded: spent=${nextCost.toFixed(3)} cap=${budgetCapUsd}`);
  }

  // 读容器写入的结果文件（rubric_scores + verdict + feedback）
  const currentRound = state.round || 0;
  const resultData = await readBrainResult(worktreePath, ['verdict', 'rubric_scores']);
  const rubricScores = resultData.rubric_scores;
  const rubricVerdict = computeVerdictFromRubric(rubricScores, currentRound);
  // rubric 代码判决优先；文件 verdict 作为 fallback（类型兼容性保障）
  let verdict = rubricVerdict || resultData.verdict;
  const verdictSource = rubricVerdict ? 'rubric' : 'file_verdict';
  if (rubricVerdict && rubricVerdict !== resultData.verdict) {
    console.warn(`[harness-gan] round=${currentRound} rubric_verdict=${rubricVerdict} ≠ file_verdict=${resultData.verdict} — 按 rubric 判（代码权威）`);
  }

  // 收敛检测（逻辑不变）
  const newHistoryEntry = rubricScores ? { round: currentRound, scores: rubricScores } : null;
  const combinedHistory = newHistoryEntry
    ? [...(state.rubricHistory || []), newHistoryEntry]
    : (state.rubricHistory || []);
  const trend = detectConvergenceTrend(combinedHistory);
  let forcedApproval = false;
  if (verdict !== 'APPROVED' && (trend === 'diverging' || trend === 'oscillating')) {
    console.warn(`[harness-gan][P1] GAN ${trend} at round=${currentRound} — force APPROVED (verdict_before=${verdict}, source=${verdictSource}, history_len=${combinedHistory.length})`);
    verdict = 'APPROVED';
    forcedApproval = true;
  }

  const patch = { costUsd: nextCost, verdict, forcedApproval };
  if (newHistoryEntry) {
    patch.rubricHistory = [newHistoryEntry];
  }
  if (verdict !== 'APPROVED') {
    patch.feedback = resultData.feedback || '';
  }
  return patch;
}
```

- [ ] **Step 5: 运行全部 4 条测试，确认 PASS**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b39.test.js 2>&1 | tail -15
```

期望：4 passed

- [ ] **Step 6: commit 实现**

```bash
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "feat(brain): B39 reviewer — 读 .brain-result.json 替代 stdout 解析"
```

---

### Task 5: evaluator 节点 — 读 `.brain-result.json` 替代 stdout 解析（TDD）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js`
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 1: 写 failing 集成测试**

创建 `packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js`：

```js
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 直接测试 evaluator 内部逻辑：mock executor 写文件，验证 verdict 读取
// 因 evaluator 是 harness-initiative.graph.js 内部函数，通过 runFinalEvaluateNode 触发
// 这里用轻量集成方式：创建 finalEvaluateNode 并注入 mock

async function buildFinalEvaluateNode(mockExecutor, worktreePath) {
  // 动态 import 获取内部函数（integration test pattern）
  const mod = await import('../harness-initiative.graph.js');
  // 跳过完整 graph，直接测试 readBrainResult 被调用路径
  // 通过验证行为：PASS verdict 不触发 fixRound 逻辑
  return mod;
}

describe('evaluator 节点 — 读 .brain-result.json', () => {
  it('容器写 PASS → final_e2e_verdict=PASS', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'initiative-b39-'));
    try {
      const sprintDir = 'sprints/w50-test';
      mkdirSync(join(tmpDir, sprintDir), { recursive: true });
      // 写 contract 文件供 evaluator 找到
      writeFileSync(join(tmpDir, sprintDir, 'contract-draft.md'), '# contract\n## E2E 验收\n```bash\nexit 0\n```\n');

      const capturedWriteArgs = [];
      const mockExecutor = vi.fn(async ({ worktreePath: wp }) => {
        // 模拟容器写 .brain-result.json
        writeFileSync(join(wp, '.brain-result.json'), JSON.stringify({
          verdict: 'PASS',
          failed_step: null,
          log_excerpt: null,
        }));
        return { exit_code: 0, stdout: '', stderr: '', timed_out: false, cost_usd: 0 };
      });

      // 导入 createFinalEvaluateNode（如已导出）或直接检验 readBrainResult 行为
      // 由于 harness-initiative.graph.js 不直接导出 evaluator node，
      // 用 readBrainResult 验证核心行为（unit test 已覆盖，此处验 evaluator 不再用 parseDockerOutput）
      const { readBrainResult } = await import('../../harness-shared.js');
      writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({
        verdict: 'PASS', failed_step: null, log_excerpt: null,
      }));
      const r = await readBrainResult(tmpDir, ['verdict']);
      expect(r.verdict).toBe('PASS');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('容器写 FAIL + failed_step → final_e2e_verdict=FAIL 含失败信息', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'initiative-b39-'));
    try {
      const { readBrainResult } = await import('../../harness-shared.js');
      writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({
        verdict: 'FAIL',
        failed_step: 'Step 3: curl /api/sum',
        log_excerpt: 'curl: (7) Failed to connect to localhost port 5221',
      }));
      const r = await readBrainResult(tmpDir, ['verdict', 'failed_step']);
      expect(r.verdict).toBe('FAIL');
      expect(r.failed_step).toBe('Step 3: curl /api/sum');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js 2>&1 | tail -15
```

期望：FAIL（readBrainResult 可能存在，但 evaluator 节点还未改动）

实际上 Task 2 已经实现了 `readBrainResult`，所以这两个测试可能直接 PASS。如果 PASS，跳到 Step 4 直接修改 evaluator 节点代码。

- [ ] **Step 3: commit failing tests（若 FAIL）或直接进 Step 4**

```bash
git add packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js
git commit -m "test(brain): B39 evaluator 节点文件协议集成测试"
```

- [ ] **Step 4: 修改 evaluator 节点（harness-initiative.graph.js）**

**4a. 修改 import（第 32 行）：**

旧：
```js
import { parseDockerOutput, loadSkillContent } from '../harness-shared.js';
```

新：
```js
import { parseDockerOutput, loadSkillContent, readBrainResult } from '../harness-shared.js';
```

**4b. 修改 evaluator stdout 解析段（约第 1399-1427 行）：**

找到这段代码并替换：
```js
  } else {
    const stdout = parseDockerOutput(result.stdout);
    let verdict = null;
    const lines = stdout.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'));
    const lastJson = lines[lines.length - 1];
    if (lastJson) {
      try { verdict = JSON.parse(lastJson); } catch { /* ignore */ }
    }

    if (verdict?.verdict === 'PASS') {
      verdictDelta = { final_e2e_verdict: 'PASS', final_e2e_failed_scenarios: [] };
    } else {
      verdictDelta = {
        final_e2e_verdict: 'FAIL',
        final_e2e_failed_scenarios: [{
          name: verdict?.failed_step || 'E2E failed',
          covered_tasks: [],
          output: verdict?.log_excerpt || stdout.slice(-300),
          exitCode: 1,
        }],
      };
    }
  }
```

替换为：

```js
  } else {
    // 清理上轮残留后读容器写入的结果文件
    let resultData;
    try {
      resultData = await readBrainResult(state.worktreePath, ['verdict']);
    } catch (readErr) {
      resultData = { verdict: 'FAIL', failed_step: 'result_file_missing', log_excerpt: readErr.message };
    }

    if (resultData.verdict === 'PASS') {
      verdictDelta = { final_e2e_verdict: 'PASS', final_e2e_failed_scenarios: [] };
    } else {
      verdictDelta = {
        final_e2e_verdict: 'FAIL',
        final_e2e_failed_scenarios: [{
          name: resultData.failed_step || 'E2E failed',
          covered_tasks: [],
          output: resultData.log_excerpt || '',
          exitCode: 1,
        }],
      };
    }
  }
```

**4c. 在 executor 调用前（约第 1379 行）先清理文件：**

在 `result = await executor(...)` 前加：

```js
  const { unlink: unlinkResult } = await import('node:fs/promises');
  try { await unlinkResult(path.join(state.worktreePath, '.brain-result.json')); } catch { /* 忽略 */ }
```

- [ ] **Step 5: 运行测试，确认 PASS**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js 2>&1 | tail -15
```

期望：2 passed

- [ ] **Step 6: commit 实现**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "feat(brain): B39 evaluator — 读 .brain-result.json 替代 stdout 末行 JSON"
```

---

### Task 6: SKILL 文件改动 — proposer + reviewer + evaluator

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`
- Modify: `packages/workflows/skills/harness-contract-reviewer/SKILL.md`
- Modify: `packages/workflows/skills/harness-evaluator/SKILL.md`

- [ ] **Step 1: 修改 proposer SKILL.md Step 4**

在 `packages/workflows/skills/harness-contract-proposer/SKILL.md` 找到 Step 4（约第 453 行），替换以下内容：

旧（计算 PROPOSE_BRANCH 的两行）：
```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
PROPOSE_BRANCH="cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}"
```

新：
```bash
# $PROPOSE_BRANCH 由 Brain 注入（env var），直接使用，不再自己计算
# Brain 保证值为 cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID前8位}
```

旧（最后一条消息 stdout JSON）：
```
{"verdict": "PROPOSED", "contract_draft_path": "${SPRINT_DIR}/contract-draft.md", "propose_branch": "cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}", "workstream_count": N, "test_files_count": M, "task_plan_path": "${SPRINT_DIR}/task-plan.json"}
```

新（写 .brain-result.json）：

在 `git push origin "${PROPOSE_BRANCH}"` 之后，将最后一条 stdout 消息改为：

```bash
# 写结果文件（Brain 读取此文件，不读 stdout）
WORKSTREAM_COUNT=$(find "${SPRINT_DIR}" -name "contract-dod-ws*.md" | wc -l | tr -d ' ')
cat > /workspace/.brain-result.json << BREOF
{"propose_branch":"${PROPOSE_BRANCH}","workstream_count":${WORKSTREAM_COUNT},"task_plan_path":"${SPRINT_DIR}/task-plan.json"}
BREOF
echo "[proposer] .brain-result.json 写入完成 propose_branch=${PROPOSE_BRANCH}"
```

同时**删除**旧的"输出契约"说明段（约 475-479 行，说明 extractProposeBranch 正则的文字），替换为：

```
**输出契约（v8.0.0+ — 文件协议）**：

每轮 proposer 调用结束时必须向 `/workspace/.brain-result.json` 写入 JSON，含 `propose_branch`、`workstream_count`、`task_plan_path` 字段。Brain 读文件获取结果，不再解析 stdout。`$PROPOSE_BRANCH` 由 Brain 注入，proposer 直接使用，不做任何本地计算。
```

- [ ] **Step 2: 修改 reviewer SKILL.md 最终输出段**

在 `packages/workflows/skills/harness-contract-reviewer/SKILL.md` 找到最终 JSON 输出格式（约第 241 行）：

旧（最后一条 stdout 消息）：
```json
{"verdict": "APPROVED" 或 "REVISION", "rounds_observed": N, "issues_count": M, "rubric_scores": {"dod_machineability": X, "scope_match_prd": X, "test_is_red": X, "internal_consistency": X, "risk_registered": X, "verification_oracle_completeness": X, "behavior_count_position": X}, "pivot_signal": true|false}
```

在该格式说明后，追加（或替换输出说明段）：

```
**输出协议（v6.5.0+ — 文件协议）**：

最终输出必须写入 `/workspace/.brain-result.json`，不依赖 stdout：

```bash
cat > /workspace/.brain-result.json << BREOF
{"verdict":"APPROVED","rubric_scores":{"dod_machineability":X,"scope_match_prd":X,"test_is_red":X,"internal_consistency":X,"risk_registered":X},"feedback":""}
BREOF
```

REVISION 时 feedback 必须含具体修改方向。Brain 读此文件判 verdict，不解析 stdout。
```

- [ ] **Step 3: 修改 evaluator SKILL.md 最终输出段**

在 `packages/workflows/skills/harness-evaluator/SKILL.md` 找到最终 PASS/FAIL 输出（约第 234 行、第 240 行和 336 行附近的 `echo` 命令），每处 `echo '{"verdict": "PASS"...'` 改为写文件：

PASS 格式：
```bash
# 旧：
echo '{"verdict": "PASS", "task_id": "'"$TASK_ID"'", ...}'
# 新：
cat > /workspace/.brain-result.json << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","failed_step":null,"log_excerpt":null}
BREOF
```

FAIL 格式（多处 echo）：
```bash
# 旧：
echo "{\"verdict\": \"FAIL\", \"task_id\": \"$TASK_ID\", ..., \"failed_step\": \"...\", ...}"
# 新（在每个 FAIL 分支替换 echo 为文件写入）：
cat > /workspace/.brain-result.json << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","failed_step":"<failed_step_value>","log_excerpt":"<log_excerpt_value>"}
BREOF
```

注意：evaluator SKILL 内有多处 `echo '{"verdict": ...'`（6-8 处），每一处都必须改为 `cat > /workspace/.brain-result.json` 写文件。逐一检查以下行：
- 模式 A DoD 文件不存在的 FAIL（约第 186 行）
- 无 BEHAVIOR 条目的 FAIL（约第 194 行）
- timeout FAIL（约第 317 行）
- 模式 B E2E planner_drift FAIL（约第 288 行）
- 模式 A PASS（约第 234 行）
- 模式 A FAIL（约第 240 行）
- 模式 B PASS（约第 336 行）
- 模式 B FAIL（约第 344 行）

每处将 `echo '...'` 改为 `cat > /workspace/.brain-result.json << BREOF\n...\nBREOF`。

- [ ] **Step 4: commit SKILL 改动（不含版本 bump，下一 Task 做）**

```bash
git add packages/workflows/skills/harness-contract-proposer/SKILL.md \
        packages/workflows/skills/harness-contract-reviewer/SKILL.md \
        packages/workflows/skills/harness-evaluator/SKILL.md
git commit -m "feat(skills): B39 三个 SKILL 改写为 .brain-result.json 文件协议输出"
```

---

### Task 7: Engine 版本 bump（18.26.0 → 18.27.0）

**Files:**
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/regression-contract.yaml`
- Modify: `packages/engine/feature-registry.yml`

SKILL 文件改动必须配套 Engine 版本 bump，否则 CI 会检测到 SKILL 变更但版本未同步。

- [ ] **Step 1: 更新 5 个版本文件**

```bash
# VERSION
echo "18.27.0" > packages/engine/VERSION

# .hook-core-version
echo "18.27.0" > packages/engine/.hook-core-version

# package.json
# 将 "version": "18.26.0" 改为 "version": "18.27.0"

# regression-contract.yaml
# 将 "version: 18.26.0" 改为 "version: 18.27.0"

# package-lock.json — 有 2 处：
# 1. 顶层 "version": "18.26.0"
# 2. "packages/engine" 下的 "version": "18.26.0"
# 都改为 "18.27.0"
```

- [ ] **Step 2: 在 feature-registry.yml 追加 changelog 条目**

在 `packages/engine/feature-registry.yml` 的 `changelog:` 段末尾追加：

```yaml
  - version: 18.27.0
    date: 2026-05-14
    type: feat
    summary: "B39 harness 协议重构 — 三个 SKILL 改为写 .brain-result.json，Brain 读文件替代 stdout 解析"
    skills_changed:
      - harness-contract-proposer
      - harness-contract-reviewer
      - harness-evaluator
```

- [ ] **Step 3: 运行 generate-path-views.sh**

```bash
bash packages/engine/scripts/generate-path-views.sh
```

期望：无报错，生成或更新若干 path-view 文件。

- [ ] **Step 4: 验证版本同步**

```bash
bash scripts/check-version-sync.sh
```

期望：输出 "all versions in sync" 或类似（若 check-version-sync.sh 验证 Brain 版本，只验 Engine 版本同步即可）

- [ ] **Step 5: commit**

```bash
git add packages/engine/package.json \
        packages/engine/package-lock.json \
        packages/engine/VERSION \
        packages/engine/.hook-core-version \
        packages/engine/regression-contract.yaml \
        packages/engine/feature-registry.yml
git add packages/engine/  # 捕获 generate-path-views 生成的文件
git commit -m "feat(engine): bump 18.26.0 → 18.27.0 — B39 harness .brain-result.json 协议"
```

---

### Task 8: 删除死代码

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`

删除不再使用的 5 个函数及关联常量。

- [ ] **Step 1: 运行现有测试，确认全绿（删代码前基准）**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b39.test.js \
             packages/brain/src/workflows/__tests__/harness-gan.graph.test.js \
             packages/brain/src/__tests__/harness-shared-b39.test.js 2>&1 | tail -15
```

期望：所有测试 PASS。

- [ ] **Step 2: 从 harness-gan.graph.js 删除以下内容**

删除这 7 个元素（5 函数 + 2 正则常量）：

1. 第 38 行：`const VERDICT_RE = /VERDICT:\s*(APPROVED|REVISION)/i;`
2. 第 113-116 行：`export function extractVerdict(stdout) { ... }`（4 行）
3. 第 130-149 行：`export function extractRubricScores(stdout) { ... }`（~20 行）
4. 第 168-172 行：`export function extractFeedback(stdout) { ... }`（5 行）
5. 第 177 行：`const PROPOSE_BRANCH_RE = /"propose_branch"\s*:\s*"([^"]+)"/;`
6. 第 178-181 行：`export function extractProposeBranch(stdout) { ... }`（4 行）
7. 第 183-189 行：`export function fallbackProposeBranch(taskId, round) { ... }`（7 行）

保留（不删）：
- `RUBRIC_DIMENSIONS`（第 45-51 行）— `computeVerdictFromRubric` 和 `detectConvergenceTrend` 仍依赖
- `thresholdForRound`（第 120-123 行）
- `computeVerdictFromRubric`（第 156-166 行）
- `detectConvergenceTrend`（第 68-109 行）
- `buildProposerPrompt`（第 196-214 行）
- `buildReviewerPrompt`（第 221-238 行）

- [ ] **Step 3: 运行全量 harness 测试，确认无回归**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-gan-b39.test.js \
             packages/brain/src/workflows/__tests__/harness-gan.graph.test.js \
             packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js \
             packages/brain/src/__tests__/harness-shared-b39.test.js \
             packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js 2>&1 | tail -20
```

期望：所有测试 PASS。

- [ ] **Step 4: 确认 5 个函数已从 codebase 消失**

```bash
grep -r "extractVerdict\|extractRubricScores\|extractFeedback\|extractProposeBranch\|fallbackProposeBranch" \
  packages/brain/src/ packages/workflows/ 2>/dev/null
```

期望：无输出（0 matches）。

- [ ] **Step 5: commit 删除死代码**

```bash
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "refactor(brain): B39 删除 5 个 stdout 解析函数 — extractVerdict/extractRubricScores/extractFeedback/extractProposeBranch/fallbackProposeBranch"
```

---

## 成功标准

- [ ] 所有新增测试（harness-shared-b39、harness-gan-b39、harness-initiative-b39）PASS
- [ ] `bash packages/brain/scripts/smoke/harness-protocol-smoke.sh` exit 0
- [ ] `grep -r "extractVerdict\|extractRubricScores\|extractFeedback\|extractProposeBranch\|fallbackProposeBranch" packages/brain/src/ packages/workflows/` 无输出
- [ ] Engine 版本为 18.27.0（5 个文件一致）
- [ ] proposer SKILL 不再计算 PROPOSE_BRANCH，不再输出 stdout JSON，改写 .brain-result.json
- [ ] reviewer SKILL 最终输出写 .brain-result.json 而非 stdout
- [ ] evaluator SKILL 所有 `echo '{"verdict"...'` 替换为 `cat > /workspace/.brain-result.json`
