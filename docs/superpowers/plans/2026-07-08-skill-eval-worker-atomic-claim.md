# skill-eval-worker 取任务原子化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `skill-eval-worker.js` 取 pending 任务的 SELECT+UPDATE 两步式改成一条原子 `UPDATE...RETURNING`（配 `FOR UPDATE SKIP LOCKED`），消除多 worker 并发下重复取同一任务的竞态。

**Architecture:** 从 `runOnce()` 里抽出一个可单独测试的 `claimPendingTask()` 函数，内部只跑一条原子 SQL；`runOnce()` 改为调用它拿 `{task_id, staging_path}` 或 `null`。

**Tech Stack:** Node.js（ESM）、`pg`（Pool）、vitest。

## Global Constraints
- 不改 `runOnce()` 之外的任何函数（`extractZip`/`findSkillDir`/`runClaudeEval`/`postComplete`/`markFailed`）。
- 不改 `pool` 的引入方式（沿用 `import pool from '../db.js'`）。
- 测试沿用仓库既有约定：`vi.mock('../db.js', () => ({ default: mockPool }))`（见 `src/__tests__/eval.test.js` 先例），不引入真实数据库或 testcontainers。
- 新增导出函数须与文件内既有导出风格一致（具名 `export function` / `export async function`）。

---

### Task 1: 抽出 `claimPendingTask()` 并改成原子 UPDATE...RETURNING，配套测试

**Files:**
- Modify: `packages/brain/scripts/skill-eval-worker.js:174-189`（`runOnce()` 开头取任务部分）
- Test: `packages/brain/scripts/__tests__/skill-eval-worker.test.js`

**Interfaces:**
- Produces: `export async function claimPendingTask()` — 返回 `{ task_id: string, staging_path: string } | null`。`runOnce()` 内部调用它，不改变 `runOnce()` 的导出签名（仍是 `export async function runOnce()`，返回值行为不变）。
- Consumes: 模块顶部已有的 `import pool from '../db.js'`（不新增 import）。

- [ ] **Step 1: 写测试文件顶部的 mock 基础设施（先写失败测试）**

在 `packages/brain/scripts/__tests__/skill-eval-worker.test.js` 顶部（第 1-2 行 import 之后）插入 mock 声明。因为 `vi.mock` 必须在文件顶层且 vitest 会 hoist，用 `vi.hoisted` 包住 mockPool（与 `src/__tests__/eval.test.js` 的既有写法一致）：

```javascript
import { describe, it, expect, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

import { sanitizeJsonString, extractReportJson, claimPendingTask } from '../skill-eval-worker.js';
```

把原来的 `import { describe, it, expect } from 'vitest';` 和 `import { sanitizeJsonString, extractReportJson } from '../skill-eval-worker.js';` 两行替换成上面这段（顺序：vitest import → vi.hoisted mock → vi.mock → 被测模块 import，`vi.mock` 必须在被测模块 import 之前生效）。

然后在文件末尾（第 47 行 `});` 之后）新增一段测试：

```javascript

describe('claimPendingTask — 原子取任务，消除并发竞态', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('发送的是单条 UPDATE...RETURNING 语句（不是分开的 SELECT+UPDATE）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ task_id: 'task-1', staging_path: '/tmp/a.zip' }],
    });

    const claimed = await claimPendingTask();

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE skill_evals/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/RETURNING task_id::text, staging_path/);
    expect(claimed).toEqual({ task_id: 'task-1', staging_path: '/tmp/a.zip' });
  });

  it('没有 pending 任务时返回 null', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const claimed = await claimPendingTask();

    expect(claimed).toBeNull();
  });

  it('并发调用不会拿到同一条任务（用内存态模拟 FOR UPDATE SKIP LOCKED 语义）', async () => {
    // 模拟两条 pending 记录 + 一个具备"原子取一条并标记 running"语义的假 pool，
    // 用来验证调用方（claimPendingTask）确实只发一条原子语句、把互斥完全交给这条 SQL，
    // 而不是自己在应用层做两步查询再自己判断——两步式正是本次要修的 bug。
    const fakeRows = [
      { task_id: 'task-a', staging_path: '/tmp/a.zip', status: 'pending' },
      { task_id: 'task-b', staging_path: '/tmp/b.zip', status: 'pending' },
    ];
    mockPool.query.mockImplementation(async (sql) => {
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      const next = fakeRows.find((r) => r.status === 'pending');
      if (!next) return { rows: [] };
      next.status = 'running';
      return { rows: [{ task_id: next.task_id, staging_path: next.staging_path }] };
    });

    const [first, second] = await Promise.all([claimPendingTask(), claimPendingTask()]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first.task_id).not.toBe(second.task_id);
    expect(new Set([first.task_id, second.task_id])).toEqual(new Set(['task-a', 'task-b']));
  });
});
```

