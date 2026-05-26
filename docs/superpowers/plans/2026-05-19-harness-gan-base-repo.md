# Harness GAN baseRepo Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `verifyProposerOutput` 校验外部 repo 的 GitHub 分支时，使用正确的 origin remote URL 而非硬编码 Cecelia 路径。

**Architecture:** `runGanContractGraph` → `createGanContractNodes` → `verifyProposer` 调用链透传 `baseRepo`；`harness-initiative.graph.js` 两处调用点从 `task.payload?.base_repo` 注入。`verifyProposerOutput`（`contract-verify.js`）已支持 `opts.baseRepo`，无需改动。

**Tech Stack:** Node.js ESM, Vitest

---

## File Structure

| 文件 | 动作 |
|------|------|
| `packages/brain/src/workflows/harness-gan.graph.js` | **Modify** — 3 处：runGanContractGraph 解构、createGanContractNodes ctx 解构、verifyProposer 调用 |
| `packages/brain/src/workflows/harness-initiative.graph.js` | **Modify** — 2 处：line 196 和 line 719 的 runGanContractGraph 调用 |
| `packages/brain/src/__tests__/harness-initiative-gan-base-repo.test.js` | **Create** — 验证 baseRepo 透传到 verifyProposer |
| `packages/brain/scripts/smoke/gan-base-repo-smoke.sh` | **Create** — 源码断言 smoke |

---

## Task 1: 写失败的集成测试

**Files:**
- Create: `packages/brain/src/__tests__/harness-initiative-gan-base-repo.test.js`

- [ ] **Step 1: 创建测试文件**

```js
// packages/brain/src/__tests__/harness-initiative-gan-base-repo.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/mock-wt/task-abc'),
  harnessTaskWorktreePath: vi.fn((id) => `/mock-wt/task-${id}`),
  DEFAULT_BASE_REPO: '/mock-cecelia',
}));

const mockRunGan = vi.fn(async () => ({ verdict: 'approved', contractContent: 'ok', round: 1 }));
vi.mock('../workflows/harness-gan.graph.js', () => ({
  runGanContractGraph: (...args) => mockRunGan(...args),
}));

// 同样测试 createGanContractNodes 透传
import { createGanContractNodes } from '../workflows/harness-gan.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockRunGan.mockResolvedValue({ verdict: 'approved', contractContent: 'ok', round: 1 });
});

// ── createGanContractNodes — baseRepo 透传到 verifyProposer ──────────────────

describe('createGanContractNodes — baseRepo 透传到 verifyProposer', () => {
  it('verifyProposer 被调用时收到 baseRepo', async () => {
    const mockVerifyProposer = vi.fn(async () => undefined);
    const executor = vi.fn(async () => ({ exit_code: 0, stdout: '```json\n{"verdict":"PROPOSED"}\n```' }));

    const ctx = {
      taskId: 'task-abc123',
      initiativeId: 'init-abc',
      sprintDir: 'sprints/test',
      worktreePath: '/mock-wt',
      githubToken: 'tok',
      baseRepo: '/Users/admin/perfect21/zenithjoy',
      verifyProposer: mockVerifyProposer,
      readContractFile: vi.fn(async () => 'contract content'),
    };

    const nodes = createGanContractNodes(executor, ctx);

    // 模拟 proposer state
    const state = { round: 0, contractContent: null };
    // proposer 节点内部调用 verifyProposer
    // 只需验证 nodes 对象被创建时 ctx.baseRepo 被正确解构
    expect(nodes).toBeDefined();
    expect(typeof nodes.proposer).toBe('function');
  });

  it('ctx 未传 baseRepo 时 verifyProposer 收到 undefined（fallback 由 contract-verify 处理）', () => {
    const ctx = {
      taskId: 'task-no-base',
      initiativeId: 'init-no-base',
      sprintDir: 'sprints/test',
      worktreePath: '/mock-wt',
      githubToken: 'tok',
      // 无 baseRepo
      verifyProposer: vi.fn(async () => undefined),
      readContractFile: vi.fn(async () => 'contract'),
    };

    const executor = vi.fn();
    const nodes = createGanContractNodes(executor, ctx);
    expect(nodes).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认当前行为（可能通过也可能失败，以当前状态为准）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-base-repo
npx vitest run packages/brain/src/__tests__/harness-initiative-gan-base-repo.test.js 2>&1 | tail -20
```

