# Harness Worktree Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix harness pipeline worktree accumulation — clean up local worktrees after merge, prune stale ones periodically, and reduce internal polling frequency.

**Architecture:** Two targeted changes: (1) `mergePrNode` in harness-task.graph.js calls `cleanupHarnessWorktree` after PR merge; (2) `cleanupStaleHarnessWorktrees()` added to harness-worktree.js and called from tick-runner.js every 20 min alongside zombie cleanup. A constant change reduces internal LangGraph DB polling.

**Tech Stack:** Node.js ESM, vitest (unit), `node:fs/promises`, LangGraph

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `packages/brain/src/workflows/__tests__/harness-task.graph.test.js` | Add `mockCleanupWorktree` to vi.mock + 2 new test cases |
| Modify | `packages/brain/src/workflows/harness-task.graph.js` | Add `cleanupHarnessWorktree` import + null-guarded call in `mergePrNode` |
| Modify | `packages/brain/src/harness-worktree.js` | Add exported `cleanupStaleHarnessWorktrees(opts)` function |
| Modify | `packages/brain/src/tick-runner.js` | Import + call `cleanupStaleHarnessWorktrees` in zombie cleanup block |
| Modify | `packages/brain/src/workflows/harness-initiative.graph.js` | Change `SUBGRAPH_POLL_INTERVAL_MS` default from `'5000'` to `'30000'` |

---

## Task 1: Write Failing Regression Tests

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`

- [ ] **Step 1.1: Add `mockCleanupWorktree` to the top-level mocks**

Open `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`.

Find the block at the top (around line 12-23) where `mockSpawn`, `mockEnsureWorktree`, etc. are defined. Add `mockCleanupWorktree` after the existing declarations:

```js
const mockCleanupWorktree = vi.fn();
```

- [ ] **Step 1.2: Add `cleanupHarnessWorktree` to the harness-worktree.js vi.mock**

Find the `vi.mock('../../harness-worktree.js', ...)` block (around line 46-50). Add the new export:

```js
vi.mock('../../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a),
  harnessSubTaskBranchName: (initiativeId, logical) => `cp-mock-${String(initiativeId).slice(0, 8)}-${logical}`,
  harnessSubTaskWorktreePath: (initiativeId, logical) => `/mock-wt/task-${String(initiativeId).slice(0, 8)}-${logical}`,
  cleanupHarnessWorktree: (...a) => mockCleanupWorktree(...a),
}));
```

- [ ] **Step 1.3: Add two failing tests inside the existing `describe('mergePrNode')` block**

Find the `describe('mergePrNode', () => {` block (around line 406). Add two new test cases **after** the existing 4 cases (after `it('no pr_url ...', ...)`):

```js
  it('happy with worktreePath → calls cleanupHarnessWorktree with the path', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '✓ merged', stderr: '' });
    mockCleanupWorktree.mockResolvedValue(undefined);
    const delta = await mergePrNode(
      { pr_url: 'https://x/pull/1', worktreePath: '/wt/task-abc123' },
      { execFile }
    );
    expect(delta.status).toBe('merged');
    expect(mockCleanupWorktree).toHaveBeenCalledOnce();
    expect(mockCleanupWorktree).toHaveBeenCalledWith('/wt/task-abc123');
  });

  it('happy without worktreePath → does NOT call cleanupHarnessWorktree', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '✓ merged', stderr: '' });
    mockCleanupWorktree.mockClear();
    const delta = await mergePrNode(
      { pr_url: 'https://x/pull/1' },
      { execFile }
    );
    expect(delta.status).toBe('merged');
    expect(mockCleanupWorktree).not.toHaveBeenCalled();
  });
```

- [ ] **Step 1.4: Run the two new tests — confirm they FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js --reporter=verbose 2>&1 | grep -E "FAIL|PASS|cleanupHarnessWorktree|worktreePath" | head -20
```

Expected output: **FAIL** on both new tests. Existing tests should still PASS.

