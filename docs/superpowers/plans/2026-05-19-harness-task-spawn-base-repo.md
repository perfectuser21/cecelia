# harness-task spawnNode baseRepo 透传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 harness Phase B 的 generator spawnNode 在外部 repo（如 ZenithJoy）任务中正确创建 worktree，不再 fallback 到 Cecelia 目录。

**Architecture:** `TaskState` 加 `baseRepo` channel，`runSubTaskNode` invoke 子图时透传 `baseRepo`，`spawnNode` 创建 worktree 时用 `state.baseRepo`。3 处最小改动，沿用既有 Annotation/ensureHarnessWorktree 模式。

**Tech Stack:** Node.js ESM, Vitest, LangGraph @langchain/langgraph

---

## File Structure

- **Modify:** `packages/brain/src/workflows/harness-task.graph.js` — TaskState 加 baseRepo channel；spawnNode 传 baseRepo 给 ensureHarnessWorktree
- **Modify:** `packages/brain/src/workflows/harness-initiative.graph.js` — runSubTaskNode compiled.invoke 加 baseRepo
- **Create:** `packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js` — 集成测试
- **Create:** `packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh` — 源码断言 smoke

---

### Task 1: E2E — 写失败测试 + smoke.sh 骨架

**Files:**
- Create: `packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js`
- Create: `packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh`

- [ ] **Step 1: 写失败测试**

文件 `packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => {
  const m = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() };
  return { default: m, ...m };
});
vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(),
  verifyGeneratorOutput: vi.fn(),
  verifyEvaluatorWorktree: vi.fn(),
}));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(() => null), upsertTaskPlan: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn(async () => 'tok') }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn(),
  loadSkillContent: vi.fn(() => ''),
  readBrainResult: vi.fn(async () => ({})),
}));
vi.mock('../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
vi.mock('../harness-session-bridge.js', () => ({
  reconnectOrSpawn: vi.fn(),
  makeSessionRecord: vi.fn(() => ({})),
}));

const mockEnsureHarnessWorktree = vi.fn(async () => '/mock-wt/task-abc');
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...args) => mockEnsureHarnessWorktree(...args),
  harnessSubTaskBranchName: vi.fn(() => 'cp-0519-ws-abc-ws1'),
  harnessTaskWorktreePath: vi.fn((id) => `/mock-wt/task-${id}`),
  DEFAULT_BASE_REPO: '/mock-cecelia',
}));

vi.mock('@langchain/langgraph', () => {
  const Annotation = vi.fn((opts) => opts);
  Annotation.Root = vi.fn((fields) => fields);
  return {
    StateGraph: vi.fn(() => ({
      addNode: vi.fn(),
      addEdge: vi.fn(),
      addConditionalEdges: vi.fn(),
      compile: vi.fn(() => ({ invoke: vi.fn() })),
    })),
    Annotation,
    START: '__start__',
    END: '__end__',
    interrupt: vi.fn(),
  };
});

import { spawnNode } from '../workflows/harness-task.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('spawnNode — baseRepo 透传到 ensureHarnessWorktree', () => {
  it('state.baseRepo 传入时，ensureHarnessWorktree 收到 baseRepo', async () => {
    const state = {
      task: { id: 'ws1', title: 'test task', payload: {} },
      initiativeId: 'abcdef12-0000-0000-0000-000000000000',
      worktreePath: null,
      githubToken: null,
      baseRepo: '/Users/admin/perfect21/zenithjoy',
      contractBranch: null,
      containerId: null,
    };

    await spawnNode(state, {
      spawnDetached: vi.fn(async () => 'container-id-123'),
      ensureWorktree: mockEnsureHarnessWorktree,
      resolveToken: vi.fn(async () => 'ghp_tok'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    });

    expect(mockEnsureHarnessWorktree).toHaveBeenCalledOnce();
    const callArgs = mockEnsureHarnessWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBe('/Users/admin/perfect21/zenithjoy');
  });

  it('state.baseRepo 为 null 时，ensureHarnessWorktree 收到 undefined（用默认 cecelia）', async () => {
    const state = {
      task: { id: 'ws1', title: 'test task', payload: {} },
      initiativeId: 'abcdef12-0000-0000-0000-000000000000',
      worktreePath: null,
      githubToken: null,
      baseRepo: null,
      contractBranch: null,
      containerId: null,
    };

    await spawnNode(state, {
      spawnDetached: vi.fn(async () => 'container-id-123'),
      ensureWorktree: mockEnsureHarnessWorktree,
      resolveToken: vi.fn(async () => 'ghp_tok'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    });

    expect(mockEnsureHarnessWorktree).toHaveBeenCalledOnce();
    const callArgs = mockEnsureHarnessWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/harness-task-spawn-base-repo.test.js 2>&1 | tail -20
```

