# Harness Worktree Cleanup Bug Fix — Design Spec

**Date**: 2026-05-26  
**Branch**: cp-0526172922-harness-worktree-cleanup  
**Scope**: `harness-task.graph.js`, `harness-initiative.graph.js`, `tick-runner.js`

---

## Problem

Every harness WS creates a local git worktree at `.claude/worktrees/harness-v2/task-<id>/`. These are never cleaned up:

1. `mergePrNode` uses `--delete-branch` which deletes the remote branch, but does NOT remove the local worktree
2. No periodic cleanup job exists for stale worktrees
3. 74 accumulated worktrees caused WS contamination (WS3 read old contract from a previous task's worktree)

Additionally, the LangGraph sub-graph internal polling interval is 5s which is unnecessarily frequent.

---

## Design

### Change 1 — `mergePrNode` calls `cleanupHarnessWorktree` after merge

**File**: `packages/brain/src/workflows/harness-task.graph.js`  
**Function**: `mergePrNode` (line ~411)

After a successful `gh pr merge --squash --delete-branch`, add:

```js
if (state.worktreePath) {
  await cleanupHarnessWorktree(state.worktreePath);
}
```

Requires adding to imports:
```js
import { ensureHarnessWorktree, harnessSubTaskBranchName, cleanupHarnessWorktree } from '../harness-worktree.js';
```

**Null guard rationale**: `worktreePath` default is `null` in Annotation. While it should always be set by `spawnNode`, defensive coding matches existing pattern (lines 330, 651).

**`cleanupHarnessWorktree` guarantees**: Already idempotent, handles non-existent paths gracefully.

---

### Change 2 — tick-runner periodic stale worktree cleanup

**File**: `packages/brain/src/tick-runner.js`  
**Placement**: Near zombie cleanup block (~line 815), same 20-minute cadence

Logic:
1. `git worktree prune` (cwd: repo root) — removes dangling worktree refs
2. Scan `<REPO_ROOT>/.claude/worktrees/harness-v2/` for directories with `mtime > 7 days`
3. For each stale dir: call `cleanupHarnessWorktree(path)` (same function, cwd-aware)

Import `cleanupHarnessWorktree` from `harness-worktree.js` in tick-runner.js.

**7-day threshold**: Conservative; harness tasks complete in < 2 hours under normal conditions. 7 days ensures no live task is affected.

---

### Change 3 — `SUBGRAPH_POLL_INTERVAL_MS` 5000 → 30000

**File**: `packages/brain/src/workflows/harness-initiative.graph.js`  
**Line**: 1110

```js
// Before
const SUBGRAPH_POLL_INTERVAL_MS = parseInt(process.env.CECELIA_SUBGRAPH_POLL_MS || '5000', 10);

// After
const SUBGRAPH_POLL_INTERVAL_MS = parseInt(process.env.CECELIA_SUBGRAPH_POLL_MS || '30000', 10);
```

Reduces internal LangGraph DB `getState()` polling from 5s to 30s. No functional change; tests use `opts.pollIntervalMs` injection so existing tests unaffected.

---

## Testing Strategy

| Test | Type | File |
|------|------|------|
| `mergePrNode` calls `cleanupHarnessWorktree` on successful merge | Integration | `harness-task.graph.test.js` |
| `mergePrNode` does NOT call cleanup when `worktreePath` is null | Integration | `harness-task.graph.test.js` |

TDD sequence:
1. `commit-1`: Write failing tests (cleanupHarnessWorktree not called yet)
2. `commit-2`: Implement Changes 1-3, tests go green

---

## What's NOT in scope

- Changing CI polling interval (already 90s — correct)
- Investigating root cause of the parallel dispatch (separate issue)
- Migrating existing 74 stale worktrees (Change 2 periodic cleanup handles these over time; can also run manually once)

---

## Success Criteria

- [ ] `mergePrNode` test: cleanup called on merge success, skipped when worktreePath is null
- [ ] CI green
- [ ] Manual: next harness run leaves no worktree in `.claude/worktrees/harness-v2/` after WS completes