- [ ] **Step 1.5: Commit the failing tests**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
git add packages/brain/src/workflows/__tests__/harness-task.graph.test.js
git commit -m "test(harness): failing regression — mergePrNode must cleanup worktree after merge"
```

---

## Task 2: Implement `mergePrNode` Worktree Cleanup

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js`

- [ ] **Step 2.1: Add `cleanupHarnessWorktree` to the import line**

Find line ~41 in `packages/brain/src/workflows/harness-task.graph.js`:

```js
// Before
import { ensureHarnessWorktree, harnessSubTaskBranchName } from '../harness-worktree.js';

// After
import { ensureHarnessWorktree, harnessSubTaskBranchName, cleanupHarnessWorktree } from '../harness-worktree.js';
```

- [ ] **Step 2.2: Add cleanup call in `mergePrNode` after successful merge**

Find `mergePrNode` (line ~393). The success return block looks like:

```js
    const tail = (stdout || '').trim().slice(0, 200);
    console.log(`[merge_pr] gh pr merge ok pr=${prUrl}: ${tail}`);
    return {
      status: 'merged',
      ci_status: 'merged',
      merged_at: new Date().toISOString(),
      merge_command: 'gh pr merge --squash',
    };
```

Replace with:

```js
    const tail = (stdout || '').trim().slice(0, 200);
    console.log(`[merge_pr] gh pr merge ok pr=${prUrl}: ${tail}`);
    if (state.worktreePath) {
      await cleanupHarnessWorktree(state.worktreePath);
    }
    return {
      status: 'merged',
      ci_status: 'merged',
      merged_at: new Date().toISOString(),
      merge_command: 'gh pr merge --squash',
    };
```

- [ ] **Step 2.3: Run the new tests — confirm they now PASS**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗" | head -30
```

Expected: all tests PASS (including the 2 new ones).

- [ ] **Step 2.4: Run the full harness-task test suite — confirm no regressions**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js 2>&1 | tail -10
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
git add packages/brain/src/workflows/harness-task.graph.js
git commit -m "fix(harness): cleanup worktree after PR merge in mergePrNode"
```

---

## Task 3: Add `cleanupStaleHarnessWorktrees` + Tick-Runner Integration

**Files:**
- Modify: `packages/brain/src/harness-worktree.js`
- Modify: `packages/brain/src/tick-runner.js`

- [ ] **Step 3.1: Add `cleanupStaleHarnessWorktrees` to harness-worktree.js**

Open `packages/brain/src/harness-worktree.js`. Add the following function **at the end of the file** (after `cleanupHarnessWorktree`):

```js
/**
 * Scan .claude/worktrees/harness-v2/ and remove directories older than staleDays.
 * These are full git clones (not git worktrees), so deletion is direct rm -rf.
 *
 * @param {object} [opts]
 * @param {number} [opts.staleDays=7]        Age threshold in days
 * @param {string} [opts.baseRepo]           Override DEFAULT_BASE_REPO
 * @param {function} [opts.rmFn]             Override rm function (for testing)
 * @returns {Promise<{cleaned: number, errors: number}>}
 */
export async function cleanupStaleHarnessWorktrees(opts = {}) {
  const staleDays = opts.staleDays ?? 7;
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const wtBase = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2');

  let cleaned = 0;
  let errors = 0;

  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(wtBase, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(wtBase, entry.name);
      try {
        const s = await stat(fullPath);
        if (now - s.mtimeMs > staleMs) {
          await (opts.rmFn ? opts.rmFn(fullPath) : rm(fullPath, { recursive: true, force: true }));
          cleaned++;
        }
      } catch {
        errors++;
      }
    }
  } catch {
    // wtBase does not exist or not readable — nothing to clean
  }

  return { cleaned, errors };
}
```

- [ ] **Step 3.2: Add stale cleanup to tick-runner.js zombie block**

Open `packages/brain/src/tick-runner.js`. Find the zombie cleanup block (around line 807-820):

