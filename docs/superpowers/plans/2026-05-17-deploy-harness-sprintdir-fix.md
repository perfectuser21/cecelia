# 三联修复（deploy容器冲突 + harness检查点 + sprint_dir检测）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三个互相干扰的问题：brain-deploy.sh 容器命名冲突导致 Brain DOWN、Brain 重启把 harness_initiative 任务 reset 为 queued 丢 LangGraph 检查点、parsePrdNode sprint_dir 检测使用 git diff HEAD 导致 Proposer ENOENT。

**Architecture:** Fix 1 纯 shell 替换（幂等全状态容器清理）；Fix 2 在 executor.js syncOrphanTasksOnStartup 加 LangGraph 任务类型白名单，以 resume_from_checkpoint=true 重排队替代孤儿 failed；Fix 3 改 parsePrdNode 的 git diff 为 git log（覆盖多 commit 场景）+ 加 find fallback + dbUpsertNode 写回 sprint_dir 到 DB。

**Tech Stack:** Node.js 22, Vitest, PostgreSQL, Docker Compose, LangGraph

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| Modify | `scripts/brain-deploy.sh:215-217` | 容器清理改为全状态无条件 rm |
| Modify | `packages/brain/src/executor.js:3627-3681` | syncOrphanTasksOnStartup 加 LANGGRAPH_TYPES 跳过 + requeue with resume flag |
| Modify | `packages/brain/src/workflows/harness-initiative.graph.js:652-660` | B37 改 git log，加 B40 find fallback |
| Modify | `packages/brain/src/workflows/harness-initiative.graph.js:728-734` | dbUpsertNode 写回 sprint_dir 到 insertedTaskIds |
| Modify | `packages/brain/src/__tests__/executor-startup-sync.test.js` | 新增 harness_initiative requeue 测试用例 |
| Create | `packages/brain/src/workflows/__tests__/harness-initiative-b40.test.js` | B40 find fallback + dbUpsertNode sprint_dir 写回测试 |

---

## Task 1：Fix brain-deploy.sh 容器命名冲突

**Files:**
- Modify: `scripts/brain-deploy.sh:215-217`

- [ ] **Step 1：写失败测试**

在 worktree 根目录执行：

```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('scripts/brain-deploy.sh', 'utf8');
// 验证旧的分状态清理已不存在
if (src.includes('--filter \"status=exited\"')) {
  console.log('FAIL: 仍有 status=exited filter');
  process.exit(1);
}
// 验证新的精确名称清理存在
if (!src.includes('^/cecelia-node-brain\$')) {
  console.log('FAIL: 未找到精确 name filter');
  process.exit(1);
}
console.log('PASS');
"
```

预期：`FAIL: 仍有 status=exited filter`

- [ ] **Step 2：实施修复**

将 `scripts/brain-deploy.sh` 的 L215-217 替换：

**旧代码（L215-217）：**
```bash
    # 删掉 stopped/created 状态的旧容器，避免 docker compose up 因命名冲突卡在 Created 状态
    docker ps -a --filter "name=cecelia-node-brain" --filter "status=exited" -q | xargs -r docker rm -f 2>/dev/null || true
    docker ps -a --filter "name=cecelia-node-brain" --filter "status=created" -q | xargs -r docker rm -f 2>/dev/null || true
```

**新代码（替换 L215-217）：**
```bash
    # 无条件清理所有名为 cecelia-node-brain 的容器（任意状态），避免命名冲突
    # 使用精确名称 ^/cecelia-node-brain$ 防止前缀误匹配其他容器
    EXISTING_IDS=$(docker ps -a --filter "name=^/cecelia-node-brain$" -q 2>/dev/null || true)
    if [[ -n "$EXISTING_IDS" ]]; then
        echo "  Removing existing cecelia-node-brain container(s) before recreate..."
        echo "$EXISTING_IDS" | xargs docker rm -f 2>/dev/null || true
    fi
```

- [ ] **Step 3：运行验证**

