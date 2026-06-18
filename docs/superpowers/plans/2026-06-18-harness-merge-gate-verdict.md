# harness 合并门旁路修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** reportNode 自合 PR 前校验 sub_task.evaluate_verdict==='PASS'，堵住 CI 绿但裁判 FAIL/未跑的 PR 被强合算 PASS 的旁路。

**Architecture:** 三处纵深防御改动——(1) runSubTaskNode 透传 evaluate_verdict 打通数据流断点；(2) reportNode 自合段加 verdict gate（只 gate 自合，不动 merge-race 纠正以保住 #3398 假摔修复）；(3) orphan-pr-worker 按分支模式豁免 harness sub_task PR 防外部偷合。

**Tech Stack:** Node.js ESM, vitest, LangGraph (mocked in tests)

---

### Task 1: runSubTaskNode 透传 evaluate_verdict

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:1338-1354`（return 的 sub_task 对象）
- Test: `packages/brain/src/__tests__/harness-subtask-verdict-passthrough.test.js`（Create）

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => '') }));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn(), topologicalOrder: vi.fn(), detectCycle: vi.fn(), nextRunnableTask: vi.fn() }));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn(), harnessSubTaskBranchName: vi.fn(() => 'cp-test-ws-x'), harnessContractThreadSuffix: vi.fn(() => '') }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../harness-container-cleanup.js', () => ({ killInitiativeContainers: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@langchain/langgraph', () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class { addNode() { return this; } addEdge() { return this; } addConditionalEdges() { return this; } compile() { return { invoke: vi.fn() }; } },
    Annotation, START: '__start__', END: '__end__', interrupt: vi.fn(), Command: class {}, MemorySaver: class {},
  };
});

import { runSubTaskNode } from '../workflows/harness-initiative.graph.js';

const INIT_ID = '1fe4f146-4d79-426f-b010-a98e3efb6d3a';

describe('runSubTaskNode 透传 evaluate_verdict', () => {
  beforeEach(() => vi.clearAllMocks());

  it('子图终态带 evaluate_verdict=PASS → 返回的 sub_task 透传该字段', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() };
    const compiledTaskGraph = {
      invoke: vi.fn().mockResolvedValue({ status: 'merged', pr_url: 'https://x/pull/1', evaluate_verdict: 'PASS' }),
    };
    const state = { initiativeId: INIT_ID, sub_task: { id: 'ws1', title: 't', payload: {} } };
    const out = await runSubTaskNode(state, { pool, compiledTaskGraph, waitMs: 0 });
    expect(out.sub_tasks[0].evaluate_verdict).toBe('PASS');
  });

  it('子图终态带 evaluate_verdict=FAIL → 透传 FAIL', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() };
    const compiledTaskGraph = {
      invoke: vi.fn().mockResolvedValue({ status: 'failed', pr_url: 'https://x/pull/2', evaluate_verdict: 'FAIL' }),
    };
    const state = { initiativeId: INIT_ID, sub_task: { id: 'ws1', title: 't', payload: {} } };
    const out = await runSubTaskNode(state, { pool, compiledTaskGraph, waitMs: 0 });
    expect(out.sub_tasks[0].evaluate_verdict).toBe('FAIL');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-subtask-verdict-passthrough.test.js`
Expected: FAIL — `expected undefined to be 'PASS'`（当前 return 没有 evaluate_verdict 字段）

- [ ] **Step 3: 实现透传**

在 `harness-initiative.graph.js` 的 `runSubTaskNode` return（约 1338 行 `return { sub_tasks: [{ ... }] }`）的 sub_task 对象里，紧跟 `evaluator_feedback:` 之后增加一行：

```javascript
      // 透传子图裁判 verdict — reportNode 自合 gate 据此判断是否允许自合（防 CI 绿但裁判 FAIL 的 PR 被算 PASS）
      evaluate_verdict: final.evaluate_verdict ?? null,
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-subtask-verdict-passthrough.test.js`
Expected: PASS（2 passed）

- [ ] **Step 5: commit（先 test 后 impl 两段式）**

```bash
git add packages/brain/src/__tests__/harness-subtask-verdict-passthrough.test.js
git commit -m "test(harness): runSubTaskNode 透传 evaluate_verdict 失败测试(Red)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): runSubTaskNode 透传 evaluate_verdict — 打通子图→initiative 数据流断点(Green)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: reportNode 自合 gate（核心洞）

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:1426-1440`（自合段）
- Test: `packages/brain/src/__tests__/harness-report-self-merge-gate.test.js`（Create）

