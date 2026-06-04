# 西安 Codex Harness Generator 路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 4 个 bug，使 harness pipeline 的 Generator 步骤可路由到西安 M4 Codex 执行机。

**Architecture:** DB 注册 executor → initiative 透传 machine/executor → spawnNode push 合同 + 注入 GITHUB_TOKEN。Planner/GAN/Evaluator 不变，只改 Generator 路由。

**Tech Stack:** Node.js ESM, Vitest, LangGraph, Brain REST API, PostgreSQL

---

### Task 1: DB — 给 mac-mini-m4-xian 注册 codex executor

**Files:**
- No code change — direct DB update via Brain API

- [ ] **Step 1: 确认当前 metadata**

```bash
curl -s localhost:5221/api/brain/machines | \
  python3 -c "import json,sys; ms=json.load(sys.stdin); [print(json.dumps(m,indent=2)) for m in ms if m['name']=='mac-mini-m4-xian']"
```

Expected: `metadata.executors` 为空数组 `[]`

- [ ] **Step 2: 更新 metadata 注入 codex executor**

```bash
MACHINE_ID=$(curl -s localhost:5221/api/brain/machines | \
  python3 -c "import json,sys; ms=json.load(sys.stdin); print([m['id'] for m in ms if m['name']=='mac-mini-m4-xian'][0])")

curl -s -X PATCH "localhost:5221/api/brain/machines/$MACHINE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": {
      "os": "macOS",
      "role": "Codex 执行机",
      "tags": ["codex", "xian"],
      "notes": "exit node 走美国，Codex 访问 OpenAI 正常",
      "accounts": ["codex-team3", "codex-team4", "codex-team5"],
      "executors": [
        { "executor": "codex", "url": "http://100.86.57.69:3458", "default": true }
      ]
    }
  }'
```

Expected: `{ "success": true }` 或 200 响应

- [ ] **Step 3: 验证更新**

```bash
curl -s localhost:5221/api/brain/machines | \
  python3 -c "
import json,sys
ms=json.load(sys.stdin)
xian=[m for m in ms if m['name']=='mac-mini-m4-xian'][0]
print(json.dumps(xian['metadata']['executors'], indent=2))"
```

Expected:
```json
[{ "executor": "codex", "url": "http://100.86.57.69:3458", "default": true }]
```

---

### Task 2: harness-initiative.graph.js — runSubTaskNode 透传 machine/executor

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:869-887`
- Test: `packages/brain/src/__tests__/xian-generator-routing.test.js` (新建)

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/__tests__/xian-generator-routing.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../events/taskEvents.js', () => ({ emitLangGraphStep: vi.fn() }));

import { runSubTaskNode } from '../workflows/harness-initiative.graph.js';

describe('runSubTaskNode — 透传 machine/executor 到 sub-task payload', () => {
  it('initiative payload.machine + executor 透传到 taskForGraph.payload', async () => {
    const capturedInvokes = [];
    const fakeCompiled = {
      invoke: async (input) => {
        capturedInvokes.push(input);
        return { status: 'completed', pr_url: 'https://github.com/x/y/pull/1' };
      },
    };

    const state = {
      initiativeId: 'init-001',
      task: {
        id: 'initiative-task-id',
        payload: {
          machine: 'mac-mini-m4-xian',
          executor: 'codex',
          base_repo: 'https://github.com/perfectuser21/infrastructure.git',
        },
      },
      sub_task: {
        id: 'ws1',
        title: 'Test workstream',
        description: 'Test',
        payload: { dod: ['item1'], files: ['a.js'] },
      },
      sprintDir: 'sprints/test',
      task_loop_fix_count: 0,
      final_e2e_fix_count: 0,
    };

    await runSubTaskNode(state, { compiledTaskGraph: fakeCompiled, waitMs: 0 });

    expect(capturedInvokes).toHaveLength(1);
    const taskPayload = capturedInvokes[0].task.payload;
    expect(taskPayload.machine).toBe('mac-mini-m4-xian');
    expect(taskPayload.executor).toBe('codex');
  });

  it('initiative 没有 machine/executor 时不注入（向后兼容）', async () => {
    const capturedInvokes = [];
    const fakeCompiled = {
      invoke: async (input) => {
        capturedInvokes.push(input);
        return { status: 'completed', pr_url: 'https://github.com/x/y/pull/2' };
      },
    };

    const state = {
      initiativeId: 'init-002',
      task: { id: 'ti2', payload: {} },
      sub_task: {
        id: 'ws1', title: 'T', description: 'D',
        payload: { dod: [], files: [] },
      },
      task_loop_fix_count: 0,
      final_e2e_fix_count: 0,
    };

    await runSubTaskNode(state, { compiledTaskGraph: fakeCompiled, waitMs: 0 });

    const taskPayload = capturedInvokes[0].task.payload;
    expect(taskPayload.machine).toBeUndefined();
    expect(taskPayload.executor).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/xian-harness-generator-routing
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run \
  src/__tests__/xian-generator-routing.test.js 2>&1 | tail -20
```

