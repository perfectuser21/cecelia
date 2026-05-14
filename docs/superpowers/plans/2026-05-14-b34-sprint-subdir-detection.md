# B34 Sprint Subdirectory Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix harness pipeline to detect `sprints/{name}/` subdirectories so planner-created artifacts are always found even when not in the flat `sprints/` directory.

**Architecture:** Three surgical edits across two files. Runner Phase A and LangGraph `parsePrdNode` gain a readdir-based subdir fallback after the existing flat-path read, and propagate the effective sprint dir through state. `defaultReadContractFile` gains the same defense-in-depth scan. A new unit test file covers all three paths.

**Tech Stack:** Node.js ESM, LangGraph `@langchain/langgraph`, vitest, `node:fs/promises`

---

## File Structure

- **Modify:** `packages/brain/src/workflows/harness-initiative.graph.js`
  - Add `sprintDir` field to `InitiativeState` and `FullInitiativeState` annotations
  - Runner Phase A: subdir scan + pass `effectiveSprintDir` to GAN
  - `parsePrdNode`: subdir scan + return `sprintDir: effectiveSprintDir`
  - `runGanLoopNode`: prefer `state.sprintDir` over `state.task?.payload?.sprint_dir`
  - `inferTaskPlanNode`: same preference
- **Modify:** `packages/brain/src/workflows/harness-gan.graph.js`
  - Add `readdir` to `node:fs/promises` import
  - `defaultReadContractFile`: subdir scan after existing flat-path + git-log-search logic
- **Create:** `packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js`

---

### Task 1: Unit tests (failing) for subdir detection

**Files:**
- Create: `packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js`

The tests import the three functions under test after mocking `node:fs/promises`. They must FAIL before the implementation changes because the current code does NOT scan subdirectories.

- [ ] **Step 1: Write the failing test file**

```js
// packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs/promises — must come before any import that uses it
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
}));

// Stub heavy deps so the graph files can be imported without side effects
vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(),
  verifyGeneratorOutput: vi.fn(),
  verifyEvaluatorWorktree: vi.fn(),
}));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(() => null), upsertTaskPlan: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => '') }));
vi.mock('../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));

import fsPromises from 'node:fs/promises';
import { defaultReadContractFile } from '../workflows/harness-gan.graph.js';
import { parsePrdNode } from '../workflows/harness-initiative.graph.js';

const ENOENT = Object.assign(new Error('no such file'), { code: 'ENOENT' });

beforeEach(() => {
  vi.clearAllMocks();
});

// ── defaultReadContractFile ─────────────────────────────────────────────────

describe('defaultReadContractFile: subdir scan (B34)', () => {
  it('returns contract from subdir when flat paths fail', async () => {
    // Flat candidates throw ENOENT
    fsPromises.readFile.mockRejectedValueOnce(ENOENT);   // sprints/contract-draft.md
    fsPromises.readFile.mockRejectedValueOnce(ENOENT);   // sprints/sprint-contract.md
    // readdir returns one subdirectory
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);
    // Subdir contract-draft.md found
    fsPromises.readFile.mockResolvedValueOnce('# Sprint Contract\nDONE');

    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('# Sprint Contract\nDONE');
  });

  it('throws when flat AND subdir both fail (no file anywhere)', async () => {
    fsPromises.readFile.mockRejectedValue(ENOENT);
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);
    await expect(defaultReadContractFile('/repo', 'sprints')).rejects.toThrow('contract file not found');
  });
});

// ── parsePrdNode ────────────────────────────────────────────────────────────

describe('parsePrdNode: subdir scan (B34)', () => {
  it('finds sprint-prd.md in subdir and returns effectiveSprintDir', async () => {
    // Flat read fails
    fsPromises.readFile.mockRejectedValueOnce(ENOENT);
    // readdir returns one subdir
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);
    // Subdir sprint-prd.md found
    fsPromises.readFile.mockResolvedValueOnce('# PRD content');

    const state = {
      task: { payload: { sprint_dir: 'sprints' } },
      plannerOutput: 'fallback stdout',
      worktreePath: '/repo',
      initiativeId: 'init-1',
    };
    const result = await parsePrdNode(state);
    expect(result.prdContent).toBe('# PRD content');
    expect(result.sprintDir).toBe('sprints/w44-walking-skeleton-b33');
  });

  it('falls back to plannerOutput when no subdir has sprint-prd.md', async () => {
    fsPromises.readFile.mockRejectedValue(ENOENT);
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);

    const state = {
      task: { payload: { sprint_dir: 'sprints' } },
      plannerOutput: 'fallback stdout',
      worktreePath: '/repo',
      initiativeId: 'init-1',
    };
    const result = await parsePrdNode(state);
    expect(result.prdContent).toBe('fallback stdout');
    expect(result.sprintDir).toBe('sprints');
  });
});
```