- [ ] **Step 1: 写失败测试**

复用 Task 1 测试文件头部全套 `vi.mock`（同样 13 个 mock + langgraph mock），import 改为 `reportNode`：

```javascript
// ... 同 Task 1 的全套 vi.mock（13 个 + @langchain/langgraph）...
import { reportNode } from '../workflows/harness-initiative.graph.js';

const INIT_ID = '1fe4f146-4d79-426f-b010-a98e3efb6d3a';
const PR_URL = 'https://github.com/perfectuser21/infrastructure/pull/50';

function makeMockPool() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn().mockResolvedValue(client) };
  return { pool, client };
}
function getInitiativeRunsPhase(client) {
  for (const call of client.query.mock.calls) {
    const sql = String(call[0] || '');
    if (sql.includes('initiative_runs') && sql.includes('SET phase')) return call[1]?.[1];
  }
  return null;
}

describe('reportNode 自合 verdict gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SC-403: evaluate_verdict=FAIL + CI绿未合 → 不自合，verdict FAIL', async () => {
    const { pool, client } = makeMockPool();
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL, evaluate_verdict: 'FAIL' }],
    };
    await reportNode(state, { pool, execFile, _checkPrMerged: checkPrMerged });
    expect(execFile).not.toHaveBeenCalled();
    expect(getInitiativeRunsPhase(client)).toBe('failed');
  });

  it('SC-404: evaluate_verdict=PASS + CI绿未合 → 自合，verdict PASS（保住假摔修复）', async () => {
    const { pool, client } = makeMockPool();
    const execFile = vi.fn().mockResolvedValue({ stdout: 'merged', stderr: '' });
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL, evaluate_verdict: 'PASS' }],
    };
    await reportNode(state, { pool, execFile, _checkPrMerged: checkPrMerged });
    expect(execFile).toHaveBeenCalledWith('gh', expect.arrayContaining(['pr', 'merge', PR_URL]), expect.anything());
    expect(getInitiativeRunsPhase(client)).toBe('done');
  });

  it('SC-405: evaluate_verdict=null（未透传）+ CI绿未合 → 不自合，verdict FAIL', async () => {
    const { pool, client } = makeMockPool();
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL, evaluate_verdict: null }],
    };
    await reportNode(state, { pool, execFile, _checkPrMerged: checkPrMerged });
    expect(execFile).not.toHaveBeenCalled();
    expect(getInitiativeRunsPhase(client)).toBe('failed');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-report-self-merge-gate.test.js`
Expected: SC-403/SC-405 FAIL — 当前自合段无条件调 execFile（execFile 被调用，断言 not.toHaveBeenCalled 失败）

- [ ] **Step 3: 实现 gate**

在 `harness-initiative.graph.js` 自合段（约 1426-1440，`reconciledSubTasks = await Promise.all(reconciledSubTasks.map(async (s) => {` 块内），在 `if (!s || s.status === 'merged' || !s.pr_url) return s;` 之后、`try {` 之前，增加 verdict gate：

```javascript
    // 合并门 gate：只有子图裁判 evaluate_verdict==='PASS' 才允许自合（与子图 routeAfterEvaluate 同判据）。
    // 否则不自合，保持非 merged → computedVerdict 自然 FAIL。堵住 CI 绿但裁判 FAIL/未跑的 PR 被强合算 PASS 的旁路。
    // 注意：只 gate 自合（reportNode 主动行为，持有 sub_task state）；不动上面 merge-race 纠正段
    // （那段处理 PR 真已被子图合、graph state 未刷新的合法 PASS，无 verdict 字段，加 gate 会破坏 #3398 假摔修复）。
    if (s.evaluate_verdict !== 'PASS') {
      console.warn(`[reportNode] 拒绝自合 ${s.id} ${s.pr_url}：evaluate_verdict=${s.evaluate_verdict ?? 'null'}（非 PASS，不许合并算 PASS）`);
      return s;
    }
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-report-self-merge-gate.test.js`
Expected: PASS（3 passed）

- [ ] **Step 5: 跑回归确保 merge-race 测试不破**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-report-merge-recheck.test.js`
Expected: PASS（SC-401/SC-402 仍过——注：SC-402 现在更确定，因 sub_task 无 evaluate_verdict=PASS，gate 直接拦自合）

- [ ] **Step 6: commit（两段式）**

```bash
git add packages/brain/src/__tests__/harness-report-self-merge-gate.test.js
git commit -m "test(harness): reportNode 自合 verdict gate 失败测试(Red)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): reportNode 自合前校验 evaluate_verdict===PASS — 堵裁判旁路(Green)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: orphan-pr-worker 豁免 harness sub_task PR