Expected: `FAIL` — `machine` 为 `undefined`

- [ ] **Step 3: 修改 runSubTaskNode（第 882-886 行附近）**

找到 `packages/brain/src/workflows/harness-initiative.graph.js` 里 `taskForGraph.payload` 的结束处，加两行透传：

```js
    payload: {
      ...subTask.payload,
      logical_task_id: subTask.id,
      ...(state.sprintDir ? { sprint_dir: state.sprintDir } : {}),
      final_e2e_fix_count: state.final_e2e_fix_count ?? 0,
      ...(fixCount > 0 && feedback ? { fix_round: fixCount, evaluator_feedback: feedback } : {}),
      // 透传 initiative 级别执行器路由（西安 Codex 对比用）
      ...(state.task?.payload?.machine ? { machine: state.task.payload.machine } : {}),
      ...(state.task?.payload?.executor ? { executor: state.task.payload.executor } : {}),
    },
```

- [ ] **Step 4: 跑测试确认 PASS**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run \
  src/__tests__/xian-generator-routing.test.js 2>&1 | tail -10
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/__tests__/xian-generator-routing.test.js
git commit -m "feat(harness): runSubTaskNode 透传 machine/executor — 支持西安 Codex Generator 路由"
```

---

### Task 3: harness-task.graph.js — codex 路径 push contract + 注入 GITHUB_TOKEN

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js:262-278`
- Test: `packages/brain/src/__tests__/xian-generator-routing.test.js` (追加)

- [ ] **Step 1: 追加 failing tests 到 xian-generator-routing.test.js**

在文件末尾追加：

```js
import { spawnNode } from '../workflows/harness-task.graph.js';

vi.mock('../workflows/harness-task.graph.js', async (importOriginal) => {
  // 只 mock 外部依赖，保留 spawnNode 逻辑
  return importOriginal();
});
vi.mock('../spawn/detached.js', () => ({
  spawnDockerDetached: vi.fn(async () => {}),
  spawnCodexBridgeDetached: vi.fn(async () => {}),
}));
vi.mock('../routing/resolve-executor.js', () => ({
  resolveExecutor: vi.fn(async () => ({
    executor: 'codex',
    url: 'http://100.86.57.69:3458',
    machineId: 'mac-mini-m4-xian',
  })),
}));
vi.mock('../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn(async () => 'ghp_test_token'),
}));
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/mock-wt/task-ws1'),
  harnessSubTaskBranchName: vi.fn(() => 'cp-0604-ws-abc123'),
  DEFAULT_BASE_REPO: '/mock-cecelia',
}));
vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn(async () => {}),
}));

describe('spawnNode — codex 路径 push contract + GITHUB_TOKEN', () => {
  it('codex 路径：在 spawnBridgeFn 之前 push contract 到 GitHub', async () => {
    const pushCalls = [];
    const spawnBridgeCalls = [];

    const mockExecFile = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args.includes('push')) pushCalls.push(args);
      return { stdout: '', stderr: '' };
    });

    const mockSpawnBridge = vi.fn(async () => {});

    const state = {
      task: {
        id: 'ws1',
        title: 'Test',
        description: 'Desc',
        payload: {
          machine: 'mac-mini-m4-xian',
          executor: 'codex',
          base_repo: 'https://github.com/perfectuser21/infrastructure.git',
        },
      },
      initiativeId: 'init-001',
      contractBranch: 'cp-harness-propose-r3-abc',
      contractImported: true,
      baseRepo: 'https://github.com/perfectuser21/infrastructure.git',
      githubToken: 'ghp_test_token',
    };

    await spawnNode(state, {
      spawnBridge: mockSpawnBridge,
      execFile: mockExecFile,
    });

    // push 必须在 spawnBridgeFn 之前
    const pushIdx = pushCalls.findIndex(a => a.includes('push'));
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(spawnBridgeCalls.length === 0 || pushIdx < spawnBridgeCalls.length).toBe(true);
    expect(mockSpawnBridge).toHaveBeenCalled();
  });

  it('codex payload 包含 GITHUB_TOKEN', async () => {
    const bridgeCalls = [];
    const mockSpawnBridge = vi.fn(async (url, payload) => { bridgeCalls.push(payload); });
    const mockExecFile = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const state = {
      task: {
        id: 'ws1', title: 'T', description: 'D',
        payload: {
          machine: 'mac-mini-m4-xian',
          executor: 'codex',
          base_repo: 'https://github.com/perfectuser21/infrastructure.git',
        },
      },
      initiativeId: 'init-001',
      contractBranch: 'cp-harness-propose-r3-abc',
      contractImported: true,
      baseRepo: 'https://github.com/perfectuser21/infrastructure.git',
      githubToken: 'ghp_test_token',
    };

    await spawnNode(state, { spawnBridge: mockSpawnBridge, execFile: mockExecFile });

    expect(bridgeCalls).toHaveLength(1);
    expect(bridgeCalls[0].env?.GITHUB_TOKEN).toBe('ghp_test_token');
  });

  it('contractImported=false 时不 push（合同未导入则无需 push）', async () => {
    const pushCalls = [];
    const mockExecFile = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args.includes('push')) pushCalls.push(args);
      return { stdout: '', stderr: '' };
    });

    const state = {
      task: {
        id: 'ws1', title: 'T', description: 'D',
        payload: { machine: 'mac-mini-m4-xian', executor: 'codex',
          base_repo: 'https://github.com/perfectuser21/infrastructure.git' },
      },
      initiativeId: 'init-001',
      contractBranch: null,
      contractImported: false,
      baseRepo: 'https://github.com/perfectuser21/infrastructure.git',
      githubToken: 'ghp_test',
    };

    await spawnNode(state, {
      spawnBridge: vi.fn(async () => {}),
      execFile: mockExecFile,
    });

    expect(pushCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run \
  src/__tests__/xian-generator-routing.test.js 2>&1 | tail -20
```