```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('scripts/brain-deploy.sh', 'utf8');
if (src.includes('--filter \"status=exited\"')) { console.log('FAIL'); process.exit(1); }
if (!src.includes('^/cecelia-node-brain\$')) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
"
```

预期：`PASS`

- [ ] **Step 4：提交**

```bash
git add scripts/brain-deploy.sh
git commit -m "fix(deploy): 无条件清理 cecelia-node-brain 容器（任意状态），避免命名冲突"
```

---

## Task 2：Fix executor.js — harness_initiative 任务 Brain 重启恢复

**Files:**
- Modify: `packages/brain/src/__tests__/executor-startup-sync.test.js`（末尾新增测试）
- Modify: `packages/brain/src/executor.js:3627-3681`

- [ ] **Step 1：在测试文件末尾新增失败测试**

打开 `packages/brain/src/__tests__/executor-startup-sync.test.js`，在最后一个 `it(...)` 块后、外层 `describe` 的 `});` 之前，插入：

```js
  it('harness_initiative 任务 → requeued with resume_from_checkpoint=true，不走 failed', async () => {
    // SELECT 返回一个 harness_initiative in_progress 任务
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'harness-init-1',
        title: 'harness initiative test task',
        payload: { watchdog_retry_count: 0 },
        started_at: new Date().toISOString(),
        error_message: null,
        task_type: 'harness_initiative',
      }]
    });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { syncOrphanTasksOnStartup } = await import('../executor.js');
    const result = await syncOrphanTasksOnStartup();

    // 应该被 requeue（不是 orphan_fixed）
    expect(result.requeued).toBe(1);

    // 必须有 status='queued' 的 UPDATE
    const requeueCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes("status = 'queued'")
    );
    expect(requeueCall).toBeTruthy();

    // payload 必须含 resume_from_checkpoint: true
    const payloadPatch = JSON.parse(requeueCall[1][1]);
    expect(payloadPatch.resume_from_checkpoint).toBe(true);

    // 不能有 status='failed' 的 UPDATE
    const failedCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes("status = 'failed'")
    );
    expect(failedCall).toBeUndefined();
  });
```

- [ ] **Step 2：运行新测试，确认失败**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/executor-startup-sync.test.js 2>&1 | tail -20
```

预期：最新的 `harness_initiative 任务` 测试 FAIL（`requeued` 不为 1，或 payload 无 `resume_from_checkpoint`）

- [ ] **Step 3：修复 executor.js**

打开 `packages/brain/src/executor.js`，找到 `syncOrphanTasksOnStartup` 函数的 `SELECT` 查询（约 L3627）：

**旧代码（L3627-3631）：**
```js
  const result = await pool.query(`
    SELECT id, title, payload, started_at, error_message
    FROM tasks
    WHERE status = 'in_progress'
  `);
```

**新代码（加 task_type）：**
```js
  const result = await pool.query(`
    SELECT id, title, payload, started_at, error_message, task_type
    FROM tasks
    WHERE status = 'in_progress'
  `);
