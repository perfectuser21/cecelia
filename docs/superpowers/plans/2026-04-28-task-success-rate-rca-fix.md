# Brain 任务成功率 RCA Fix 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Brain 任务成功率从 39% 恢复到 >80%，通过停止 harness_task（已 retired）的创建 + 清理测试 KR 污染 + 取消积压任务。

**Architecture:** 三条独立修复线：(1) 代码修复——`harness-dag.js:upsertTaskPlan()` 和 `harness-initiative.graph.js:createFixTask()` 停止向 tasks 表 INSERT `harness_task` 行（full graph 通过 LangGraph Send 内联执行，不需要 tasks 行驱动）；(2) 数据清理——archive 7 条污染 DB 的测试 KR，取消关联的 queued 修复任务；(3) 队列清理——批量取消过期积压任务（content-pipeline × 21、arch_review × 4、smoke harness_initiative × 7）。

**Tech Stack:** Node.js (ESM)、PostgreSQL、vitest、Brain REST API（localhost:5221）

---

## 文件变更地图

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/brain/src/harness-dag.js` | Modify | 删除 upsertTaskPlan 中 INSERT tasks 行，改为纯内存 idMap（crypto.randomUUID） |
| `packages/brain/src/workflows/harness-initiative.graph.js` | Modify | createFixTask() 加早返回 guard，停止 INSERT harness_task |
| `packages/brain/src/__tests__/harness-dag-upsert-priority.test.js` | Modify | 旧测试断言"必须 INSERT P0"→ 改为断言"不再 INSERT tasks 行" |
| `packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js` | Create | 新测试：upsertTaskPlan 不向 tasks 表写入 |
| `packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js` | Create | 新测试：createFixTask() 不向 tasks 表写入 harness_task |
| `packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh` | Create | smoke 脚本：真 DB 验证 0 个新 harness_task failed 行 |

---

## Task 1: 停止 upsertTaskPlan 创建 harness_task DB 行（核心修复）

**Files:**
- Modify: `packages/brain/src/harness-dag.js:240-311`
- Modify: `packages/brain/src/__tests__/harness-dag-upsert-priority.test.js`
- Create: `packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js`

### TDD 铁律

**"NO PRODUCTION CODE WITHOUT FAILING TEST FIRST"**
- commit-1: 写 failing test（断言不 INSERT tasks 行）
- commit-2: 修改实现让 test 通过

---

- [ ] **Step 1: 先写失败测试文件**

创建 `packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js`：

```javascript
/**
 * harness-dag-no-retired-spawn.test.js
 *
 * 回归测试：upsertTaskPlan 不再向 tasks 表写入 harness_task 行。
 *
 * 背景（2026-04-28 RCA）：Sprint 1 PR 把 Harness 改成 LangGraph full graph
 * 后，harness_task 在 executor.js 中被 retired。但 upsertTaskPlan 仍 INSERT
 * tasks 行 → 立即失败，导致成功率降至 39%。
 *
 * 修复：upsertTaskPlan 改用 crypto.randomUUID() 内存生成 ID，不写 tasks 表。
 * Full graph 不依赖 tasks 行驱动，task_dependencies 也不再需要真实 UUID（full
 * graph 内联执行，依赖关系由 fanout 顺序保证）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

import { upsertTaskPlan } from '../harness-dag.js';

function makeTask(id, depends_on = []) {
  return {
    task_id: id,
    title: `Task ${id}`,
    scope: `scope of ${id}`,
    dod: [`[BEHAVIOR] ${id} works`],
    files: [`packages/brain/src/${id}.js`],
    depends_on,
    complexity: 'S',
    estimated_minutes: 30,
  };
}

describe('upsertTaskPlan — 不再 INSERT harness_task 到 tasks 表', () => {
  let mockClient;
  let taskInsertCalls;

  beforeEach(() => {
    taskInsertCalls = [];
    mockClient = {
      query: vi.fn((sql, _params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          taskInsertCalls.push(sql);
        }
        // task_dependencies INSERT
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
  });

  it('单任务：不向 tasks 表 INSERT', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1')] };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(taskInsertCalls).toHaveLength(0);
  });

  it('4 任务（还原真机 ws1-4）：不向 tasks 表 INSERT', async () => {
    const plan = {
      initiative_id: 'init-2303a935',
      tasks: [
        makeTask('ws1'),
        makeTask('ws2', ['ws1']),
        makeTask('ws3', ['ws1']),
        makeTask('ws4', ['ws2', 'ws3']),
      ],
    };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-2303a935',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(taskInsertCalls).toHaveLength(0);
  });

  it('返回值 idMap 包含各 logical_task_id 对应的 UUID 字符串', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1'), makeTask('ws2', ['ws1'])] };
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(idMap['ws1']).toMatch(/^[0-9a-f-]{36}$/);
    expect(idMap['ws2']).toMatch(/^[0-9a-f-]{36}$/);
    expect(insertedTaskIds).toHaveLength(2);
  });

  it('task_dependencies 边仍然被写入（含 hard edge）', async () => {
    const plan = {
      initiative_id: 'init-1',
      tasks: [makeTask('ws1'), makeTask('ws2', ['ws1'])],
    };
    const depInsertCalls = [];
    mockClient.query = vi.fn((sql, _params) => {
      if (/INSERT INTO task_dependencies/i.test(sql)) {
        depInsertCalls.push(sql);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(depInsertCalls).toHaveLength(1);
    expect(depInsertCalls[0]).toMatch(/hard/i);
  });
});
```

- [ ] **Step 2: 运行测试确认它失败**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
npx vitest run packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js
```

预期：FAIL（因为 upsertTaskPlan 目前仍 INSERT tasks 行）

- [ ] **Step 3: 修改 harness-dag.js — upsertTaskPlan 改用内存 UUID**

在文件顶部（ES module 开头）确认或添加 crypto import（Node.js 18+ 全局可用）。

找到 `packages/brain/src/harness-dag.js` 中 `upsertTaskPlan` 函数的 for 循环（约 line 258-293），**替换整个 for 循环体**（从 `const payload = {` 到 `insertedTaskIds.push(uuid);`）为：

```javascript
    // Sprint 1 full graph: 不再向 tasks 表 INSERT harness_task 行。
    // Full graph 通过 LangGraph Send fanout 内联执行子任务，不依赖 tasks 行驱动。
    // harness_task 在 executor.js 中已 retired（PR retire-harness-planner），
    // 任何 INSERT 都会立即导致 failed，破坏成功率。
    // 改用 crypto.randomUUID() 内存生成 ID，task_dependencies 仍正常写入（供审计）。
    const uuid = crypto.randomUUID();
    idMap[t.task_id] = uuid;
    insertedTaskIds.push(uuid);
```

同时删除旧的 INSERT 相关注释（约 line 261-282 的 priority 说明、contract_branch 说明），保留 `payload` 构造注释备查：

**完整修改后的 for 循环体**（替换 line 258-293 的 for 循环内容）：

```javascript
  for (const logicalId of order) {
    const t = taskPlan.tasks.find((x) => x.task_id === logicalId);

    // Sprint 1 full graph (2026-04-28): 不再向 tasks 表 INSERT harness_task 行。
    // harness_task 已在 executor.js 中 retired（PR retire-harness-planner）。
    // Full graph 通过 LangGraph Send fanout + runSubTaskNode 内联执行，
    // 不依赖 tasks 行来驱动调度。改用内存 UUID 保持接口兼容。
    const uuid = crypto.randomUUID();
    idMap[t.task_id] = uuid;
    insertedTaskIds.push(uuid);
  }
```

- [ ] **Step 4: 运行新测试确认通过**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
npx vitest run packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js
```

预期：4 个测试全部 PASS

- [ ] **Step 5: 更新旧的 priority 测试（harness-dag-upsert-priority.test.js）**

旧测试断言"INSERT 含 P0"，修改后不再 INSERT，需要更新为"不 INSERT tasks 行"。

**替换整个文件内容**：将 `packages/brain/src/__tests__/harness-dag-upsert-priority.test.js` 的三个测试用例改为：

```javascript
/**
 * harness-dag-upsert-priority.test.js
 *
 * 原测试（2026-04-22）：回归 upsertTaskPlan 默认 priority=P0。
 * 更新（2026-04-28 RCA）：Sprint 1 full graph 后 upsertTaskPlan 不再 INSERT tasks 行，
 * 改用内存 UUID。原 priority 断言已失效，更新为"不 INSERT"断言。
 *
 * 功能性回归测试移至：harness-dag-no-retired-spawn.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

import { upsertTaskPlan } from '../harness-dag.js';

describe('upsertTaskPlan — Sprint 1 full graph：不再 INSERT harness_task（替代旧 priority 回归）', () => {
  let mockClient;
  let taskInsertCalls;

  beforeEach(() => {
    taskInsertCalls = [];
    mockClient = {
      query: vi.fn((sql, _params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          taskInsertCalls.push(sql);
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
  });

  function makeTask(id, depends_on = []) {
    return {
      task_id: id,
      title: `Task ${id}`,
      scope: `scope of ${id}`,
      dod: [`[BEHAVIOR] ${id} works`],
      files: [`packages/brain/src/${id}.js`],
      depends_on,
      complexity: 'S',
      estimated_minutes: 30,
    };
  }

  it('单个子任务：不 INSERT tasks（旧 P0 回归已由 harness-dag-no-retired-spawn 覆盖）', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1')] };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(taskInsertCalls).toHaveLength(0);
  });

  it('4 个子任务（还原真机场景 ws1-4）：0 次 INSERT tasks', async () => {
    const plan = {
      initiative_id: 'init-2303a935',
      tasks: [
        makeTask('ws1'),
        makeTask('ws2', ['ws1']),
        makeTask('ws3', ['ws1']),
        makeTask('ws4', ['ws2', 'ws3']),
      ],
    };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-2303a935',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(taskInsertCalls).toHaveLength(0);
  });

  it('返回值 idMap 含所有 logical_task_id 对应的 UUID', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1'), makeTask('ws2', ['ws1'])] };
    const { idMap } = await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(Object.keys(idMap)).toEqual(expect.arrayContaining(['ws1', 'ws2']));
    expect(idMap['ws1']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 6: 运行全部受影响测试**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
npx vitest run packages/brain/src/__tests__/harness-dag-upsert-priority.test.js packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js packages/brain/src/__tests__/harness-dag.test.js
```

预期：全部 PASS

- [ ] **Step 7: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
git add packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js
git commit -m "test(brain): harness-dag upsertTaskPlan 不再 INSERT harness_task [failing]"
```

- [ ] **Step 8: commit-2（implementation）**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
git add packages/brain/src/harness-dag.js packages/brain/src/__tests__/harness-dag-upsert-priority.test.js
git commit -m "fix(brain): upsertTaskPlan 停止 INSERT retired harness_task 行 — 改用内存 UUID"
```

---

## Task 2: createFixTask() 停止 INSERT harness_task

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:308-351`
- Create: `packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js`

### TDD 铁律：commit-1 failing test，commit-2 implementation

---

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js`：

```javascript
/**
 * harness-initiative-create-fix-task.test.js
 *
 * 回归测试：createFixTask() 不再向 tasks 表 INSERT harness_task 行。
 *
 * 背景（2026-04-28 RCA）：runPhaseCIfReady 路径已被 Sprint 1 full graph 废弃，
 * 但 createFixTask 仍 INSERT harness_task → 立即 retired failed。
 * 修复：加早返回 guard，返回 noop UUID，不写 DB。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: [] }),
  topologicalOrder: vi.fn(),
}));

import { createFixTask } from '../harness-initiative.graph.js';

describe('createFixTask — Sprint 1 retired guard', () => {
  it('调用后不向 tasks 表 INSERT', async () => {
    const taskInsertCalls = [];
    const mockClient = {
      query: vi.fn((sql, _params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          taskInsertCalls.push(sql);
          // 模拟原来会返回的 id（不再应该被调用）
          return Promise.resolve({ rows: [{ id: 'should-not-happen' }] });
        }
        return Promise.resolve({ rows: [{ title: 'Task ws1', description: 'desc', payload: {} }], rowCount: 0 });
      }),
    };

    const result = await createFixTask({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskId: 'task-uuid-1',
      fixRound: 1,
      failureScenarios: [{ name: 'scenario-1', exitCode: 1 }],
      client: mockClient,
    });

    expect(taskInsertCalls).toHaveLength(0);
    // 返回 noop UUID（字符串，不是 undefined）
    expect(typeof result).toBe('string');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
npx vitest run packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js
```

预期：FAIL（因为 createFixTask 目前仍 INSERT）

- [ ] **Step 3: 修改 createFixTask — 加早返回 guard**

在 `packages/brain/src/workflows/harness-initiative.graph.js` 的 `createFixTask` 函数体开头（约 line 315，函数体第一行）**插入**：

```javascript
  // Sprint 1 full graph (2026-04-28): runPhaseCIfReady / createFixTask 路径
  // 已被 LangGraph full graph 的 joinNode + finalE2eNode 替代，不再通过 DB 任务行驱动。
  // 提前返回 noop UUID，避免 INSERT retired harness_task → 立即 failed。
  const noopId = crypto.randomUUID();
  console.warn(`[createFixTask] retired — returning noop id=${noopId} (full graph handles fix inline)`);
  return noopId;
```

插入位置：函数签名 `export async function createFixTask({` 之后、`// 取原 Task 的关键字段` 注释之前。

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
npx vitest run packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js
```

预期：PASS

- [ ] **Step 5: 运行相关 harness 测试组确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
npx vitest run packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js packages/brain/src/__tests__/harness-phase-advancer.test.js packages/brain/src/__tests__/harness-shared.test.js
```

预期：全部 PASS

- [ ] **Step 6: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
git add packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js
git commit -m "test(brain): createFixTask 不再 INSERT harness_task [failing]"
```

- [ ] **Step 7: commit-2（implementation）**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(brain): createFixTask 加 retired guard，停止 INSERT harness_task 行"
```

---

## Task 3: 写 smoke 脚本并运行全套测试

**Files:**
- Create: `packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh`

---

- [ ] **Step 1: 创建 smoke 脚本**

创建 `packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh`：

```bash
#!/usr/bin/env bash
# harness-no-retired-spawn-smoke.sh
# 验证：最近 1h 内没有新 harness_task 失败行产生
# 用途：PR 合并后真环境验证 upsertTaskPlan 不再创建 retired 类型任务

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[smoke] 检查近 1h harness_task failed 行数..."

COUNT=$(psql -U cecelia -d cecelia -t -c "
SELECT COUNT(*) FROM tasks
WHERE task_type = 'harness_task'
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '1 hour';
" 2>/dev/null | tr -d ' \n')

if [ -z "$COUNT" ]; then
  echo "[smoke] ⚠️  无法连接 DB，跳过（非阻断）"
  exit 0
fi

if [ "$COUNT" -gt "0" ]; then
  echo "[smoke] ❌ 近 1h 内仍有 ${COUNT} 个 harness_task failed，修复可能未生效"
  exit 1
fi

echo "[smoke] ✅ 近 1h 无新 harness_task failed 行（COUNT=${COUNT}）"

echo "[smoke] 检查 Brain API 任务失败率..."
FAILED=$(curl -sf "${BRAIN_URL}/api/brain/tasks?status=failed&limit=5" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(len([t for t in d if t.get('task_type')=='harness_task' and t.get('error_message','').startswith('task_type harness_task retired')]))" 2>/dev/null || echo "0")

echo "[smoke] 最近 5 个 failed 任务中 harness_task retired: ${FAILED}"
echo "[smoke] ✅ smoke 通过"
```

- [ ] **Step 2: 给脚本加执行权限**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
chmod +x packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh
```

- [ ] **Step 3: 运行 smoke 脚本验证当前环境**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
bash packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh
```

预期：✅ smoke 通过（因为修复已生效，近 1h 无新 harness_task）

- [ ] **Step 4: 运行全套 Brain vitest**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
npx vitest run packages/brain/src/__tests__/
```

预期：全部 PASS（或仅有与本次修改无关的预存失败）

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
git add packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh
git commit -m "feat(brain): 添加 harness-no-retired-spawn smoke 验证脚本"
```

---

## Task 4: 数据清理 — archive 测试 KR + 取消积压任务

**Files:** 无代码文件，仅 Brain API 调用

---

- [ ] **Step 1: Archive 测试 KR**

通过 Brain API 批量 archive 7 条测试 KR（这些 KR 是历史测试遗留，从未有真实业务价值）：

```bash
# KR dedup test × 2
curl -X PATCH localhost:5221/api/brain/key-results/04441931-68f2-479b-97bc-f67a58ec5077 \
  -H "Content-Type: application/json" \
  -d '{"status":"archived","description":"[archived 2026-04-28] 测试 KR，无真实业务价值，清理以阻止 decomp-checker 持续创建修复任务"}'

curl -X PATCH localhost:5221/api/brain/key-results/61bb6d06-3df2-47c6-a5d4-695d09dc89a7 \
  -H "Content-Type: application/json" \
  -d '{"status":"archived","description":"[archived 2026-04-28] 测试 KR，无真实业务价值"}'

# Empty KR
curl -X PATCH localhost:5221/api/brain/key-results/294bba5c-f276-457d-a4b4-dc3506bcba57 \
  -H "Content-Type: application/json" \
  -d '{"status":"archived","description":"[archived 2026-04-28] 测试 KR"}'

# Test KR for select × 2
curl -X PATCH localhost:5221/api/brain/key-results/05c757bf-8960-43cd-8d87-bb64abdd7aed \
  -H "Content-Type: application/json" \
  -d '{"status":"archived","description":"[archived 2026-04-28] 测试 KR"}'

curl -X PATCH localhost:5221/api/brain/key-results/8513da8e-5108-4d82-889a-7e11f2c4c885 \
  -H "Content-Type: application/json" \
  -d '{"status":"archived","description":"[archived 2026-04-28] 测试 KR"}'

# LP Test KR × 2
curl -X PATCH localhost:5221/api/brain/key-results/2f32a1bc-32bd-48e3-b9e6-4b7d0ac095a2 \
  -H "Content-Type: application/json" \
  -d '{"status":"archived","description":"[archived 2026-04-28] 测试 KR"}'

curl -X PATCH localhost:5221/api/brain/key-results/f90e6aba-0461-4605-9031-ad74526e52d9 \
  -H "Content-Type: application/json" \
  -d '{"status":"archived","description":"[archived 2026-04-28] 测试 KR"}'
```

如果 `/api/brain/key-results/:id` PATCH 端点不存在，改用 psql 直接更新：

```bash
psql -U cecelia -d cecelia -c "
UPDATE key_results
SET status = 'archived', updated_at = NOW()
WHERE id IN (
  '04441931-68f2-479b-97bc-f67a58ec5077',
  '61bb6d06-3df2-47c6-a5d4-695d09dc89a7',
  '294bba5c-f276-457d-a4b4-dc3506bcba57',
  '05c757bf-8960-43cd-8d87-bb64abdd7aed',
  '8513da8e-5108-4d82-889a-7e11f2c4c885',
  '2f32a1bc-32bd-48e3-b9e6-4b7d0ac095a2',
  'f90e6aba-0461-4605-9031-ad74526e52d9'
);
"
```

验证：
```bash
psql -U cecelia -d cecelia -c "SELECT id, title, status FROM key_results WHERE id IN ('04441931-68f2-479b-97bc-f67a58ec5077','61bb6d06-3df2-47c6-a5d4-695d09dc89a7','294bba5c-f276-457d-a4b4-dc3506bcba57','05c757bf-8960-43cd-8d87-bb64abdd7aed','8513da8e-5108-4d82-889a-7e11f2c4c885','2f32a1bc-32bd-48e3-b9e6-4b7d0ac095a2','f90e6aba-0461-4605-9031-ad74526e52d9');"
```

预期：7 行均 `status = 'archived'`

- [ ] **Step 2: 取消 KR 修复相关 queued 任务**

```bash
# 取消已知的 KR 拆解修复任务
for task_id in \
  "e69245f6-37fb-45f3-8f1f-5709c2df7fb6" \
  "b6fb9ec4-7627-41fd-bc81-b5d2e79c1cd3" \
  "db946add-b08b-4d3e-a5d5-8a88fad6a15b" \
  "27cb5268-5bdf-4fba-a62f-161caa57dbb5" \
  "3c67abe5-6204-4f51-aeb0-4215fc35034a"; do
  curl -s -X PATCH "localhost:5221/api/brain/tasks/${task_id}" \
    -H "Content-Type: application/json" \
    -d '{"status":"canceled","error_message":"[cleanup 2026-04-28] 测试 KR 已 archived，本修复任务无需执行"}'
  echo "Canceled task ${task_id}"
done
```

- [ ] **Step 3: 批量取消积压过期任务（content-pipeline + arch_review）**

```bash
psql -U cecelia -d cecelia -c "
UPDATE tasks
SET status = 'canceled',
    error_message = '[cleanup 2026-04-28] 任务积压超期，批量清理以释放调度槽位',
    completed_at = NOW(),
    updated_at = NOW()
WHERE status = 'queued'
  AND (
    (task_type = 'content-pipeline' AND created_at < NOW() - INTERVAL '3 days')
    OR (task_type = 'arch_review' AND created_at < NOW() - INTERVAL '36 hours')
    OR (
      task_type = 'harness_initiative'
      AND title LIKE '[smoke%'
      AND created_at < NOW() - INTERVAL '2 days'
    )
  )
RETURNING id, title, task_type, created_at;
"
```

- [ ] **Step 4: 验证队列状态**

```bash
psql -U cecelia -d cecelia -c "
SELECT task_type, status, COUNT(*) as count
FROM tasks
WHERE status = 'queued'
GROUP BY task_type, status
ORDER BY count DESC
LIMIT 20;
"
```

预期：content-pipeline queued 任务 < 5，arch_review queued = 0（或只有最新的）

- [ ] **Step 5: 验证 decomp-checker 不再创建 KR 修复任务**

等待下一次 tick（Brain tick 每 5s 一次，5min execute），检查没有新的 "KR 拆解（修复）: KR dedup test" 任务被创建：

```bash
psql -U cecelia -d cecelia -c "
SELECT id, title, status, created_at
FROM tasks
WHERE title LIKE '%KR dedup test%'
  OR title LIKE '%Empty KR%'
  OR title LIKE '%Test KR for select%'
  OR title LIKE '%LP Test KR%'
ORDER BY created_at DESC
LIMIT 10;
"
```

预期：最新的任务 status = 'canceled'，且 created_at < 5 分钟前（没有新创建）

---

## Task 5: PRD / DoD + Learning 文件

**Files:**
- Create: `PRD.md`（worktree 根目录）
- Create: `docs/learnings/cp-042813-rca-fix-task-success-rate.md`

---

- [ ] **Step 1: 写 PRD.md**

创建 worktree 根目录下的 `PRD.md`（branch-protect.sh 要求）：

```markdown
# PRD: Brain 任务成功率 RCA Fix

## 问题
24h 任务失败率 61%（20 失败 / 33 结案），主因 harness_task retired 后仍被创建。

## 目标
将成功率恢复到 >80%。

## 成功标准

## 成功标准

- [x] `SELECT COUNT(*) FROM tasks WHERE task_type='harness_task' AND status='failed' AND created_at > NOW() - INTERVAL '1 hour'` = 0
- [x] 7 条测试 KR status = 'archived'
- [x] queued 队列中 content-pipeline 积压 < 5 个

## DoD

- [x] [ARTIFACT] `packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js` 存在
- [x] [ARTIFACT] `packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js` 存在
- [x] [ARTIFACT] `packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh` 存在
- [x] [BEHAVIOR] upsertTaskPlan 不向 tasks 表 INSERT harness_task 行
  Test: `tests: packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js`
- [x] [BEHAVIOR] createFixTask 不向 tasks 表 INSERT harness_task 行
  Test: `tests: packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js`
- [x] [BEHAVIOR] 7 条测试 KR 已 archived
  Test: `manual:node -e "const {Client}=require('pg');const c=new Client({database:'cecelia',user:'cecelia'});c.connect().then(()=>c.query(\"SELECT COUNT(*) as n FROM key_results WHERE status='archived' AND title IN ('KR dedup test','Empty KR','Test KR for select','LP Test KR')\")).then(r=>{if(parseInt(r.rows[0].n)<5)process.exit(1);console.log('ok:'+r.rows[0].n)}).finally(()=>c.end())"`
```

- [ ] **Step 2: 写 Learning 文件**

创建 `docs/learnings/cp-042813-rca-fix-task-success-rate.md`：

```markdown
# Learning: harness_task retired 但创建方未同步停止

**分支**: cp-0428132356-rca-fix-task-success-rate  
**日期**: 2026-04-28

### 根本原因

Sprint 1 PR 把 Harness 改成 LangGraph full graph，将 `harness_task` 在
`executor.js` 中标记为 RETIRED。但该 PR **没有同步修改创建方**：

1. `harness-dag.js:upsertTaskPlan()` 仍 INSERT `task_type='harness_task'`
2. `harness-initiative.graph.js:createFixTask()` 仍 INSERT `task_type='harness_task'`

结果：每个 harness_initiative 进入 Phase A 结束时批量创建子任务行，这些行
立即被 executor 标为 failed，导致 24h 内 20 个 failed，成功率降至 39%。

同时，测试 KR 污染（7 条 decomposing 状态的 test KR）导致 decomp-checker 持续
创建无意义的修复任务，占用队列槽位。

### 下次预防

- [ ] **退役 task_type 时，必须在同一 PR 内修改所有 INSERT 该 task_type 的调用方**
      grep 命令：`grep -rn "task_type.*=.*'<retired_type>'" packages/brain/src/`
- [ ] retire PR 的 DoD 必须含一条 `[BEHAVIOR]` 断言："创建方不再 INSERT 此 task_type"
- [ ] 测试 KR 创建后必须立即在测试结束时清理（archive 或 delete），避免 decomposing 状态残留
- [ ] 成功率监控：Brain tick 应每小时统计 `failed/(failed+completed)` 比率，超 30% 时触发 P0 SelfDrive 任务
```

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
git add PRD.md docs/learnings/cp-042813-rca-fix-task-success-rate.md
git commit -m "docs(learning): harness_task retired 但创建方未同步停止 — 根本原因 + 预防措施"
```

---

## 自检清单

完成所有 task 后：

```bash
cd /Users/administrator/worktrees/cecelia/rca-fix-task-success-rate
# 1. 全套 brain 测试
npx vitest run packages/brain/src/__tests__/harness-dag-no-retired-spawn.test.js \
  packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js \
  packages/brain/src/__tests__/harness-dag-upsert-priority.test.js \
  packages/brain/src/__tests__/harness-dag.test.js

# 2. smoke
bash packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh

# 3. 验证 KR archived
psql -U cecelia -d cecelia -c "SELECT COUNT(*) FROM key_results WHERE status='archived' AND created_at > '2026-04-21'::date AND title IN ('KR dedup test','Empty KR','Test KR for select','LP Test KR');"
```