**Files:**
- Modify: `packages/brain/src/orphan-pr-worker.js`（scanOrphanPrs for 循环开头，约 257 行 `try {` 之后）
- Test: `packages/brain/src/__tests__/orphan-pr-worker.test.js`（追加 case）

- [ ] **Step 1: 在现有测试文件追加失败测试**

在 `orphan-pr-worker.test.js` 的 `describe` 块内追加：

```javascript
  it('case 13: harness sub_task PR（cp-*-ws-<hex>）→ skip harness_subtask_pr，不合不 label', async () => {
    const merged = [];
    execSync.mockImplementation(
      routeExec({
        prList: [
          {
            number: 1300,
            url: 'https://github.com/o/r/pull/1300',
            headRefName: 'cp-06181506-ws-3f893d17-ws1',
            createdAt: hoursAgoIso(5),
            updatedAt: hoursAgoIso(4),
          },
        ],
        prChecks: { 1300: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }] },
        onMerge: (n, cmd) => merged.push({ n, cmd }),
      })
    );
    pool.query.mockResolvedValue({ rows: [] });

    const r = await scanOrphanPrs(pool);
    expect(r.scanned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.details[0]).toMatchObject({ pr: 1300, action: 'skipped', reason: 'harness_subtask_pr' });
    expect(merged).toHaveLength(0);
    // 不应查 Brain DB（豁免在 DB 查询之前）
    expect(pool.query).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd packages/brain && npx vitest run src/__tests__/orphan-pr-worker.test.js -t "case 13"`
Expected: FAIL — 当前会走 ci_green → merge（merged=1），断言 skipped 失败

- [ ] **Step 3: 实现豁免**

在 `orphan-pr-worker.js` 顶部常量区（约 41 行 `DEFAULT_ORPHAN_LABEL` 定义后）增加正则常量：

```javascript
// harness sub_task PR 分支模式 cp-<MMDDHHMM>-ws-<init8>-...（实证 cp-06171703-ws-3f893d17-ws1）。
// 这类 PR 由 harness sub-graph 的 evaluator pre-merge gate 自管，orphan-worker 绝不偷合
// （否则会合掉还在等裁判的 PR，绕过 evaluate_verdict gate）。普通 /dev 的 cp-<stamp>-<slug> 不撞。
const HARNESS_SUBTASK_BRANCH_RE = /^cp-\d{8,10}-ws-[0-9a-f]{6,8}/;
```

在 `scanOrphanPrs` 的 `for (const pr of candidates) {` 循环内、`try {` 之后的**第一件事**（在 `let active = false;` 之前）增加豁免：

```javascript
      // harness sub_task PR 豁免：交给 sub-graph merge_pr gate 自管，orphan-worker 不碰
      if (HARNESS_SUBTASK_BRANCH_RE.test(pr.headRefName)) {
        result.skipped++;
        result.details.push({
          pr: pr.number,
          url: pr.url,
          branch: pr.headRefName,
          action: 'skipped',
          reason: 'harness_subtask_pr',
        });
        continue;
      }
```

- [ ] **Step 4: 跑测试验证通过 + 全文件回归**

Run: `cd packages/brain && npx vitest run src/__tests__/orphan-pr-worker.test.js`
Expected: PASS（含 case 13 共 13 个 + 现有全过）

- [ ] **Step 5: commit（两段式）**

```bash
git add packages/brain/src/__tests__/orphan-pr-worker.test.js
git commit -m "test(harness): orphan-pr-worker 豁免 harness sub_task PR 失败测试(Red)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git add packages/brain/src/orphan-pr-worker.js
git commit -m "fix(harness): orphan-pr-worker 按 cp-*-ws-<hex> 豁免 harness sub_task PR — 防外部偷合(Green)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 全量回归 + Learning

- [ ] **Step 1: 跑相关测试全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-subtask-verdict-passthrough.test.js src/__tests__/harness-report-self-merge-gate.test.js src/__tests__/harness-report-merge-recheck.test.js src/__tests__/orphan-pr-worker.test.js`
Expected: 全 PASS

- [ ] **Step 2: 写 Learning（push 前必须，加入 commit）**

Create: `docs/learnings/cp-MMDDHHNN-harness-merge-gate-verdict.md`，含 `### 根本原因` + `### 下次预防` + `- [ ]` checklist（见 engine-ship 阶段处理）。