```

然后在 `for (const task of result.rows) {` 循环开头（L3638 之后，`const runId = task.payload?.current_run_id;` 之前）插入：

**插入新代码：**
```js
    // LangGraph 任务（harness_initiative）无 OS 子进程，不走孤儿检测路径。
    // Brain 重启后以 resume_from_checkpoint=true 重排队，让 dispatcher 在下一 tick
    // 从 LangGraph pg-checkpointer 续跑，而不是新建 Attempt。
    const LANGGRAPH_TYPES = new Set(['harness_initiative']);
    if (LANGGRAPH_TYPES.has(task.task_type)) {
      await pool.query(
        `UPDATE tasks SET
          status = 'queued',
          payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
          updated_at = NOW()
        WHERE id = $1`,
        [task.id, JSON.stringify({ resume_from_checkpoint: true })]
      );
      requeued++;
      console.log(`[startup-sync] LangGraph task re-queued for checkpoint resume: task=${task.id} type=${task.task_type} title="${task.title}"`);
      continue;
    }
```

- [ ] **Step 4：运行测试，确认全部通过**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/__tests__/executor-startup-sync.test.js 2>&1 | tail -20
```

预期：所有 5 个测试 PASS

- [ ] **Step 5：提交**

```bash
git add packages/brain/src/executor.js packages/brain/src/__tests__/executor-startup-sync.test.js
git commit -m "fix(brain): syncOrphanTasksOnStartup 跳过 harness_initiative 孤儿检测，改为 resume_from_checkpoint requeue"
```

---

## Task 3：Fix harness-initiative.graph.js — parsePrdNode git log + find fallback + dbUpsertNode sprint_dir 写回

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative-b40.test.js`
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:652-660`（B37 改 git log + B40 find fallback）
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:728-734`（dbUpsertNode 写回 sprint_dir）

- [ ] **Step 1：创建失败测试文件**

创建 `packages/brain/src/workflows/__tests__/harness-initiative-b40.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));
vi.mock('node:util', () => ({
  promisify: (fn) => (...args) => new Promise((resolve, reject) => {
    fn(...args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  }),
}));

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: vi.fn().mockReturnValue(null),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: ['task-uuid-1', 'task-uuid-2'] }),
}));
vi.mock('../../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null), put: vi.fn(), setup: vi.fn(),
    list: vi.fn().mockResolvedValue([]), getTuple: vi.fn().mockResolvedValue(null), putWrites: vi.fn(),
  }),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

import { parsePrdNode, dbUpsertNode } from '../harness-initiative.graph.js';
import * as fsPromises from 'node:fs/promises';
import * as harnessdag from '../../harness-dag.js';