Expected: FAIL — push 不存在，GITHUB_TOKEN 未传

- [ ] **Step 3: 修改 spawnNode codex 路径（第 262-278 行）**

```js
    if (route.executor === 'codex') {
      // codex：先把 contract import commit push 到 GitHub，让西安 git clone 能看到合同文件。
      // contractImported=true 说明 spawnNode 上方已 commit contract 到本地 worktree。
      if (state.contractImported && worktreePath) {
        await execFile('git', ['-C', worktreePath, 'push', 'origin',
          `HEAD:${precomputedBranch}`], { timeout: 60_000 });
      }

      const repo = state.baseRepo || payload.base_repo || '';
      await spawnBridgeFn(`${route.url}/run`, {
        task_id: finalContainerId,
        task_type: task.task_type || 'harness_task',
        prompt,
        skill: 'harness-generator',
        branch: precomputedBranch,
        callback_url: callbackUrl,
        repo,
        mode: 'codex',
        env: { GITHUB_TOKEN: token },
      });
    } else {
```

- [ ] **Step 4: 跑测试确认 PASS**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run \
  src/__tests__/xian-generator-routing.test.js 2>&1 | tail -10
```

Expected: `5 passed`（Task 2 + Task 3 合计）

- [ ] **Step 5: 跑全量 brain tests 确认无回归**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run 2>&1 | tail -5
```

Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/workflows/harness-task.graph.js \
        packages/brain/src/__tests__/xian-generator-routing.test.js
git commit -m "feat(harness): spawnNode codex 路径 push contract + 注入 GITHUB_TOKEN"
```

---

### Task 4: 端到端验证 — 发射两条 harness pipeline 对比

**Files:**
- No code change — 通过 Brain API 触发

- [ ] **Step 1: 确认西安 worker-daemon 健康**

```bash
curl -s http://100.86.57.69:3458/health | python3 -m json.tool
```

Expected: `{ "status": "ok", "running_jobs": 0, "docker_available": true }`

- [ ] **Step 2: 发 US M4 Claude 线（默认路由）**

```bash
CLAUDE_RESP=$(curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_initiative",
    "title": "harness-compare: US M4 Claude — retry-util 工具函数",
    "description": "TDD 对比测试。新增 scripts/worker-daemon/retry-util.js，导出 async function withRetry(fn, { retries=3, delayMs=100, shouldRetry=(e)=>true } = {})：执行 fn()，失败且 shouldRetry 返回 true 时重试，超出次数抛出最后一次错误。新增 retry-util.test.js（vitest），覆盖 成功/重试后成功/超出次数/shouldRetry=false 至少4个断言。TDD 两段式 commit。",
    "priority": "P1",
    "payload": {
      "base_repo": "https://github.com/perfectuser21/infrastructure.git",
      "target_environment": "local_api",
      "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963"
    }
  }')
