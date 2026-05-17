# b44 Integration Test: phase='done' DB Writeback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add integration test asserting harness pipeline A→B→C calls `reportNode` which writes `phase='done'` to `initiative_runs` via `pool.query`. Also add smoke.sh static validation.

**Architecture:** New test file `harness-pipeline-b44-integration.test.js` mirrors B43 structure exactly, with one additional assertion block verifying that `mockPool.query` was called with SQL containing `'phase'` and params containing `'done'`. No production code changes needed — `reportNode` already writes phase='done'. TDD approach: commit-1 writes the test with the `mockPool.query` fallback intentionally omitted (causes `reportNode` to throw → test fails). Commit-2 adds the fallback → test passes.

**Tech Stack:** vitest, @langchain/langgraph MemorySaver, Node.js, bash

---

### Task 1: Write failing test + empty smoke.sh skeleton (commit-1)

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js`
- Create: `packages/brain/scripts/smoke/b44-harness-phase-done-smoke.sh`

- [ ] **Step 1: Write the test file WITHOUT mockPool.query fallback**

Create `packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

const {
  mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
  mockRunGan, mockReadFile, mockClient, mockPool,
} = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  return {
    mockSpawn: vi.fn(),
    mockEnsureWt: vi.fn(),
    mockResolveTok: vi.fn(),
    mockParseTaskPlan: vi.fn(),
    mockUpsertTaskPlan: vi.fn(),
    mockRunGan: vi.fn(),
    mockReadFile: vi.fn(),
    mockClient: client,
    mockPool: {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn(),
    },
  };
});

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWt(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveTok(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: vi.fn(),
  executeInDocker: (...a) => mockSpawn(...a),
}));
vi.mock('../../spawn/detached.js', () => ({
  spawnDockerDetached: vi.fn(async (o) => ({ containerId: o.containerId })),
}));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: vi.fn(),
  executeMerge: vi.fn(),
  classifyFailedChecks: vi.fn(),
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({
  runGanContractGraph: (...a) => mockRunGan(...a),
}));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
  extractField: () => null,
  readBrainResult: vi.fn().mockResolvedValue({ verdict: 'PASS', failed_scenarios: [] }),
}));
vi.mock('../../lib/git-fence.js', () => ({
  fetchAndShowOriginFile: vi.fn().mockResolvedValue(
    JSON.stringify({ tasks: [{ id: 'ws1', title: 'T1', dod: [], files: [] }] })
  ),
}));
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...a) => mockReadFile(...a), readdir: vi.fn().mockResolvedValue([]) },
  readFile: (...a) => mockReadFile(...a),
  readdir: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));
vi.mock('../../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  bootstrapE2E: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  teardownE2E: vi.fn(() => ({ exitCode: 0, output: '' })),
  normalizeAcceptance: (a) => a,
  attributeFailures: () => new Map(),
}));

import { buildHarnessFullGraph } from '../harness-initiative.graph.js';

describe('B44 — harness pipeline A→B→C: phase=done DB writeback', () => {
  beforeEach(() => {
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockPool.query, mockClient.query, mockClient.release,
      mockPool.connect,
    ].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
    // NOTE: mockPool.query fallback intentionally omitted — RED: reportNode throws when
    // pool.query returns undefined → test fails to prove assertion is load-bearing.
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('full graph A→B→C: reportNode writes phase=done to initiative_runs', async () => {
    // Phase A mocks
    mockEnsureWt.mockResolvedValue('/wt-b44');
    mockResolveTok.mockResolvedValue('tok-b44');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'planner output', stderr: '' });
    mockReadFile.mockResolvedValue('# Sprint PRD b44');
    mockParseTaskPlan.mockReturnValue({
      initiative_id: 'b44-init',
      tasks: [{ id: 'ws1', title: 'T1', dod: [], files: [] }],
    });
    mockRunGan.mockResolvedValue({
      contract_content: '# Contract',
      rounds: 2,
      propose_branch: 'cp-b44-test',
    });
    // DB transaction sequence for Phase A dbUpsert
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'cid-b44' }] })  // INSERT initiative_contracts
      .mockResolvedValueOnce({ rows: [{ id: 'rid-b44' }] })  // INSERT initiative_runs
      .mockResolvedValueOnce({ rows: [] });                   // COMMIT
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['ws1'] });

    // Phase B+C injectable mocks
    const mockRunSubTaskFn = vi.fn(async (state) => ({
      sub_tasks: [{ id: state.sub_task?.id, status: 'merged', pr_url: 'https://github.com/fake/pr/1' }],
    }));
    const mockFinalEvaluateFn = vi.fn(async () => ({
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
    }));

    const compiled = buildHarnessFullGraph({
      runSubTaskFn: mockRunSubTaskFn,
      finalEvaluateFn: mockFinalEvaluateFn,
    }).compile({ checkpointer: new MemorySaver() });

    const final = await compiled.invoke(
      { task: { id: 'b44-init', payload: { initiative_id: 'b44-init' } } },
      { configurable: { thread_id: 'b44:1' }, recursionLimit: 500 }
    );

    // B→C transition assertions (same as B43)
    expect(mockRunSubTaskFn).toHaveBeenCalledTimes(1);
    expect(mockFinalEvaluateFn).toHaveBeenCalledTimes(1);
    expect(final.final_e2e_verdict).toBe('PASS');

    // B44-specific: assert reportNode called pool.query with phase='done'
    const phaseCalls = mockPool.query.mock.calls.filter(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('phase') &&
        Array.isArray(params) &&
        params.includes('done')
    );
    expect(phaseCalls.length).toBeGreaterThan(0);
  }, 8000);
});
```

- [ ] **Step 2: Create empty smoke.sh skeleton**

Create `packages/brain/scripts/smoke/b44-harness-phase-done-smoke.sh`:

```bash
#!/usr/bin/env bash
# B44 smoke — static checks only (no live server needed, CI-safe)
set -euo pipefail