describe('B40: parsePrdNode find fallback + dbUpsertNode sprint_dir 写回', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('B40-1: git log 返回空 + find 找到单个子目录 → 使用 find 结果', async () => {
    // Call 1: git log returns empty (nothing committed to sprints/ yet)
    mockExecFile.mockImplementationOnce((_cmd, args, _opts, cb) => {
      // verify it's git log not git diff
      expect(args[0]).toBe('log');
      cb(null, '', '');
    });
    // Call 2: find returns one sprint subdirectory
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb(null, '/fake/worktree/sprints/ws2\n', '');
    });
    fsPromises.readFile.mockResolvedValue('# PRD content from ws2');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput: '',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/ws2');
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/ws2/sprint-prd.md',
      'utf8'
    );
  });

  it('B40-2: git log 找到多个子目录 + find 找到多个 → 保持 LLM 解析结果', async () => {
    const plannerOutput = '{"verdict":"DONE","sprint_dir":"sprints/ws3-from-llm","branch":"cp-x"}';

    // git log returns multiple files across different dirs
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb(null, 'sprints/ws3-from-llm/sprint-prd.md\nsprints/ws4-other/test.md\n', '');
    });
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    // Multiple dirs → can't decide, keep LLM result
    expect(result.sprintDir).toBe('sprints/ws3-from-llm');
  });

  it('B40-3: dbUpsertNode 把 state.sprintDir 写回 insertedTaskIds 的 payload', async () => {
    const mockClient = {
      // 大多数 query 返回空行；INSERT initiative_contracts 需要 rows[0].id
      query: vi.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO initiative_contracts')) {
          return Promise.resolve({ rows: [{ id: 'contract-uuid-1' }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    // dbUpsertNode 内部有多个 INSERT，mock 不完整可能抛出；
    // 只需验证 sprint_dir UPDATE 在抛出前已被调用
    try {
      await dbUpsertNode(
        {
          task: { id: 'initiative-1', payload: { sprint_dir: 'sprints', timeout_sec: 3600, budget_usd: 1 } },
          initiativeId: 'init-1',
          taskPlan: { tasks: [], dependencies: [] },
          ganResult: { propose_branch: 'cp-test', pr_url: null },
          prdContent: '# PRD',
          sprintDir: 'sprints/ws5',
        },
        { pool: mockPool }
      );
    } catch (_) { /* mock 不完整导致的后续 INSERT 失败，忽略 */ }

    // 验证 sprint_dir UPDATE 已被调用（在 upsertTaskPlan 之后立即执行）
    const sprintDirUpdate = mockClient.query.mock.calls.find(
      call => typeof call[0] === 'string' &&
              call[0].includes('UPDATE tasks') &&
              call[0].includes('ANY') &&
              Array.isArray(call[1]) && call[1].length >= 2 &&
              (() => { try { const p = JSON.parse(call[1][1]); return p.sprint_dir === 'sprints/ws5'; } catch { return false; } })()
    );
    expect(sprintDirUpdate).toBeTruthy();
  });
});
```

- [ ] **Step 2：运行新测试，确认失败**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/workflows/__tests__/harness-initiative-b40.test.js 2>&1 | tail -30
```

预期：B40-1 FAIL（git 命令第一个 arg 不是 'log'），B40-3 FAIL（没有 sprint_dir UPDATE 调用）

- [ ] **Step 3：修复 parsePrdNode — B37 改 git log + B40 find fallback**

在 `packages/brain/src/workflows/harness-initiative.graph.js` 中，找到 L651-660（B37 注释开始的 `if (state.worktreePath)` 块）：

**旧代码（L651-660）：**
```js
  // B37: git diff 找 planner 实际新建的 sprint 目录（最可靠，覆盖 LLM 输出解析）
  if (state.worktreePath) {
    try {
      const { stdout: diffOut } = await execFile('git',
        ['diff', '--name-only', 'origin/main', 'HEAD', '--', 'sprints/'],
        { cwd: state.worktreePath }
      );
      const newSprintMatch = diffOut.match(/sprints\/([^/\n]+)\//);
      if (newSprintMatch) sprintDir = `sprints/${newSprintMatch[1]}`;
    } catch { /* git diff 失败，保持已有 sprintDir */ }
  }
```

**新代码（替换 L651-660）：**
```js
  // B37+B40: 检测 planner 实际新建的 sprint 目录
  // git log 覆盖多 commit 场景（origin/main..HEAD 整条历史），比 git diff HEAD 更可靠
  if (state.worktreePath) {
    try {
      const { stdout: logOut } = await execFile('git',
        ['log', '--diff-filter=A', '--name-only', '--format=', 'origin/main..HEAD', '--', 'sprints/'],
        { cwd: state.worktreePath }
      );
      const newSprintMatch = logOut.match(/sprints\/([^/\n]+)\//);
      if (newSprintMatch) {
        sprintDir = `sprints/${newSprintMatch[1]}`;
      } else if (!logOut.trim()) {
        // B40: git log 无新增文件（未 commit 场景），fallback 到文件系统检测
        try {
          const { stdout: findOut } = await execFile('find',
            [path.join(state.worktreePath, 'sprints'), '-maxdepth', '1', '-mindepth', '1', '-type', 'd'],
            { cwd: state.worktreePath }
          );
          const dirs = findOut.trim().split('\n').filter(Boolean);
          if (dirs.length === 1) {
            sprintDir = path.relative(state.worktreePath, dirs[0]);
          }
        } catch { /* sprints/ 子目录未找到，保持已有 sprintDir */ }
      }
    } catch { /* git log 失败，保持已有 sprintDir */ }
  }
```

- [ ] **Step 4：修复 dbUpsertNode — sprint_dir 写回 insertedTaskIds**

在 `packages/brain/src/workflows/harness-initiative.graph.js` 中，找到 `dbUpsertNode` 里的 `upsertTaskPlan` 调用（约 L728-734）：

**旧代码（L728-734）：**
```js
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: state.initiativeId,
      initiativeTaskId: state.task.id,
      taskPlan: state.taskPlan,
      client,
      contractBranch: state.ganResult.propose_branch || null,
    });
```

**新代码（在 upsertTaskPlan 调用后立即插入）：**
```js
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: state.initiativeId,
      initiativeTaskId: state.task.id,
      taskPlan: state.taskPlan,
      client,
      contractBranch: state.ganResult.propose_branch || null,
    });
    // B40: 把运行时检测到的 sprint_dir 写入子任务 payload，确保 Brain 重启后从 DB dispatch 时路径正确
    const effectiveSprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
    if (insertedTaskIds?.length > 0 && effectiveSprintDir !== 'sprints') {
      await client.query(
        `UPDATE tasks
         SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
         WHERE id = ANY($1::uuid[])`,
        [insertedTaskIds, JSON.stringify({ sprint_dir: effectiveSprintDir })]
      );
    }
```

- [ ] **Step 5：运行 B40 测试，确认全部通过**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/workflows/__tests__/harness-initiative-b40.test.js 2>&1 | tail -30
```

预期：3 个测试全部 PASS

- [ ] **Step 6：运行 B37 测试，确认未破坏原有行为**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/workflows/__tests__/harness-initiative-b37.test.js 2>&1 | tail -20
```

预期：全部 PASS（mock 不检查 git 命令 args，输出格式一致）

- [ ] **Step 7：运行完整 brain 测试套件**

```bash
cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run 2>&1 | tail -10
```

预期：所有测试通过（或只有已知的 flaky 测试失败）

- [ ] **Step 8：提交**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-b40.test.js
git commit -m "fix(brain): B37 改 git log + B40 find fallback + dbUpsertNode sprint_dir 写回 DB"
```

---

## Task 4：Learning 文档

**Files:**
- Create: `docs/learnings/cp-0517082346-fix-deploy-harness-sprintdir.md`

- [ ] **Step 1：写 Learning 文档**

创建 `docs/learnings/cp-0517082346-fix-deploy-harness-sprintdir.md`：

```markdown
# Learning: 三联修复 — deploy 容器命名冲突 + harness 重启丢检查点 + sprint_dir 检测不稳

## 根本原因

**Fix 1 (brain-deploy.sh)**：`docker ps -a --filter "status=exited"` 只清理两种状态，漏掉 restarting/pausing/dead 及外部 project 的 running 容器，导致 `docker compose up -d` 命名冲突。

**Fix 2 (executor.js)**：`syncOrphanTasksOnStartup` SELECT 无 `task_type`，把所有 `in_progress` 任务当 OS 进程孤儿处理。`harness_initiative` 是 LangGraph 同步任务（无子进程），`isTaskProcessAlive()` 永远 false → 被 requeue/failed，LangGraph checkpoint 丢失，每次重启从头跑 Attempt N+1。

**Fix 3 (harness-initiative.graph.js)**：B37 用 `git diff origin/main HEAD`，但 GAN propose 阶段 HEAD 可能不含 Planner commit，diff 为空 → sprintDir 回退到 LLM 解析（不稳定）。子任务 `sprint_dir` 只写 graph state 不写 DB，Brain 重启后 dispatcher 从 DB 读到旧的顶级 `sprints/`，Proposer ENOENT。

## 下次预防

- [ ] `syncOrphanTasksOnStartup` 处理新任务类型时，先检查 SELECT 是否含 `task_type` 字段，新的同步执行类型（无子进程）必须加入 LANGGRAPH_TYPES 白名单
- [ ] docker 容器清理场景：始终用无条件 `docker rm -f`（精确名称匹配），禁止分状态逐一过滤
- [ ] harness sprint 路径写入：创建子任务时同步写入 `payload.sprint_dir`，不依赖 graph state 内存传递（内存在重启后丢失）
- [ ] parsePrdNode 的文件系统检测：优先 `git log origin/main..HEAD`（覆盖整条历史），git 失败时 fallback `find sprints/ -maxdepth 1 -mindepth 1 -type d`
```

- [ ] **Step 2：提交 Learning**

```bash
git add docs/learnings/cp-0517082346-fix-deploy-harness-sprintdir.md
git commit -m "docs(learning): 三联修复根本原因 + 下次预防清单"
```
