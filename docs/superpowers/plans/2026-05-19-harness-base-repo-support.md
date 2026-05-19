# Harness Base Repo Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 harness pipeline 支持外部 repo（通过 task payload 的 `base_repo` 字段），使 ZenithJoy 等非 Cecelia 仓库能走同一 harness pipeline。

**Architecture:** `harness-initiative.graph.js` 的两处 `ensureHarnessWorktree` 调用都没传 `baseRepo`，`harness-worktree.js` 已有 `opts.baseRepo` 参数但从未被调用方传入。只需在两处调用点从 `task.payload?.base_repo` 读取并透传。

**Tech Stack:** Node.js ESM, Vitest, bash smoke

---

## File Structure

| 文件 | 动作 | 说明 |
|------|------|------|
| `packages/brain/src/workflows/harness-initiative.graph.js` | **Modify** | 两处调用透传 `baseRepo` |
| `packages/brain/src/__tests__/harness-initiative-base-repo.test.js` | **Create** | unit 验证 `base_repo` 透传 |
| `packages/brain/scripts/smoke/base-repo-support-smoke.sh` | **Create** | 源码断言 smoke |

---

## Task 1: 写失败的集成测试

**Files:**
- Create: `packages/brain/src/__tests__/harness-initiative-base-repo.test.js`

- [ ] **Step 1: 创建测试文件**

```js
// packages/brain/src/__tests__/harness-initiative-base-repo.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 必须在任何 import graph 之前声明 mock ──
vi.mock('node:fs/promises', () => {
  const m = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn() };
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
  readBrainResult: vi.fn(),
}));
vi.mock('../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
vi.mock('../harness-session-bridge.js', () => ({
  reconnectOrSpawn: vi.fn(),
  makeSessionRecord: vi.fn(),
}));
vi.mock('../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));

const mockEnsureWorktree = vi.fn(async () => '/mock-wt/task-abc');
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...args) => mockEnsureWorktree(...args),
  harnessTaskWorktreePath: vi.fn((id) => `/mock-wt/task-${id}`),
  DEFAULT_BASE_REPO: '/mock-cecelia',
}));

import { prepInitiativeNode } from '../workflows/harness-initiative.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureWorktree.mockResolvedValue('/mock-wt/task-abc');
});

// ── prepInitiativeNode ────────────────────────────────────────────────────────

describe('prepInitiativeNode — base_repo 透传', () => {
  it('当 payload 有 base_repo 时，透传给 ensureHarnessWorktree', async () => {
    const state = {
      task: {
        id: 'task-id-abc123',
        payload: { base_repo: '/Users/admin/perfect21/zenithjoy' },
      },
    };

    await prepInitiativeNode(state);

    expect(mockEnsureWorktree).toHaveBeenCalledOnce();
    const callArgs = mockEnsureWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBe('/Users/admin/perfect21/zenithjoy');
    expect(callArgs.taskId).toBe('task-id-abc123');
  });

  it('当 payload 没有 base_repo 时，不传 baseRepo（让 worktree fallback DEFAULT）', async () => {
    const state = {
      task: {
        id: 'task-no-base',
        payload: { sprint_dir: 'sprints' },
      },
    };

    await prepInitiativeNode(state);

    const callArgs = mockEnsureWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBeUndefined();
  });

  it('已有 worktreePath 时，跳过调用（幂等）', async () => {
    const state = {
      worktreePath: '/existing/wt',
      task: { id: 'x', payload: { base_repo: '/some/repo' } },
    };

    const result = await prepInitiativeNode(state);

    expect(mockEnsureWorktree).not.toHaveBeenCalled();
    expect(result.worktreePath).toBe('/existing/wt');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
npx vitest run packages/brain/src/__tests__/harness-initiative-base-repo.test.js 2>&1 | tail -20
```

预期：**FAIL** — `expect(callArgs.baseRepo).toBe(...)` 失败，因为目前 `prepInitiativeNode` 没传 `baseRepo`。

---

## Task 2: 实现 prepInitiativeNode 透传

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:547-557`

- [ ] **Step 1: 修改 prepInitiativeNode**

定位 `prepInitiativeNode`（约 line 547）：

```js
// 当前代码（约 line 547-557）
export async function prepInitiativeNode(state) {
  if (state.worktreePath) return { worktreePath: state.worktreePath };
  try {
    const initiativeId = state.task?.payload?.initiative_id || state.task?.initiative_id || state.task?.id;
    const worktreePath = await ensureHarnessWorktree({ taskId: state.task.id, initiativeId });
    const githubToken = await resolveGitHubToken();
    return { worktreePath, githubToken, initiativeId };
  } catch (err) {
    return { error: { node: 'prep', message: err.message } };
  }
}
```

改为：

```js
export async function prepInitiativeNode(state) {
  if (state.worktreePath) return { worktreePath: state.worktreePath };
  try {
    const initiativeId = state.task?.payload?.initiative_id || state.task?.initiative_id || state.task?.id;
    const baseRepo = state.task?.payload?.base_repo || undefined;
    const worktreePath = await ensureHarnessWorktree({ taskId: state.task.id, initiativeId, baseRepo });
    const githubToken = await resolveGitHubToken();
    return { worktreePath, githubToken, initiativeId };
  } catch (err) {
    return { error: { node: 'prep', message: err.message } };
  }
}
```

- [ ] **Step 2: 运行 prepInitiativeNode 相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
npx vitest run packages/brain/src/__tests__/harness-initiative-base-repo.test.js 2>&1 | tail -20
```