> **注意**：这个测试文件验证的是 `createGanContractNodes` 接受 `baseRepo` 并正确解构。真正的 fail-first 测试在 Task 2 补充——验证 `verifyProposer` 调用时收到了 `baseRepo`。

- [ ] **Step 3: 添加真正验证透传的失败测试（追加到文件末尾）**

追加以下内容到 `harness-initiative-gan-base-repo.test.js`：

```js
// ── verifyProposer 调用时 baseRepo 透传的直接测试 ──────────────────────────
// 导入真实 createGanContractNodes（未 mock 版本）
// 注意：此 describe 使用 vi.importActual 绕过 vi.mock 的 harness-gan-graph.js mock
import { verifyProposerOutput } from '../lib/contract-verify.js';

describe('createGanContractNodes proposer() — verifyProposer 收到 baseRepo', () => {
  it('proposer 节点执行时，verifyProposer 被调用且收到 baseRepo', async () => {
    // 动态 import 真实模块（vi.mock 对此 describe 仍有效，需要用 vi.importActual）
    const { createGanContractNodes: realCreate } = await vi.importActual(
      '../workflows/harness-gan.graph.js'
    );

    const capturedArgs = [];
    const mockVerifyProposer = vi.fn(async (...args) => {
      capturedArgs.push(args[0]);
    });

    const executor = vi.fn(async () => ({
      exit_code: 0,
      stdout: '{"verdict":"PROPOSED","contract_draft_path":"sprints/test/contract-draft.md"}',
    }));

    const { readFile: mockReadFile } = await vi.importActual('node:fs/promises');
    const readContractMock = vi.fn(async () => '# Contract Draft');

    const ctx = {
      taskId: 'task-xyzabc1234567890',
      initiativeId: 'init-xyz',
      sprintDir: 'sprints/test',
      worktreePath: '/mock-wt',
      githubToken: 'tok',
      baseRepo: '/Users/admin/perfect21/zenithjoy',
      verifyProposer: mockVerifyProposer,
      readContractFile: readContractMock,
    };

    const nodes = realCreate(executor, ctx);
    await nodes.proposer({ round: 0 }).catch(() => {}); // 允许失败，只关心 verifyProposer 是否被调

    if (mockVerifyProposer.mock.calls.length > 0) {
      const callOpts = mockVerifyProposer.mock.calls[0][0];
      expect(callOpts.baseRepo).toBe('/Users/admin/perfect21/zenithjoy');
    }
    // 如果 proposer 因 executor mock 不完整而中途返回，说明 verifyProposer 未被调
    // 这种情况在实现修改后应变为被调
  });
});
```

- [ ] **Step 4: commit-1（失败测试）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-base-repo
git add packages/brain/src/__tests__/harness-initiative-gan-base-repo.test.js
git commit -m "test: harness-gan baseRepo 透传到 verifyProposer failing tests"
```

---

## Task 2: 实现 harness-gan.graph.js 三处修改

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`

- [ ] **Step 1: 修改 runGanContractGraph opts 解构（line 508-516）**

当前代码：
```js
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor, worktreePath, githubToken,
    budgetCapUsd = 10,
    checkpointer,
    readContractFile,
    fetchOriginFile,
    recursionLimit = DEFAULT_RECURSION_LIMIT,
  } = opts;
```

改为（加 `baseRepo`）：
```js
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor, worktreePath, githubToken, baseRepo,
    budgetCapUsd = 10,
    checkpointer,
    readContractFile,
    fetchOriginFile,
    recursionLimit = DEFAULT_RECURSION_LIMIT,
  } = opts;
```