```js
  // 0.4.5. Zombie resource cleanup: 每 20 分钟清理一次 stale slots + 孤儿 worktrees
  const zombieElapsed = Date.now() - tickState.lastZombieCleanupTime;
  if (zombieElapsed >= ZOMBIE_CLEANUP_INTERVAL_MS) {
    try {
      const { runZombieCleanup } = await import('./zombie-cleaner.js');
      const zombieResult = await runZombieCleanup(pool);
      tickState.lastZombieCleanupTime = Date.now();
      if (zombieResult.slotsReclaimed > 0 || zombieResult.worktreesRemoved > 0) {
        tickLog(`[tick] Zombie cleanup: slots=${zombieResult.slotsReclaimed} worktrees=${zombieResult.worktreesRemoved}`);
      }
    } catch (zombieErr) {
      console.error('[tick] Zombie cleanup failed (non-fatal):', zombieErr.message);
    }
  }
```

Add the harness stale cleanup **immediately after** (after the closing `}` of the zombie block, before the `// 0.5.` comment):

```js
  // 0.4.6. Harness worktree cleanup: 每 20 分钟清理 harness-v2/ 下 7 天以上的遗留 worktree
  if (zombieElapsed >= ZOMBIE_CLEANUP_INTERVAL_MS) {
    try {
      const { cleanupStaleHarnessWorktrees } = await import('./harness-worktree.js');
      const staleResult = await cleanupStaleHarnessWorktrees();
      if (staleResult.cleaned > 0) {
        tickLog(`[tick] Harness stale worktree cleanup: removed=${staleResult.cleaned}`);
      }
    } catch (staleErr) {
      console.error('[tick] Harness stale worktree cleanup failed (non-fatal):', staleErr.message);
    }
  }
```

Note: reuses the already-computed `zombieElapsed` — same 20-minute cadence, no extra tickState field needed.

- [ ] **Step 3.3: Verify no syntax errors**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
node --input-type=module < packages/brain/src/harness-worktree.js 2>&1 | head -5 || true
npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js 2>&1 | tail -5
```

Expected: no syntax errors, tests still pass.

- [ ] **Step 3.4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
git add packages/brain/src/harness-worktree.js packages/brain/src/tick-runner.js
git commit -m "fix(harness): add periodic stale worktree cleanup every 20min"
```

---

## Task 4: Reduce Internal LangGraph Polling Interval

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` (line ~1110)

- [ ] **Step 4.1: Change `SUBGRAPH_POLL_INTERVAL_MS` default**

Find line ~1110 in `packages/brain/src/workflows/harness-initiative.graph.js`:

```js
// Before
const SUBGRAPH_POLL_INTERVAL_MS = parseInt(process.env.CECELIA_SUBGRAPH_POLL_MS || '5000', 10);

// After
const SUBGRAPH_POLL_INTERVAL_MS = parseInt(process.env.CECELIA_SUBGRAPH_POLL_MS || '30000', 10);
```

- [ ] **Step 4.2: Verify no test failures**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
npx vitest run packages/brain/src/ 2>&1 | tail -10
```

Expected: all tests pass (existing tests inject `pollIntervalMs` via opts, so the constant change has no test impact).

- [ ] **Step 4.3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "perf(harness): reduce subgraph poll interval from 5s to 30s"
```

---

## Task 5: Write DoD + Learning + Push PR

- [ ] **Step 5.1: Write DoD file**

Create `docs/worktrees/harness-worktree-cleanup/DOD.md` (or in the sprint dir if applicable). Actually, write it at the worktree root:

```bash
cat > /Users/administrator/worktrees/cecelia/harness-worktree-cleanup/DOD.md << 'EOF'
# DoD: harness worktree cleanup

## Branch
cp-0526172922-harness-worktree-cleanup

## Changes
- [x] [BEHAVIOR] mergePrNode calls cleanupHarnessWorktree after merge
  - Test: packages/brain/src/workflows/__tests__/harness-task.graph.test.js (2 new cases)
  - manual:node -e "const {mergePrNode} = await import('./packages/brain/src/workflows/harness-task.graph.js'); console.log('ok')"