同时把文件顶部 `import { describe, it, expect } from 'vitest';` 改成 `import { describe, it, expect, vi, beforeEach } from 'vitest';`（新增 `vi` 和 `beforeEach`）。

- [ ] **Step 2: 运行测试确认失败（`claimPendingTask` 尚不存在）**

Run: `cd packages/brain && npx vitest run scripts/__tests__/skill-eval-worker.test.js`
Expected: FAIL — `claimPendingTask` 导入报 `does not provide an export named 'claimPendingTask'` 或调用时 `claimPendingTask is not a function`。

- [ ] **Step 3: 提交 Red 测试**

```bash
git add packages/brain/scripts/__tests__/skill-eval-worker.test.js
git commit -m "test: skill-eval-worker claimPendingTask 原子取任务测试（Red）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现 `claimPendingTask()`，改造 `runOnce()`**

把 `packages/brain/scripts/skill-eval-worker.js` 第 174-189 行：

```javascript
export async function runOnce() {
  const { rows } = await pool.query(
    `SELECT task_id::text, staging_path FROM skill_evals WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
  );

  if (!rows.length) {
    console.log('[skill-eval-worker] 没有 pending 任务，退出');
    return null;
  }

  const { task_id: taskId, staging_path: stagingPath } = rows[0];
  console.log(`[skill-eval-worker] 取到任务 ${taskId}，staging_path=${stagingPath}`);

  // 标记 running，防止并发 worker 重复取同一条（也满足 checkSlotAvailable 的槽位统计口径：
  // routes/eval.js 的背压检查按 status='running' 数槽位，worker 取到任务后必须先占位）。
  await pool.query(`UPDATE skill_evals SET status = 'running', updated_at = now() WHERE task_id = $1`, [taskId]);
```

替换为：

```javascript
/**
 * 原子取一条 pending 任务并标记为 running。
 * SELECT 子查询 + FOR UPDATE SKIP LOCKED 保证并发 worker 之间互相跳过对方正在锁的行，
 * 选取和状态迁移在同一条语句内完成，消除"先 SELECT 再 UPDATE"两步式的竞态窗口。
 * @returns {Promise<{task_id: string, staging_path: string} | null>}
 */
export async function claimPendingTask() {
  const { rows } = await pool.query(
    `UPDATE skill_evals
     SET status = 'running', updated_at = now()
     WHERE task_id = (
       SELECT task_id FROM skill_evals
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING task_id::text, staging_path`
  );
  return rows[0] || null;
}

export async function runOnce() {
  const claimed = await claimPendingTask();

  if (!claimed) {
    console.log('[skill-eval-worker] 没有 pending 任务，退出');
    return null;
  }

  const { task_id: taskId, staging_path: stagingPath } = claimed;
  console.log(`[skill-eval-worker] 取到任务 ${taskId}，staging_path=${stagingPath}`);
```

其余部分（`tmpDir` 声明开始到函数结尾）保持不动，紧接在这段之后。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run scripts/__tests__/skill-eval-worker.test.js`
Expected: PASS，全部测试（原有 `sanitizeJsonString`/`extractReportJson` 5 个 + 新增 `claimPendingTask` 3 个）通过。

- [ ] **Step 6: 跑整个 brain 包测试确认无回归**

Run: `cd packages/brain && npx vitest run`
Expected: PASS（无既有测试因本次改动失败）。

- [ ] **Step 7: 提交实现**

```bash
git add packages/brain/scripts/skill-eval-worker.js
git commit -m "fix: skill-eval-worker 取任务改成原子 UPDATE+SKIP LOCKED，消除并发竞态

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Post-Plan Checklist（对照 PrepPRD 验收标准）
- [x] `runOnce()` 取任务变成单条原子 UPDATE...RETURNING 语句（Task 1 Step 4）
- [x] 新增/改造单测：模拟并发调用，验证同一条 pending 任务不会被两次取走（Task 1 Step 1 第三个测试）
- [x] 现有测试（`skill-eval-worker.test.js`）全部通过（Task 1 Step 5/6）
- [ ] CI 全绿（push 后由 CI 验证，非本地步骤）