期望失败：`expect(callArgs.baseRepo).toBe('/Users/admin/perfect21/zenithjoy')` — baseRepo 为 undefined（代码还没改）

- [ ] **Step 3: 写 smoke.sh 骨架（暂时 exit 1）**

文件 `packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh`：

```bash
#!/usr/bin/env bash
# harness-task-spawn-base-repo smoke — 验证 spawnNode baseRepo 透传逻辑
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[harness-task-spawn-base-repo smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

# TODO: 实现后改为真实断言
echo "[harness-task-spawn-base-repo smoke] STUB — not yet implemented"
exit 1
```

```bash
chmod +x packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh
```

- [ ] **Step 4: 提交（commit 1 — 失败测试 + smoke 骨架）**

```bash
git add packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js
git add packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh
git commit -m "test: harness-task spawnNode baseRepo 透传失败测试 + smoke 骨架

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现 3 处代码改动让测试通过

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js:81` — TaskState 加 baseRepo
- Modify: `packages/brain/src/workflows/harness-task.graph.js:149` — spawnNode 传 baseRepo
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:1109` — runSubTaskNode 传 baseRepo

- [ ] **Step 1: harness-task.graph.js — TaskState 加 baseRepo channel**

在 `packages/brain/src/workflows/harness-task.graph.js` 第 81 行的 `contractBranch` 之后添加一行：

```js
  contractBranch:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  baseRepo:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  // H13: 防 resume 时 spawn 节点重 import contract sprints/（git fetch 已花过 quota）
```

- [ ] **Step 2: harness-task.graph.js — spawnNode 透传 baseRepo**

在 `packages/brain/src/workflows/harness-task.graph.js` 第 149 行修改：

```js
      // 修改前
      worktreePath = await ensureWt({ taskId: task.id, initiativeId, wtKey, branch });
      // 修改后
      worktreePath = await ensureWt({ taskId: task.id, initiativeId, wtKey, branch, baseRepo: state.baseRepo || undefined });
```

- [ ] **Step 3: harness-initiative.graph.js — runSubTaskNode 透传 baseRepo**

在 `packages/brain/src/workflows/harness-initiative.graph.js` 第 1109 行，`contractBranch` 行之后插入：

```js
        githubToken: state.githubToken,
        contractBranch: state.contractBranch || state.ganResult?.propose_branch || null,
        baseRepo: state.task?.payload?.base_repo || undefined,