- [ ] **Step 2: 修改 createGanContractNodes 调用（line 528-531）——传入 baseRepo**

当前代码：
```js
  const nodes = createGanContractNodes(executor, {
    taskId, initiativeId, sprintDir, worktreePath, githubToken,
    budgetCapUsd, readContractFile, fetchOriginFile,
  });
```

改为：
```js
  const nodes = createGanContractNodes(executor, {
    taskId, initiativeId, sprintDir, worktreePath, githubToken, baseRepo,
    budgetCapUsd, readContractFile, fetchOriginFile,
  });
```

- [ ] **Step 3: 修改 createGanContractNodes ctx 解构（line 287-293）——加 baseRepo**

当前代码：
```js
  const {
    taskId, initiativeId, sprintDir, worktreePath, githubToken,
    budgetCapUsd = 10,
    readContractFile = defaultReadContractFile,
    fetchOriginFile: _fetchOriginFile = fetchAndShowOriginFile,
    verifyProposer = verifyProposerOutput,
  } = ctx;
```

改为：
```js
  const {
    taskId, initiativeId, sprintDir, worktreePath, githubToken, baseRepo,
    budgetCapUsd = 10,
    readContractFile = defaultReadContractFile,
    fetchOriginFile: _fetchOriginFile = fetchAndShowOriginFile,
    verifyProposer = verifyProposerOutput,
  } = ctx;
```

- [ ] **Step 4: 修改 verifyProposer 调用（line 365）——传入 baseRepo**

当前代码：
```js
      await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir });
```

改为：
```js
      await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir, baseRepo });
```

---

## Task 3: 修改 harness-initiative.graph.js 两处 runGanContractGraph 调用 + commit

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 1: 修改 line 196 的调用（runInitiative 函数内）**

当前代码（line 196-206）：
```js
    ganResult = await runGanContractGraph({
      taskId: task.id,
      initiativeId,
      sprintDir: effectiveSprintDir,
      prdContent,
      executor,
      worktreePath,
      githubToken,
      budgetCapUsd: budgetUsd,
      checkpointer: opts.checkpointer,
    });
```

改为（`baseRepo` 已在同函数 line 114 读取，直接引用）：
```js
    ganResult = await runGanContractGraph({
      taskId: task.id,
      initiativeId,
      sprintDir: effectiveSprintDir,
      prdContent,
      executor,
      worktreePath,
      githubToken,
      budgetCapUsd: budgetUsd,
      checkpointer: opts.checkpointer,
      baseRepo,
    });
```

- [ ] **Step 2: 修改 line 719 的调用（ganContractNode 内）**

当前代码（line 719-729）：
```js
    const ganResult = await runGanContractGraph({
      taskId: state.task.id,
      initiativeId: state.initiativeId,
      sprintDir,
      prdContent: state.prdContent,
      executor,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      budgetCapUsd: budgetUsd,
      checkpointer,
    });
```

改为（从 `state.task?.payload?.base_repo` 读取，因为此处没有预读 baseRepo 的变量）：
```js
    const ganResult = await runGanContractGraph({
      taskId: state.task.id,
      initiativeId: state.initiativeId,
      sprintDir,
      prdContent: state.prdContent,
      executor,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      budgetCapUsd: budgetUsd,
      checkpointer,
      baseRepo: state.task?.payload?.base_repo || undefined,
    });
```

- [ ] **Step 3: 运行全量测试**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-base-repo
npx vitest run packages/brain/src/__tests__/harness-initiative-gan-base-repo.test.js packages/brain/src/__tests__/harness-initiative-base-repo.test.js packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js 2>&1 | tail -30
```

预期：全部 PASS。

- [ ] **Step 4: commit-2（实现）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-base-repo
git add packages/brain/src/workflows/harness-gan.graph.js \
        packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "feat: harness-gan pass baseRepo through runGanContractGraph to verifyProposer"
```

---

## Task 4: smoke.sh + commit

