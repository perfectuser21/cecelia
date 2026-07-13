# ci-patrol Brain 接线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 task_type=ci_patrol 每天北京 08:00 自动建任务并被 executor 以 /ci-patrol skill 派发执行。

**Architecture:** daily-review-scheduler.js 加 triggerCiPatrol（窗口+当日去重+INSERT，照 triggerArchReview）→ 注册进 scheduler-jobs.js JOBS → task-router.js 4 张表登记 → executor skillMap 登记。

**Tech Stack:** Node ESM / pg / vitest。

## Global Constraints

- TDD 强制（CI `lint-tdd-commit-order` 闸）：commit-1 = 全部测试（红），commit-2 = 实现（绿）。同 PR 内测试 commit 必须在实现 commit 之前。
- eslint 零 warning 基线（`cd packages/brain && npm run lint`）。
- 不碰：dispatch-helpers 黑名单、pre-flight SYSTEM_TASK_TYPES、model_map、_TASK_ROUTES、strategist_decision 的任何现状。
- 窗口 = UTC 00:00-00:05（北京 08:00）；任务字段 priority='P2' / created_by='cecelia-brain' / trigger_source='brain_auto' / location='us'；payload.prd_summary ≥20 字符。

---

### Task 1: 全部失败测试（commit-1）

**Files:**
- Modify: `packages/brain/src/__tests__/daily-review-scheduler.test.js`（末尾追加 describe）
- Create: `packages/brain/src/__tests__/task-router-ci-patrol.test.js`
- Modify: `packages/brain/src/__tests__/scheduler-jobs.test.js`（JOBS 数量断言 6→7）

**Interfaces:**
- Consumes: 现有 `triggerArchReview` describe 的 mock pool 风格（同文件 670 行起，先读再仿写）。
- Produces: Task 2 必须实现的导出名——`isInCiPatrolWindow(now)` / `hasTodayCiPatrol(pool)` / `triggerCiPatrol(pool, now)`（daily-review-scheduler.js）；task-router 4 表 + executor skillMap + JOBS 的 'ci-patrol' 项。

- [ ] **Step 1: daily-review-scheduler.test.js 追加（先读 670-780 行现有 triggerArchReview describe 的 mock 写法，保持同风格；import 行加上三个新名字）**

```javascript
// ── ci_patrol 调度（每日北京 08:00 = UTC 00:00）─────────────────────────────
describe('isInCiPatrolWindow', () => {
  it('UTC 00:00-00:04 在窗口内', () => {
    expect(isInCiPatrolWindow(new Date('2026-07-09T00:00:00Z'))).toBe(true);
    expect(isInCiPatrolWindow(new Date('2026-07-09T00:04:59Z'))).toBe(true);
  });
  it('UTC 00:05 及其他小时不在窗口', () => {
    expect(isInCiPatrolWindow(new Date('2026-07-09T00:05:00Z'))).toBe(false);
    expect(isInCiPatrolWindow(new Date('2026-07-09T08:00:00Z'))).toBe(false);
  });
});

describe('hasTodayCiPatrol', () => {
  it('当天已有 ci_patrol 任务返回 true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 't1' }] }) };
    expect(await hasTodayCiPatrol(pool)).toBe(true);
    expect(pool.query.mock.calls[0][0]).toContain("task_type = 'ci_patrol'");
  });
  it('当天没有返回 false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    expect(await hasTodayCiPatrol(pool)).toBe(false);
  });
});

describe('triggerCiPatrol', () => {
  it('窗口外直接跳过，不查库', async () => {
    const pool = { query: vi.fn() };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T12:00:00Z'));
    expect(r).toEqual({ triggered: false, skipped_window: true, skipped_recent: false });
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('当日已有则去重跳过', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 't1' }] }) };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'));
    expect(r).toEqual({ triggered: false, skipped_window: false, skipped_recent: true });
  });
  it('窗口内且无当日任务 → INSERT 正确字段', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                    // hasTodayCiPatrol
        .mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }), // INSERT
    };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'));
    expect(r.triggered).toBe(true);
    expect(r.task_id).toBe('new-task-id');
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toContain("'ci_patrol'");
    expect(sql).toContain("'brain_auto'");
    expect(sql).toContain("'us'");
    expect(params[0]).toContain('[ci-patrol]');
    const payload = JSON.parse(params[1]);
    expect(payload.prd_summary.length).toBeGreaterThanOrEqual(20);
  });
  it('去重查询失败时 warn 后继续创建（宁重不漏，同 arch 模式）', async () => {
    const pool = {
      query: vi.fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }),
    };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'));
    expect(r.triggered).toBe(true);
  });
  it('INSERT 失败返回 error 不抛出', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('insert fail')),
    };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'));
    expect(r.triggered).toBe(false);
    expect(r.error).toBe('insert fail');
  });
});
```

