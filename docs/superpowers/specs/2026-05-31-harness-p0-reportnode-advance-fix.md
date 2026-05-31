# Spec: Harness P0 Fix — reportNode verdict + advance error path

**Date**: 2026-05-31  
**Branch**: cp-0531105224-B45-harness-p0-fix  
**File**: packages/brain/src/workflows/harness-initiative.graph.js

## Problem

Two P0 bugs causing all initiatives to be marked `failed` regardless of actual outcome:

1. `state.final_e2e_verdict` is never set by any node in `buildHarnessFullGraph`.  
   `reportNode` evaluates `null === 'PASS'` → always false → `phase='failed'`, `task.status='failed'`.

2. `.addEdge('advance', 'pick_sub_task')` is unconditional.  
   When `advanceTaskIndexNode` returns `{ error: ... }` (serial gate failure),  
   graph routes to `pick_sub_task` → `routeFromPickSubTask` sees error → `END`,  
   skipping `reportNode`. DB not updated, containers not killed.

## Fix 1: reportNode — derive verdict from sub_tasks

**Location**: line ~888, inside `reportNode`

**Change**: Before computing `phase`, derive `computedVerdict`:

```js
const computedVerdict = state.final_e2e_verdict ||
  ((state.sub_tasks?.length > 0 && state.sub_tasks.every(s => s.status === 'merged'))
    ? 'PASS' : 'FAIL');
const phase = computedVerdict === 'PASS' ? 'done' : 'failed';
// ...
const taskStatus = computedVerdict === 'PASS' ? 'completed' : 'failed';
```

Also use `computedVerdict` in the `reportContent` JSON and the console.error guard.

**Logic**: If no explicit verdict was set (normal path — pre-merge evaluator already validated each WS), infer from sub_tasks. All merged → PASS. Any not merged → FAIL.

## Fix 2: buildHarnessFullGraph — conditional advance edge

**Location**: line 1075

**Change**:
```js
// Before
.addEdge('advance', 'pick_sub_task')

// After  
.addConditionalEdges('advance', stateHasError, { error: 'report', ok: 'pick_sub_task' })
```

**Effect**: Serial gate failure in `advanceTaskIndexNode` now routes to `report` node,  
which updates `initiative_runs.phase`, writes `tasks.status`, and calls `killInitiativeContainers`.

## Tests

- **test 1**: `reportNode` with `sub_tasks` all `status='merged'` and `final_e2e_verdict=null`  
  → asserts `initiative_runs` updated with `phase='done'`, `tasks.status='completed'`

- **test 2**: `advanceTaskIndexNode` returning `{ error: ... }`  
  → asserts graph routes to `report` node (not END)

## Scope

2 targeted changes, ~10 lines total. No architecture changes.