- [ ] **Step 2: Run tests to confirm they FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection/packages/brain
npx vitest run src/__tests__/harness-sprint-subdir-detection.test.js 2>&1 | tail -30
```

Expected: FAIL — `defaultReadContractFile` does not scan subdirs, `parsePrdNode` does not return `sprintDir`.

- [ ] **Step 3: Commit the failing test**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection
git add packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js
git commit -m "test(harness): failing tests for B34 sprint subdir detection"
```

---

### Task 2: Fix defaultReadContractFile in harness-gan.graph.js

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js:22,243-271`

- [ ] **Step 1: Add `readdir` to the `node:fs/promises` import (line 22)**

Old line:
```js
import { readFile, access } from 'node:fs/promises';
```

New line:
```js
import { readFile, readdir, access } from 'node:fs/promises';
```

- [ ] **Step 2: Add subdir scan inside `defaultReadContractFile` (after line 255, before the git-log-search block)**

The function currently reads (lines 243-270):
```js
export async function defaultReadContractFile(worktreePath, sprintDir) {
  const candidates = [
    path.join(worktreePath, sprintDir, 'contract-draft.md'),
    path.join(worktreePath, sprintDir, 'sprint-contract.md'),
  ];
  const errors = [];
  for (const p of candidates) {
    try {
      return await readFile(p, 'utf8');
    } catch (err) {
      errors.push(`${p}: ${err.code || err.message}`);
    }
  }
  try {
    const { stdout } = await execFile('git', [
      '-C', worktreePath, 'log', '--all', '--pretty=format:%H', '-S', 'Sprint Contract Draft', '--', `${sprintDir}/contract-draft.md`,
    ], { timeout: 10_000 });
    const sha = String(stdout || '').split('\n')[0].trim();
    if (sha) {
      const { stdout: content } = await execFile('git', [
        '-C', worktreePath, 'show', `${sha}:${sprintDir}/contract-draft.md`,
      ], { timeout: 10_000 });
      if (content) return content;
    }
  } catch (err) {
    errors.push(`git-log-search: ${err.message}`);
  }
  throw new Error(`contract file not found in any of: ${errors.join('; ')}`);
}
```

Replace with:
```js
export async function defaultReadContractFile(worktreePath, sprintDir) {
  const candidates = [
    path.join(worktreePath, sprintDir, 'contract-draft.md'),
    path.join(worktreePath, sprintDir, 'sprint-contract.md'),
  ];
  const errors = [];
  for (const p of candidates) {
    try {
      return await readFile(p, 'utf8');
    } catch (err) {
      errors.push(`${p}: ${err.code || err.message}`);
    }
  }
  // B34: defense-in-depth — planner may create sprints/{name}/ subdirectory.
  try {
    const entries = await readdir(path.join(worktreePath, sprintDir), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const name of ['contract-draft.md', 'sprint-contract.md']) {
        const p = path.join(worktreePath, sprintDir, entry.name, name);
        try {
          return await readFile(p, 'utf8');
        } catch { /* keep scanning */ }
      }
    }
  } catch { /* sprintDir doesn't exist or readdir failed */ }
  try {
    const { stdout } = await execFile('git', [
      '-C', worktreePath, 'log', '--all', '--pretty=format:%H', '-S', 'Sprint Contract Draft', '--', `${sprintDir}/contract-draft.md`,
    ], { timeout: 10_000 });
    const sha = String(stdout || '').split('\n')[0].trim();
    if (sha) {
      const { stdout: content } = await execFile('git', [
        '-C', worktreePath, 'show', `${sha}:${sprintDir}/contract-draft.md`,
      ], { timeout: 10_000 });
      if (content) return content;
    }
  } catch (err) {
    errors.push(`git-log-search: ${err.message}`);
  }
  throw new Error(`contract file not found in any of: ${errors.join('; ')}`);
}
```

- [ ] **Step 3: Run relevant tests to confirm passing**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection/packages/brain
npx vitest run src/__tests__/harness-sprint-subdir-detection.test.js 2>&1 | grep -E "PASS|FAIL|✓|✗|defaultReadContractFile"
```

Expected: `defaultReadContractFile` tests PASS. `parsePrdNode` tests still FAIL.

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "fix(harness): B34 defaultReadContractFile subdir scan"
```

---

### Task 3: Add `sprintDir` to LangGraph state annotations

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:542-552,790-819`

- [ ] **Step 1: Add `sprintDir` field to `InitiativeState` (line ~552)**

Find the block (lines 542-552):
```js
export const InitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
```

Add one line after the `prdContent` line:
```js
  sprintDir:      Annotation({ reducer: (_o, n) => n, default: () => null }),
```