- [ ] **Step 2: 新建 task-router-ci-patrol.test.js（完整文件）**

```javascript
import { describe, it, expect } from 'vitest';
import {
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  LOCATION_MAP,
  TASK_REQUIREMENTS,
  routeTaskCreate,
} from '../task-router.js';
import * as executor from '../executor.js';
import { JOBS } from '../scheduler-jobs.js';

describe('task-router: ci_patrol registration', () => {
  it('is a valid task type', () => {
    expect(VALID_TASK_TYPES).toContain('ci_patrol');
  });

  it('routes to /ci-patrol skill', () => {
    expect(SKILL_WHITELIST['ci_patrol']).toBe('/ci-patrol');
  });

  it('is located at us', () => {
    expect(LOCATION_MAP['ci_patrol']).toBe('us');
  });

  it('requires has_git', () => {
    expect(TASK_REQUIREMENTS['ci_patrol']).toEqual(['has_git']);
  });

  it('routeTaskCreate resolves full routing for ci_patrol', () => {
    const result = routeTaskCreate({ title: 'CI 巡检', task_type: 'ci_patrol' });
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/ci-patrol');
  });
});

describe('executor: ci_patrol skill 映射（防 strategist_decision 式降级 /dev）', () => {
  it('getSkillForTaskType 返回 /ci-patrol', () => {
    expect(executor.getSkillForTaskType('ci_patrol', {})).toBe('/ci-patrol');
  });
});

describe('scheduler-jobs: ci-patrol 已注册', () => {
  it('JOBS 含 ci-patrol 且 needsPool', () => {
    const job = JOBS.find((j) => j.name === 'ci-patrol');
    expect(job).toBeDefined();
    expect(job.needsPool).toBe(true);
  });
});
```

- [ ] **Step 3: scheduler-jobs.test.js 的 JOBS 数量断言改 7**

先读该测试 40-50 行现状（「JOBS 注册了 6 个 job」+ name 列表），把 6 改 7、name 列表加 `'ci-patrol'`（位置与实现里 JOBS 数组顺序一致——实现将把 ci-patrol 放在 arch-review 之后第 2 位）。同文件 123 行 `{ count: JOBS.length }` 是动态的不用改。