```

完整改动后的 invoke 调用应如下：

```js
    const firstResult = await compiled.invoke(
      {
        task: taskForGraph,
        initiativeId: state.initiativeId,
        // 不传 state.worktreePath — initiative worktree HEAD 在 contract branch（GAN proposer push）。
        // sub_task generator 期待 fresh worktree off main，让 sub-graph spawnNode 自己
        // ensureHarnessWorktree 建独立 worktree（用 sub_task.id 作 key）。
        // worktreePath: state.worktreePath,
        githubToken: state.githubToken,
        contractBranch: state.contractBranch || state.ganResult?.propose_branch || null,
        baseRepo: state.task?.payload?.base_repo || undefined,
      },
      config
    );
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd packages/brain && npx vitest run src/__tests__/harness-task-spawn-base-repo.test.js 2>&1 | tail -20
```

期望：`2 passed`

- [ ] **Step 5: 运行全量单测确认无 regression**

```bash
cd packages/brain && npx vitest run 2>&1 | tail -10
```

期望：所有测试通过（或之前就已有的失败不新增）

- [ ] **Step 6: 完成 smoke.sh 真实断言**

将 `packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh` 改为真实内容：

```bash
#!/usr/bin/env bash
# harness-task-spawn-base-repo smoke — 验证 spawnNode baseRepo 透传逻辑
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[harness-task-spawn-base-repo smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const taskSrc = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');
const initSrc = readFileSync('./src/workflows/harness-initiative.graph.js', 'utf8');

const checks = [
  { name: 'TaskState 含 baseRepo channel',                file: 'harness-task.graph.js',       src: taskSrc,  regex: /baseRepo\s*:\s*Annotation/ },
  { name: 'spawnNode ensureWt 传 baseRepo',               file: 'harness-task.graph.js',       src: taskSrc,  regex: /ensureWt\s*\(\s*\{[^}]*baseRepo\s*:/ },
  { name: 'runSubTaskNode compiled.invoke 含 baseRepo',   file: 'harness-initiative.graph.js', src: initSrc,  regex: /compiled\.invoke\s*\(\s*\{[\s\S]{0,500}baseRepo/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(c.src)) {
    console.error('FAIL:', c.name, '未命中', String(c.regex));
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('[harness-task-spawn-base-repo smoke] PASS — 3 项源码断言通过');
" || { echo "[harness-task-spawn-base-repo smoke] FAIL"; exit 1; }
```

- [ ] **Step 7: 提交（commit 2 — 实现 + 完整 smoke）**

```bash
git add packages/brain/src/workflows/harness-task.graph.js
git add packages/brain/src/workflows/harness-initiative.graph.js
git add packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh
git commit -m "feat: harness-task spawnNode 透传 baseRepo 支持外部 repo worktree

spawnNode 创建 generator worktree 时没传 baseRepo，导致外部 repo（如 ZenithJoy）
任务的 worktree 在 Cecelia 目录创建，随后 git fetch origin contract-branch 失败。

修复：TaskState 加 baseRepo channel，spawnNode 传给 ensureHarnessWorktree，
runSubTaskNode 从 task.payload.base_repo 透传给子图。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## DB 恢复操作（代码合并后）

> 此步骤在 PR 合并、Brain 重启后执行，恢复卡住的任务 `9a6a6c97`。

- [ ] **Step A: 删除 ws1 子图 checkpoint（让 spawnNode 重新执行）**

```bash
psql cecelia -c "DELETE FROM checkpoint_writes WHERE thread_id = 'harness-task:9a6a6c97-105e-4198-9acf-bb76ddd1036f:ws1';"
psql cecelia -c "DELETE FROM checkpoints WHERE thread_id = 'harness-task:9a6a6c97-105e-4198-9acf-bb76ddd1036f:ws1';"
```

- [ ] **Step B: 设置任务从 checkpoint :2 恢复（不重跑 GAN）**

```bash
psql cecelia -c "
UPDATE tasks
SET execution_attempts = 1,
    payload = payload || '{\"resume_from_checkpoint\": true}'::jsonb
WHERE id = '9a6a6c97-105e-4198-9acf-bb76ddd1036f';
"
```

- [ ] **Step C: 重启 Brain（加载新代码）**

```bash
kill $(pgrep -f "node server.js" | head -1)
# Brain 由 guardian 自动重启，或手动：
# cd /Users/administrator/perfect21/cecelia/packages/brain && node server.js &
```

- [ ] **Step D: 确认 ws1 子图重新运行**

```bash
# 等待约 30s 后检查
psql cecelia -c "SELECT thread_id, checkpoint_id FROM checkpoints WHERE thread_id LIKE '%ws1%' ORDER BY checkpoint_id DESC LIMIT 3;"
# 期望看到新的 checkpoint 条目（时间戳比之前新）

docker ps | grep "harness-task"
# 期望看到 generator 容器在运行
```