- [ ] **Step 2: Add `sprintDir` field to `FullInitiativeState` (line ~800)**

Find the block (lines 790-805):
```js
export const FullInitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
  contract:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  contractBranch: Annotation({ reducer: (_o, n) => n, default: () => null }),
```

Add one line after the `prdContent` line (same pattern as InitiativeState):
```js
  sprintDir:      Annotation({ reducer: (_o, n) => n, default: () => null }),
```

- [ ] **Step 3: Run the full harness-gan-graph test suite to confirm no regression**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection/packages/brain
npx vitest run src/__tests__/harness-gan-graph.test.js src/__tests__/harness-sprint-subdir-detection.test.js 2>&1 | tail -20
```

Expected: All pass (the new `sprintDir` field is additive, no existing behavior changes yet).

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): B34 add sprintDir to InitiativeState + FullInitiativeState"
```

---

### Task 4: Fix parsePrdNode to scan subdirs and return effectiveSprintDir

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:631-643`

- [ ] **Step 1: Replace the `parsePrdNode` prd-reading block**

Find the block (lines 631-643):
```js
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  let prdContent = state.plannerOutput || '';
  try {
    const fsPromises = await import('node:fs/promises');
    const pathMod = (await import('node:path')).default;
    prdContent = await fsPromises.readFile(
      pathMod.join(state.worktreePath, sprintDir, 'sprint-prd.md'),
      'utf8'
    );
  } catch (err) {
    console.error(`[harness-initiative-graph] read sprint-prd.md failed (${err.message}), falling back to planner stdout`);
  }
  return { taskPlan, prdContent };  // taskPlan may be null — that is OK
```

Replace with:
```js
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  let prdContent = state.plannerOutput || '';
  let effectiveSprintDir = sprintDir;
  const fsPromises = await import('node:fs/promises');
  const pathMod = (await import('node:path')).default;
  try {
    prdContent = await fsPromises.readFile(
      pathMod.join(state.worktreePath, sprintDir, 'sprint-prd.md'),
      'utf8'
    );
  } catch (err) {
    console.error(`[harness-initiative-graph] read sprint-prd.md failed (${err.message}), scanning subdirs`);
    try {
      const entries = await fsPromises.readdir(
        pathMod.join(state.worktreePath, 'sprints'),
        { withFileTypes: true }
      );
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = pathMod.join(state.worktreePath, 'sprints', entry.name, 'sprint-prd.md');
        try {
          prdContent = await fsPromises.readFile(candidate, 'utf8');
          effectiveSprintDir = pathMod.join('sprints', entry.name);
          console.log(`[harness-initiative-graph] found sprint-prd.md in ${effectiveSprintDir}`);
          break;
        } catch { /* keep scanning */ }
      }
    } catch { /* sprints/ doesn't exist */ }
  }
  return { taskPlan, prdContent, sprintDir: effectiveSprintDir };
```

- [ ] **Step 2: Run the parsePrdNode tests to confirm they now PASS**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection/packages/brain
npx vitest run src/__tests__/harness-sprint-subdir-detection.test.js 2>&1 | tail -20
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): B34 parsePrdNode subdir scan + return effectiveSprintDir"
```

---

### Task 5: Fix runGanLoopNode and inferTaskPlanNode to prefer state.sprintDir

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:649,850`

- [ ] **Step 1: Fix `runGanLoopNode` (line 649)**

Find (line 649):
```js
    const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
```

Replace with (inside `runGanLoopNode`):
```js
    const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
```

- [ ] **Step 2: Fix `inferTaskPlanNode` (line 850)**

Find (line 850):
```js
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
```

Replace with (inside `inferTaskPlanNode`):
```js
  const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
```

- [ ] **Step 3: Run full test suite for the affected test files**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection/packages/brain
npx vitest run src/__tests__/harness-sprint-subdir-detection.test.js src/__tests__/harness-gan-graph.test.js 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): B34 runGanLoopNode + inferTaskPlanNode prefer state.sprintDir"
```

---