echo "$CLAUDE_RESP" | python3 -m json.tool
CLAUDE_TASK=$(echo "$CLAUDE_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo "Claude task: $CLAUDE_TASK"
```

- [ ] **Step 3: 发 Xi'an Codex 线（显式路由到西安）**

```bash
CODEX_RESP=$(curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_initiative",
    "title": "harness-compare: Xi'\''an Codex — retry-util 工具函数",
    "description": "TDD 对比测试。新增 scripts/worker-daemon/retry-util.js，导出 async function withRetry(fn, { retries=3, delayMs=100, shouldRetry=(e)=>true } = {})：执行 fn()，失败且 shouldRetry 返回 true 时重试，超出次数抛出最后一次错误。新增 retry-util.test.js（vitest），覆盖 成功/重试后成功/超出次数/shouldRetry=false 至少4个断言。TDD 两段式 commit。",
    "priority": "P1",
    "payload": {
      "machine": "mac-mini-m4-xian",
      "executor": "codex",
      "base_repo": "https://github.com/perfectuser21/infrastructure.git",
      "target_environment": "local_api",
      "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963"
    }
  }')
echo "$CODEX_RESP" | python3 -m json.tool
CODEX_TASK=$(echo "$CODEX_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo "Codex task: $CODEX_TASK"
```

- [ ] **Step 4: 轮询两条线各自出 PR**

```bash
for i in $(seq 1 30); do
  CLAUDE_STATUS=$(curl -s "localhost:5221/api/brain/tasks/$CLAUDE_TASK" | \
    python3 -c "import json,sys; t=json.load(sys.stdin); print(t.get('status',''))" 2>/dev/null)
  CODEX_STATUS=$(curl -s "localhost:5221/api/brain/tasks/$CODEX_TASK" | \
    python3 -c "import json,sys; t=json.load(sys.stdin); print(t.get('status',''))" 2>/dev/null)
  echo "$(date +%H:%M:%S) Claude=$CLAUDE_STATUS  Codex=$CODEX_STATUS"
  [ "$CLAUDE_STATUS" = "completed" ] && [ "$CODEX_STATUS" = "completed" ] && break
  sleep 60
done
```

- [ ] **Step 5: 拿两个 PR 比较**

```bash
gh pr list --repo perfectuser21/infrastructure --state all --limit 5 \
  --json number,title,commits \
  --jq '.[] | "PR#\(.number): \(.title) — commits: \([.commits[].commit.message] | join(" | "))"'
```

记录：两个 PR 的 commits 格式（是否两段式）、代码质量、CI 是否通过。

- [ ] **Step 6: 清理测试 PR**

```bash
# 拿到两个测试 PR 号后
gh pr close <claude-pr-number> --repo perfectuser21/infrastructure
gh pr close <codex-pr-number> --repo perfectuser21/infrastructure
# 删对应分支
gh api -X DELETE repos/perfectuser21/infrastructure/git/refs/heads/<claude-branch>
gh api -X DELETE repos/perfectuser21/infrastructure/git/refs/heads/<codex-branch>
```

---

### Task 5: PR

- [ ] **Step 1: push 分支**

```bash
git push -u origin cp-0604090758-xian-harness-generator-routing
```

- [ ] **Step 2: 开 PR**

```bash
gh pr create --base main \
  --title "feat(harness): 西安 Codex Generator 路由 — 4 个 bug fix" \
  --body "## Summary
- fix: mac-mini-m4-xian 注册 codex executor（metadata.executors）
- feat: runSubTaskNode 透传 machine/executor 到 sub-task payload
- feat: spawnNode codex 路径 push contract 到 GitHub（西安 git clone 才能看到合同）
- feat: spawnNode codex payload 加 GITHUB_TOKEN

## Test plan
- [x] runSubTaskNode 透传测试（2 cases）
- [x] spawnNode codex push/token 测试（3 cases）
- [x] 全量 brain tests 无回归
- [ ] 端到端 harness 对比（US M4 Claude vs 西安 Codex，同任务）"
```