- [ ] **Step 4: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/daily-review-scheduler.test.js src/__tests__/task-router-ci-patrol.test.js src/__tests__/scheduler-jobs.test.js 2>&1 | tail -20`
Expected: FAIL（isInCiPatrolWindow 未导出 / VALID_TASK_TYPES 不含 ci_patrol / JOBS 6≠7）。记录输出。

- [ ] **Step 5: Commit（commit-1）**

```bash
git add packages/brain/src/__tests__/daily-review-scheduler.test.js packages/brain/src/__tests__/task-router-ci-patrol.test.js packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "test(brain): ci_patrol 接线失败测试先行（调度窗口/去重/INSERT + 4表登记 + skillMap + JOBS）"
```

---

### Task 2: 实现（commit-2）

**Files:**
- Modify: `packages/brain/src/daily-review-scheduler.js`（文件末尾追加 ci_patrol 段）
- Modify: `packages/brain/src/scheduler-jobs.js:11,23`（import + JOBS 项）
- Modify: `packages/brain/src/task-router.js`（4 张表各一行）
- Modify: `packages/brain/src/executor.js:1298` 附近（skillMap 一行）

**Interfaces:**
- Consumes: Task 1 定义的导出名与断言。
- Produces: 无后续任务。

- [ ] **Step 1: daily-review-scheduler.js 末尾追加**

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// ci_patrol 调度器（每日北京 08:00 = UTC 00:00，等 03:00 刀A + 04:30 刀B nightly 跑完）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 判断当前 UTC 时间是否在 ci_patrol 每日触发窗口内（00:00-00:05 UTC）
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {boolean}
 */
export function isInCiPatrolWindow(now = new Date()) {
  return now.getUTCHours() === 0 && now.getUTCMinutes() < 5;
}

/**
 * 检查今天是否已创建过 ci_patrol 任务（当日去重）
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasTodayCiPatrol(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'ci_patrol'
       AND created_at >= CURRENT_DATE::timestamptz
       AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
     LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * ci_patrol 定时调度入口（每日，scheduler-jobs 60s 轮询调用，自带窗口+当日去重）
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {Promise<{ triggered: boolean, skipped_window: boolean, skipped_recent: boolean }>}
 */
export async function triggerCiPatrol(pool, now = new Date()) {
  if (!isInCiPatrolWindow(now)) {
    return { triggered: false, skipped_window: true, skipped_recent: false };
  }

  try {
    if (await hasTodayCiPatrol(pool)) {
      return { triggered: false, skipped_window: false, skipped_recent: true };
    }
  } catch (err) {
    console.warn('[ci-patrol] 去重检查失败（继续执行）:', err.message);
  }

  try {
    const today = now.toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, created_by, payload, trigger_source, location)
       VALUES ($1, 'ci_patrol', 'queued', 'P2', 'cecelia-brain', $2, 'brain_auto', 'us')
       RETURNING id`,
      [
        `[ci-patrol] CI/CD 巡检日报 ${today}`,
        JSON.stringify({
          scope: 'scheduled',
          trigger: 'daily',
          date: today,
          prd_summary: `每日 CI/CD 巡检：按 line 报 4 硬伤（没写/写了没进CI/假绿/正在红），产出日报到 AI Notes + 棘轮 guard。`,
        }),
      ]
    );
    const task_id = rows[0].id;
    console.log(`[ci-patrol] Created ci_patrol task ${task_id}`);
    return { triggered: true, skipped_window: false, skipped_recent: false, task_id };
  } catch (err) {
    console.error('[ci-patrol] 创建任务失败:', err.message);
    return { triggered: false, skipped_window: false, skipped_recent: false, error: err.message };
  }
}
```

- [ ] **Step 2: scheduler-jobs.js 两处**

第 11 行 import 改为：
```javascript
import { triggerArchReview, triggerCiPatrol } from './daily-review-scheduler.js';
```
JOBS 数组 arch-review 项之后插入：
```javascript
  { name: 'ci-patrol', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: triggerCiPatrol, description: 'CI/CD 巡检（自带北京08:00窗口+当日去重）' },
```

- [ ] **Step 3: task-router.js 4 张表各加一行（照 strategist_decision/arch_review 现有行的格式与注释风格，加在其附近）**

```javascript
// VALID_TASK_TYPES（60 行 strategist_decision 附近）：
  'ci_patrol',  // CI/CD 巡检员：每日按 line 报 4 硬伤 + 棘轮 guard（daily-review-scheduler triggerCiPatrol）
// SKILL_WHITELIST（131 行附近）：
  'ci_patrol': '/ci-patrol',
// LOCATION_MAP（275 行附近）：
  'ci_patrol': 'us',  // CI 巡检 → US 本机（需读本地 repo + gh + Brain DB）
// TASK_REQUIREMENTS（313 行附近）：
  'ci_patrol':          ['has_git'],
```

- [ ] **Step 4: executor.js skillMap 加一行（1298 行 code_review 之后）**

```javascript
    'ci_patrol': '/ci-patrol', // CI/CD 巡检：每日按 line 报硬伤（ci-patrol skill）
```

- [ ] **Step 5: 跑测试确认绿 + lint**

Run: `cd packages/brain && npx vitest run src/__tests__/daily-review-scheduler.test.js src/__tests__/task-router-ci-patrol.test.js src/__tests__/scheduler-jobs.test.js 2>&1 | tail -10 && npm run lint 2>&1 | tail -3`
Expected: 全 PASS；lint 零 warning。

- [ ] **Step 6: Commit（commit-2）**

```bash
git add packages/brain/src/daily-review-scheduler.js packages/brain/src/scheduler-jobs.js packages/brain/src/task-router.js packages/brain/src/executor.js
git commit -m "feat(brain): ci_patrol 每日调度+派发接线——北京0800窗口+当日去重+4表登记+skillMap（决策 db1b393b）"
```

---

### Task 3: merge 后验证（PR merged + Brain 容器重启加载新代码后）

- [ ] **Step 1: proven to work** — 手动 INSERT 一条 ci_patrol 任务（照 triggerCiPatrol 的 INSERT 语句），观察 dispatcher 领取 → cecelia-run spawn → 日报 note 出现在 Brain notes。或等次日北京 08:00 自动触发。
- [ ] **Step 2:** 检查 `working_memory` 表 `scheduler_job_last_run:ci-patrol` 哨兵有记录（证明 JOBS 轮询真调到了）。