TEST_FILE="packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js"

echo "[b44-smoke] Checking test file exists..."
[ -f "$TEST_FILE" ] || { echo "FAIL: $TEST_FILE not found"; exit 1; }

echo "[b44-smoke] Checking phase+done assertion present..."
grep -q "sql.includes.*phase" "$TEST_FILE" || { echo "FAIL: phase assertion missing"; exit 1; }
grep -q "params.includes.*done" "$TEST_FILE" || { echo "FAIL: done param assertion missing"; exit 1; }

echo "[b44-smoke] Checking buildHarnessFullGraph import..."
grep -q "buildHarnessFullGraph" "$TEST_FILE" || { echo "FAIL: buildHarnessFullGraph import missing"; exit 1; }

echo "[b44-smoke] ALL CHECKS PASSED"
exit 0
```

- [ ] **Step 3: Run the test to verify it fails (RED)**

```bash
cd /Users/administrator/worktrees/cecelia/b44
npx vitest run packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js 2>&1 | tail -30
```

Expected: FAIL — either `TypeError: Cannot read properties of undefined (reading 'rows')` from `reportNode` trying to destructure `undefined` returned by unmocked `pool.query`, or `expect(phaseCalls.length).toBeGreaterThan(0)` fails with `Expected: > 0, Received: 0`.

- [ ] **Step 4: Run smoke.sh to verify it passes (static checks should be green)**

```bash
cd /Users/administrator/worktrees/cecelia/b44
bash packages/brain/scripts/smoke/b44-harness-phase-done-smoke.sh
```

Expected: `[b44-smoke] ALL CHECKS PASSED`

- [ ] **Step 5: Commit (commit-1 — RED test)**

```bash
cd /Users/administrator/worktrees/cecelia/b44
git add packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js
git add packages/brain/scripts/smoke/b44-harness-phase-done-smoke.sh
git commit -m "$(cat <<'EOF'
test(b44): add failing integration test — harness A→B→C phase=done DB writeback

RED: mockPool.query fallback omitted intentionally; reportNode returns undefined → test fails.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Make test pass — add mockPool.query fallback (commit-2)

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js` (add fallback in beforeEach)

- [ ] **Step 1: Add mockPool.query fallback in beforeEach**

In `harness-pipeline-b44-integration.test.js`, find the `beforeEach` block comment line:

```js
    // NOTE: mockPool.query fallback intentionally omitted — RED: reportNode throws when
    // pool.query returns undefined → test fails to prove assertion is load-bearing.
```

Replace it with:

```js
    mockPool.query.mockResolvedValue({ rows: [] });
```

The complete `beforeEach` after the change:

```js
  beforeEach(() => {
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockPool.query, mockClient.query, mockClient.release,
      mockPool.connect,
    ].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
  });
```

- [ ] **Step 2: Run the test to verify it passes (GREEN)**

```bash
cd /Users/administrator/worktrees/cecelia/b44
npx vitest run packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js 2>&1 | tail -20
```

Expected: `✓ B44 — harness pipeline A→B→C: phase=done DB writeback > full graph A→B→C: reportNode writes phase=done to initiative_runs`

- [ ] **Step 3: Run smoke.sh to verify still passes**

```bash
cd /Users/administrator/worktrees/cecelia/b44
bash packages/brain/scripts/smoke/b44-harness-phase-done-smoke.sh
```

Expected: `[b44-smoke] ALL CHECKS PASSED`

- [ ] **Step 4: Run B43 to verify no regression**

```bash
cd /Users/administrator/worktrees/cecelia/b44
npx vitest run packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js 2>&1 | tail -10
```

Expected: `✓ B43 — harness pipeline A→B→C regression guard`

- [ ] **Step 5: Commit (commit-2 — GREEN)**

```bash
cd /Users/administrator/worktrees/cecelia/b44
git add packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js
git commit -m "$(cat <<'EOF'
feat(b44): harness pipeline A→B→C integration test — assert phase=done DB writeback

GREEN: add mockPool.query fallback so reportNode can write phase=done.
Asserts phaseCalls.length > 0 — reportNode called pool.query with sql containing
'phase' and params containing 'done' after final_e2e_verdict='PASS'.
Runnable in CI ubuntu-latest, < 30s.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