### Task 6: Fix Runner Phase A (non-LangGraph path) to scan subdirs

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:167-194`

The non-LangGraph runner (`runInitiativeTask`) is the fast-path for phase A. `sprintDir` is defined on line 87 as `task.payload?.sprint_dir || 'sprints'`. The GAN call at line 180-190 must receive the effective (subdir-detected) value.

- [ ] **Step 1: Replace Phase A prd-reading block (lines 167-194)**

Find the block:
```js
  // ── Phase A — GAN 合同循环（PR-4）──────────────────────────────────────
  // plannerOutput 是 Planner stdout 元数据（含"Push failed"等废话），真 PRD 在 sprints/sprint-prd.md
  let prdContent = plannerOutput;
  try {
    const fsPromises = await import('node:fs/promises');
    const pathMod = (await import('node:path')).default;
    prdContent = await fsPromises.readFile(pathMod.join(worktreePath, sprintDir, 'sprint-prd.md'), 'utf8');
  } catch (err) {
    console.error(`[harness-initiative-runner] read sprint-prd.md failed (${err.message}), falling back to planner stdout`);
  }

  let ganResult;
  try {
    ganResult = await runGanContractGraph({
      taskId: task.id,
      initiativeId,
      sprintDir,
      prdContent,
```

Replace with:
```js
  // ── Phase A — GAN 合同循环（PR-4）──────────────────────────────────────
  // plannerOutput 是 Planner stdout 元数据（含"Push failed"等废话），真 PRD 在 sprints/sprint-prd.md
  let prdContent = plannerOutput;
  let effectiveSprintDir = sprintDir;
  const fsPromises = await import('node:fs/promises');
  const pathMod = (await import('node:path')).default;
  try {
    prdContent = await fsPromises.readFile(pathMod.join(worktreePath, sprintDir, 'sprint-prd.md'), 'utf8');
  } catch (err) {
    console.error(`[harness-initiative-runner] read sprint-prd.md failed (${err.message}), scanning subdirs`);
    try {
      const entries = await fsPromises.readdir(
        pathMod.join(worktreePath, 'sprints'),
        { withFileTypes: true }
      );
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = pathMod.join(worktreePath, 'sprints', entry.name, 'sprint-prd.md');
        try {
          prdContent = await fsPromises.readFile(candidate, 'utf8');
          effectiveSprintDir = pathMod.join('sprints', entry.name);
          console.log(`[harness-initiative-runner] found sprint-prd.md in ${effectiveSprintDir}`);
          break;
        } catch { /* keep scanning */ }
      }
    } catch { /* sprints/ doesn't exist */ }
  }

  let ganResult;
  try {
    ganResult = await runGanContractGraph({
      taskId: task.id,
      initiativeId,
      sprintDir: effectiveSprintDir,
      prdContent,
```

- [ ] **Step 2: Run all harness tests**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection/packages/brain
npx vitest run src/__tests__/harness-sprint-subdir-detection.test.js src/__tests__/harness-gan-graph.test.js src/__tests__/harness-worktree.test.js src/__tests__/harness-shared.test.js 2>&1 | tail -25
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): B34 runner Phase A subdir scan + pass effectiveSprintDir to GAN"
```

---

### Task 7: DoD verification + Learning file

**Files:**
- Create: `docs/learnings/cp-0514101211-B34-sprintDir-subdir-detection.md`

- [ ] **Step 1: Verify DoD tests pass**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection/packages/brain
npx vitest run src/__tests__/harness-sprint-subdir-detection.test.js 2>&1 | tail -15
```

Expected: 4 tests pass.

- [ ] **Step 2: Verify DoD manual check — test file references extractField pattern**

```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('effectiveSprintDir'))process.exit(1);console.log('OK: effectiveSprintDir present')"
```

Expected: `OK: effectiveSprintDir present`

```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes('readdir'))process.exit(1);console.log('OK: readdir present in gan graph')"
```

Expected: `OK: readdir present in gan graph`

- [ ] **Step 3: Write Learning file**

Create `docs/learnings/cp-0514101211-B34-sprintDir-subdir-detection.md`:

```markdown
## B34 Sprint 子目录检测（2026-05-14）

### 根本原因
Harness planner 在真实 worktree 中按历史惯例创建 `sprints/{sprint-name}/` 子目录（在容器里 `HARNESS_SPRINT_DIR` env 指向完整路径），但 Brain 代码在 3 处用 `sprints/` 顶层路径硬读文件，导致 ENOENT 连锁失败：
1. Runner Phase A 读 `sprint-prd.md` → GAN 收到 planner stdout 废话而非真 PRD
2. `parsePrdNode` 同样路径 → GAN 收错内容且 state.sprintDir 缺失
3. `inferTaskPlanNode` 读 `${sprintDir}/task-plan.json` → "proposer_didnt_push" 误报

### 下次预防
- [ ] 凡读 `sprints/` 下固定文件名时，加 `readdir` fallback 扫描子目录
- [ ] 新增状态字段 (`sprintDir`) 时同步更新两处 `Annotation.Root`（`InitiativeState` + `FullInitiativeState`）
- [ ] W 级验证跑失败后优先看 Brain `console.error` 日志，ENOENT 路径错误通常一眼可见
```

- [ ] **Step 4: Commit Learning + final push prep**

```bash
cd /Users/administrator/worktrees/cecelia/B34-sprintDir-subdir-detection
git add docs/learnings/cp-0514101211-B34-sprintDir-subdir-detection.md
git commit -m "docs: add learning for B34 sprint subdir detection"
```