预期：`prepInitiativeNode` 的 3 个 case **PASS**。

---

## Task 3: 修改 runInitiative prep 节点 + commit

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:110-119`

- [ ] **Step 1: 修改 runInitiative 函数的 prep 节点**

定位约 line 110-119（`// ── Prep：挂载 worktree` 区块）：

```js
// 当前代码
let worktreePath;
let githubToken;
try {
  worktreePath = await ensureHarnessWorktree({ taskId: task.id, initiativeId });
  githubToken = await resolveGitHubToken();
} catch (err) {
  console.error(`[harness-initiative-runner] prep failed task=${task.id}: ${err.message}`);
  return { success: false, taskId: task.id, initiativeId, error: err.message };
}
```

改为：

```js
let worktreePath;
let githubToken;
try {
  const baseRepo = task.payload?.base_repo || undefined;
  worktreePath = await ensureHarnessWorktree({ taskId: task.id, initiativeId, baseRepo });
  githubToken = await resolveGitHubToken();
} catch (err) {
  console.error(`[harness-initiative-runner] prep failed task=${task.id}: ${err.message}`);
  return { success: false, taskId: task.id, initiativeId, error: err.message };
}
```

- [ ] **Step 2: 跑全量 harness-initiative 相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
npx vitest run packages/brain/src/__tests__/harness-initiative-base-repo.test.js packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js packages/brain/src/__tests__/harness-initiative-evaluate.test.js 2>&1 | tail -30
```

预期：全部 **PASS**。

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
git add packages/brain/src/__tests__/harness-initiative-base-repo.test.js \
        packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "feat: harness-initiative pass base_repo from task payload to ensureHarnessWorktree"
```

---

## Task 4: 写 smoke.sh + commit

**Files:**
- Create: `packages/brain/scripts/smoke/base-repo-support-smoke.sh`

- [ ] **Step 1: 创建 smoke 脚本**

```bash
#!/usr/bin/env bash
# base-repo-support smoke — 验证 harness-initiative.graph.js 含 base_repo 透传逻辑
#
# 不需要真启 Brain；在 brain 容器内做源码断言。
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[base-repo-support smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-initiative.graph.js', 'utf8');

const checks = [
  { name: 'prepInitiativeNode 读 base_repo',   regex: /state\\.task\??\\.payload\??\\.base_repo/ },
  { name: 'runInitiative 读 base_repo',         regex: /task\\.payload\??\\.base_repo/ },
  { name: 'baseRepo 传入 ensureHarnessWorktree', regex: /ensureHarnessWorktree\(\s*\{[^}]*baseRepo/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) {
    console.error('FAIL:', c.name, '未命中', String(c.regex));
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('[base-repo-support smoke] PASS — 3 项源码断言通过');
" || { echo "[base-repo-support smoke] FAIL"; exit 1; }
```

- [ ] **Step 2: 赋予执行权限**

```bash
chmod +x /Users/administrator/worktrees/cecelia/base-repo-support/packages/brain/scripts/smoke/base-repo-support-smoke.sh
```

- [ ] **Step 3: 本地验证（brain 容器不在就 SKIP）**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
bash packages/brain/scripts/smoke/base-repo-support-smoke.sh
```

预期：`PASS — 3 项源码断言通过` 或 `SKIP — brain container not running`（容器未起时跳过，CI 会起容器）。

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
git add packages/brain/scripts/smoke/base-repo-support-smoke.sh
git commit -m "feat(smoke): base-repo-support smoke 源码断言"
```

---

## Task 5: push + PR

- [ ] **Step 1: push 分支**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
git push origin cp-0519095030-base-repo-support
```

- [ ] **Step 2: 创建 PR**

```bash
cd /Users/administrator/worktrees/cecelia/base-repo-support
gh pr create \
  --title "feat: harness pipeline 支持外部 repo (base_repo payload)" \
  --body "$(cat <<'EOF'
## Summary

- 在 `harness-initiative.graph.js` 两处 `ensureHarnessWorktree` 调用里透传 `task.payload.base_repo`
- `harness-worktree.js` 原本已支持 `opts.baseRepo`，本 PR 补齐调用方
- 新增集成测试验证 payload 字段透传
- 新增 smoke.sh 源码断言

## 影响

- 现有无 `base_repo` 的任务行为不变（fallback DEFAULT_BASE_REPO）
- ZenithJoy 等外部 repo 的 `harness_initiative` 任务可通过 `"base_repo": "/path/to/zenithjoy"` 指定仓库

## Test plan
- [ ] `harness-initiative-base-repo.test.js` 3 个 case PASS
- [ ] `base-repo-support-smoke.sh` PASS 或 SKIP（无容器时）
- [ ] 相关 harness-initiative 测试无回归

🤖 Generated with Claude Code
EOF
)"
```

- [ ] **Step 3: 回写 Brain 任务**

```bash
# 将 PR_URL 替换为实际 PR URL
curl -X PATCH localhost:5221/api/brain/tasks/<TASK_ID> \
  -H "Content-Type: application/json" \
  -d '{"status":"completed","result":{"pr_url":"<PR_URL>","merged":false}}'
```