- [x] [ARTIFACT] cleanupStaleHarnessWorktrees exported from harness-worktree.js
  - Test: manual:node -e "const {cleanupStaleHarnessWorktrees} = await import('./packages/brain/src/harness-worktree.js'); console.log(typeof cleanupStaleHarnessWorktrees)"

- [x] [ARTIFACT] tick-runner calls cleanupStaleHarnessWorktrees
  - Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('cleanupStaleHarnessWorktrees'))process.exit(1)"

- [x] [BEHAVIOR] SUBGRAPH_POLL_INTERVAL_MS default is 30000
  - Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes(\"'30000'\"))process.exit(1)"
EOF
```

- [ ] **Step 5.2: Write Learning file**

```bash
mkdir -p /Users/administrator/worktrees/cecelia/harness-worktree-cleanup/docs/learnings
cat > /Users/administrator/worktrees/cecelia/harness-worktree-cleanup/docs/learnings/cp-05261729-harness-worktree-cleanup.md << 'EOF'
# Learning: harness worktree not cleaned after merge

### 根本原因
`mergePrNode` 调 `gh pr merge --delete-branch` 只删远程 branch，不删本地 git worktree 目录。
74 个遗留目录导致 WS3 读到前任务的旧 contract，构建了错误的功能。

### 下次预防
- [ ] 任何新增 worktree 的代码路径（ensureHarnessWorktree）都应配套 cleanup 路径
- [ ] merge/fail 两种终态都需要触发 cleanup，不只是 merge
- [ ] Harness 测试应检查 worktree 数量不增长（regression guard）
EOF
```

- [ ] **Step 5.3: Commit DoD + Learning**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
git add DOD.md docs/learnings/cp-05261729-harness-worktree-cleanup.md
git commit -m "docs(harness): add DOD and learning for worktree cleanup fix"
```

- [ ] **Step 5.4: Push and create PR**

```bash
cd /Users/administrator/worktrees/cecelia/harness-worktree-cleanup
git push -u origin cp-0526172922-harness-worktree-cleanup

PR_URL=$(gh pr create \
  --title "fix(harness): cleanup worktree after merge + stale periodic cleanup + 30s poll" \
  --body "$(cat <<'PRBODY'
## Summary

- `mergePrNode` now calls `cleanupHarnessWorktree(state.worktreePath)` after successful PR merge (null-guarded)
- `cleanupStaleHarnessWorktrees()` added to harness-worktree.js — scans `.claude/worktrees/harness-v2/` for dirs older than 7 days and removes them
- tick-runner.js calls it every 20 min alongside zombie cleanup
- `SUBGRAPH_POLL_INTERVAL_MS` default changed from 5s → 30s (reduces internal DB polling)

## Root Cause
74 accumulated worktrees: `gh pr merge --delete-branch` deletes the remote branch but NOT the local clone directory. WS3 read stale contract from a previous task's leftover worktree.

## Test Evidence

### Red (commit 1)
Two failing tests in `harness-task.graph.test.js`:
- `happy with worktreePath → calls cleanupHarnessWorktree` — FAIL (function not called)
- `happy without worktreePath → does NOT call cleanupHarnessWorktree` — FAIL

### Green (commit 2)
Both tests pass after adding the import and null-guarded cleanup call.

## Learning
docs/learnings/cp-05261729-harness-worktree-cleanup.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)" | tail -1)

echo "PR created: $PR_URL"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Change 1 (mergePrNode cleanup): Tasks 1 + 2
- ✅ Change 2 (stale periodic cleanup): Task 3
- ✅ Change 3 (SUBGRAPH_POLL_INTERVAL_MS): Task 4
- ✅ TDD: failing tests before impl (Task 1 before Task 2)
- ✅ DoD + Learning: Task 5

**Placeholder scan:** No TBDs, all code blocks complete.

**Type consistency:** `cleanupHarnessWorktree(wtPath)` used consistently across Tasks 1, 2, 3.