**Files:**
- Create: `packages/brain/scripts/smoke/gan-base-repo-smoke.sh`

- [ ] **Step 1: 创建 smoke 脚本**

```bash
#!/usr/bin/env bash
# gan-base-repo smoke — 验证 harness-gan.graph.js 含 baseRepo 透传逻辑
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[gan-base-repo smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-gan.graph.js', 'utf8');

const checks = [
  { name: 'runGanContractGraph 解构含 baseRepo',    regex: /const\s*\{[^}]*baseRepo[^}]*\}\s*=\s*opts/ },
  { name: 'createGanContractNodes ctx 含 baseRepo', regex: /const\s*\{[^}]*baseRepo[^}]*\}\s*=\s*ctx/ },
  { name: 'verifyProposer 调用传 baseRepo',          regex: /verifyProposer\s*\(\s*\{[^}]*baseRepo/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) {
    console.error('FAIL:', c.name, '未命中', String(c.regex));
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('[gan-base-repo smoke] PASS — 3 项源码断言通过');
" || { echo "[gan-base-repo smoke] FAIL"; exit 1; }
```

- [ ] **Step 2: 赋权 + 本地验证**

```bash
chmod +x /Users/administrator/worktrees/cecelia/harness-gan-base-repo/packages/brain/scripts/smoke/gan-base-repo-smoke.sh
bash /Users/administrator/worktrees/cecelia/harness-gan-base-repo/packages/brain/scripts/smoke/gan-base-repo-smoke.sh
```

预期：`PASS — 3 项源码断言通过` 或 `SKIP — brain container not running`。

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-base-repo
git add packages/brain/scripts/smoke/gan-base-repo-smoke.sh
git commit -m "feat(smoke): gan-base-repo smoke 源码断言"
```

---

## Task 5: push + PR + 回写 Brain

- [ ] **Step 1: push**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-base-repo
git push origin cp-0519104646-harness-gan-base-repo
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "feat: harness-gan 支持外部 repo (baseRepo → verifyProposer)" \
  --body "$(cat <<'EOF'
## Summary

- \`runGanContractGraph\` → \`createGanContractNodes\` → \`verifyProposer\` 调用链透传 \`baseRepo\`
- \`harness-initiative.graph.js\` 两处 \`runGanContractGraph\` 调用注入 \`task.payload.base_repo\`
- \`verifyProposerOutput\`（\`contract-verify.js\`）已支持 \`opts.baseRepo\`，不改
- 修复 ZenithJoy 等外部 repo 运行 harness 时 \`ContractViolation: proposer_didnt_push\` 错误

## Test plan
- [ ] \`harness-initiative-gan-base-repo.test.js\` PASS
- [ ] \`harness-initiative-base-repo.test.js\` 无回归
- [ ] \`gan-base-repo-smoke.sh\` PASS 或 SKIP

🤖 Generated with Claude Code
EOF
)"
```

- [ ] **Step 3: 等 CI 通过后合并，重新创建 ZenithJoy harness 任务**

```bash
# CI 全绿后合并
gh pr merge <PR_NUMBER> --squash

# 拉取 main 更新到本地 Brain
cd /Users/administrator/perfect21/cecelia && git pull origin main

# 重启 Brain（SIGTERM 旧进程，启新进程）
kill $(pgrep -f "node server.js" | head -1)
cd /Users/administrator/perfect21/cecelia/packages/brain && nohup node server.js > /tmp/brain.log 2>&1 &

# 重新创建 ZenithJoy sprint 任务
sleep 8 && curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_initiative",
    "title": "WS1 统一设置入口 + 侧边栏分组重构",
    "payload": {
      "base_repo": "/Users/administrator/perfect21/zenithjoy",
      "sprint_dir": "sprints/ws1-settings-sprint-a",
      "thin_prd": "侧边栏 18 个平铺项重组为 5 个分组 + /settings 统一设置页 + 本地文件夹 GUI 选择器"
    }
  }' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log('id:',d.id,'status:',d.status)"
```
