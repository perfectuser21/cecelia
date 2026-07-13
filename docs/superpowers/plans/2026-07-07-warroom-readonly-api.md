# warroom 只读端点（handoffs + sentinel/health）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Brain 新增两个只读端点 `GET /api/brain/handoffs` 与 `GET /api/brain/sentinel/health`，为 warroom 前端动态化供数。

**Architecture:** 两个独立新路由文件（`src/routes/handoffs.js` / `src/routes/sentinel.js`），挂进 `src/routes.js` 的 brainRoutes（前缀 /api/brain）。纯 SQL 装配 + JSON 变换，不碰写路径。Spec: docs/superpowers/specs/2026-07-07-warroom-readonly-api-design.md

**Tech Stack:** Node ESM + Express Router + pg pool（`../db.js` default export）；vitest + supertest + `vi.mock('../../db.js')`。

**约束：** TDD 铁律——NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每 Task commit 顺序 commit-1 = failing test（`test:`）/ commit-2 = 实现（`feat(brain):`）。测试命令在 `packages/brain/` 目录下跑 `npx vitest run <file>`。

---

### Task 1: GET /api/brain/handoffs 路由

**Files:**
- Test: `packages/brain/src/routes/__tests__/handoffs-endpoint.test.js`（新建）
- Create: `packages/brain/src/routes/handoffs.js`
- Modify: `packages/brain/src/routes.js`（import + `router.use('/handoffs', ...)`）

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/routes/__tests__/handoffs-endpoint.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../handoffs.js');
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/brain/handoffs', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const handoffRow = (over = {}) => ({
  id: 'task-1',
  title: 'db 行 title',
  handoff: {
    task_id: 'task-1',
    title: '交接单 title',
    verdict: 'PASS',
    journey_id: 'j-01',
    created_at: '2026-07-07T00:00:00.000Z',
    next_steps: ['下一步 A'],
    artifacts: { pr_urls: ['https://github.com/x/pr/1'], sprint_dir: null, branch: null, docs: [] },
    ...over,
  },
});

describe('GET /api/brain/handoffs — warroom 接力史（relay-baton4 item1）', () => {
  beforeEach(() => mockQuery.mockReset());

  it('返回摘要字段（pr_urls 从 artifacts 提取），默认 limit=20', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [handoffRow()] });
    const res = await (await req())(await makeApp()).get('/api/brain/handoffs');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const h = res.body.handoffs[0];
    expect(h.task_id).toBe('task-1');
    expect(h.title).toBe('交接单 title');
    expect(h.verdict).toBe('PASS');
    expect(h.journey_id).toBe('j-01');
    expect(h.next_steps).toEqual(['下一步 A']);
    expect(h.pr_urls).toEqual(['https://github.com/x/pr/1']);
    // 默认 limit=20 走参数化
    expect(mockQuery.mock.calls[0][1]).toContain(20);
  });

  it('SQL 按 handoff.created_at 倒序 + 只取带 handoff 的 tasks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await (await req())(await makeApp()).get('/api/brain/handoffs');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/result\s*\?\s*'handoff'/);
    expect(sql.toLowerCase()).toContain("order by (result->'handoff'->>'created_at') desc");
  });

  it('journey_id 过滤：handoff.journey_id 或 payload.journey_id 命中（参数化）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await (await req())(await makeApp()).get('/api/brain/handoffs?journey_id=j-05');
    const sql = mockQuery.mock.calls[0][0];
    const params = mockQuery.mock.calls[0][1];
    expect(sql).toContain("result->'handoff'->>'journey_id'");
    expect(sql).toContain("payload->>'journey_id'");
    expect(params).toContain('j-05');
  });

  it('limit clamp：>100 → 100；非法 → 20', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await makeApp();
    await (await req())(app).get('/api/brain/handoffs?limit=500');
    expect(mockQuery.mock.calls[0][1]).toContain(100);
    await (await req())(app).get('/api/brain/handoffs?limit=abc');
    expect(mockQuery.mock.calls[1][1]).toContain(20);
  });

  it('handoff 字段缺失时安全回退（title 回退 tasks.title，数组回退 []）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-2', title: 'db 行 title', handoff: { task_id: 'task-2' } }],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/handoffs');
    const h = res.body.handoffs[0];
    expect(h.title).toBe('db 行 title');
    expect(h.verdict).toBeNull();
    expect(h.next_steps).toEqual([]);
    expect(h.pr_urls).toEqual([]);
  });

  it('空库返回 { handoffs: [], total: 0 }；DB 错误返回 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const app = await makeApp();
    const ok = await (await req())(app).get('/api/brain/handoffs');
    expect(ok.body).toEqual({ handoffs: [], total: 0 });
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const bad = await (await req())(app).get('/api/brain/handoffs');
    expect(bad.status).toBe(500);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/handoffs-endpoint.test.js`
Expected: FAIL（Cannot find module '../handoffs.js'）

- [ ] **Step 3: commit-1（失败测试）**

```bash
git add packages/brain/src/routes/__tests__/handoffs-endpoint.test.js
git commit -m "test: GET /api/brain/handoffs 失败测试（warroom 接力史）"
```

- [ ] **Step 4: 最小实现**

```js
// packages/brain/src/routes/handoffs.js
/**
 * routes/handoffs.js — 交接单只读流（relay-baton4 item1）
 *
 * GET /api/brain/handoffs?limit=20&journey_id=
 *   从 tasks.result.handoff（saveHandoff 写入的 SSOT，见 src/handoff.js）捞摘要，
 *   按交接单 created_at 倒序。供 warroom「接力史流」板块。只读。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

router.get('/', async (req, res) => {
  try {
    const parsed = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
    const params = [];
    const conditions = [`result ? 'handoff'`];
    if (req.query.journey_id) {
      params.push(req.query.journey_id);
      conditions.push(
        `(result->'handoff'->>'journey_id' = $${params.length} OR payload->>'journey_id' = $${params.length})`
      );
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, title, result->'handoff' AS handoff
       FROM tasks
       WHERE ${conditions.join(' AND ')}
       ORDER BY (result->'handoff'->>'created_at') DESC NULLS LAST
       LIMIT $${params.length}`,
      params
    );
    const handoffs = rows.map((r) => {
      const h = r.handoff || {};
      return {
        task_id: h.task_id || r.id,
        title: h.title || r.title || '',
        verdict: h.verdict ?? null,
        journey_id: h.journey_id ?? null,
        created_at: h.created_at ?? null,
        next_steps: Array.isArray(h.next_steps) ? h.next_steps : [],
        pr_urls: Array.isArray(h.artifacts?.pr_urls) ? h.artifacts.pr_urls : [],
      };
    });
    res.json({ handoffs, total: handoffs.length });
  } catch (err) {
    console.error('[handoffs] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

挂载（`packages/brain/src/routes.js`）：import 区加
```js
import handoffsRouter from './routes/handoffs.js';
```
`router.use('/kr3', kr3Router);` 之后加：
```js
// 交接单只读流 — GET /handoffs（warroom 接力史，relay-baton4 item1）
router.use('/handoffs', handoffsRouter);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/handoffs-endpoint.test.js`
Expected: PASS（6 个用例全绿）

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/routes/handoffs.js packages/brain/src/routes.js
git commit -m "feat(brain): GET /api/brain/handoffs 交接单只读流（warroom 数据层）"
```

---

### Task 2: GET /api/brain/sentinel/health 路由

**Files:**
- Test: `packages/brain/src/routes/__tests__/sentinel-health.test.js`（新建）
- Create: `packages/brain/src/routes/sentinel.js`
- Modify: `packages/brain/src/routes.js`（import + `router.use('/sentinel', ...)`）

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/routes/__tests__/sentinel-health.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../sentinel.js');
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/brain/sentinel', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const jobRow = (name, over = {}) => ({
  key: `scheduler_job_last_run:${name}`,
  value_json: { at: '2026-07-07T00:00:00.000Z', ok: true },
  age_seconds: 60,
  ...over,
});
const expectedRow = (count) => ({
  key: 'scheduler_jobs_expected',
  value_json: { count },
  age_seconds: 3600,
});

describe('GET /api/brain/sentinel/health — 调度哨兵灯（relay-baton4 item1）', () => {
  beforeEach(() => mockQuery.mockReset());

  it('全部 job 新鲜且 ok → healthy=true，输出 name/ok/age_seconds/at', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [jobRow('arch-review'), jobRow('daily-backup'), expectedRow(2)],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.status).toBe(200);
    expect(res.body.expected).toBe(2);
    expect(res.body.healthy).toBe(true);
    expect(res.body.jobs).toHaveLength(2);
    const j = res.body.jobs.find((x) => x.name === 'arch-review');
    expect(j.ok).toBe(true);
    expect(j.age_seconds).toBe(60);
    expect(j.at).toBe('2026-07-07T00:00:00.000Z');
  });

  it('job 数少于 expected → healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [jobRow('arch-review'), expectedRow(5)] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('某 job age_seconds 超 1800 → healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [jobRow('arch-review', { age_seconds: 7200 }), expectedRow(1)],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('某 job ok=false（失败/超时）→ healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'scheduler_job_last_run:strategy-trigger', value_json: { at: 'x', ok: false, error: 'boom' }, age_seconds: 30 },
        expectedRow(1),
      ],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.healthy).toBe(false);
  });

  it('缺 scheduler_jobs_expected 键 → expected=null 且 healthy=false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [jobRow('arch-review')] });
    const res = await (await req())(await makeApp()).get('/api/brain/sentinel/health');
    expect(res.body.expected).toBeNull();
    expect(res.body.healthy).toBe(false);
  });

  it('age 由 SQL EXTRACT(EPOCH...) 计算（timestamp without time zone 不拿 JS 比）；DB 错误 → 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const app = await makeApp();
    await (await req())(app).get('/api/brain/sentinel/health');
    expect(mockQuery.mock.calls[0][0].toUpperCase()).toContain('EXTRACT(EPOCH FROM');
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const bad = await (await req())(app).get('/api/brain/sentinel/health');
    expect(bad.status).toBe(500);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/sentinel-health.test.js`
Expected: FAIL（Cannot find module '../sentinel.js'）

- [ ] **Step 3: commit-1（失败测试）**

```bash
git add packages/brain/src/routes/__tests__/sentinel-health.test.js
git commit -m "test: GET /api/brain/sentinel/health 失败测试（哨兵灯）"
```

- [ ] **Step 4: 最小实现**

```js
// packages/brain/src/routes/sentinel.js
/**
 * routes/sentinel.js — 调度哨兵健康只读口（relay-baton4 item1）
 *
 * GET /api/brain/sentinel/health
 *   读 working_memory 的 scheduler_job_last_run:* 键（scheduler-jobs.js 每 60s 写）
 *   与 scheduler_jobs_expected（{count}）比对。供 warroom「哨兵灯」板块。
 *   healthy 判定与体外死人开关（scripts/sentinel/dead-man-switch.sh）同源不同责：
 *   这里只读展示，不告警。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// 与 scheduler-jobs.js 的 SENTINEL_KEY_PREFIX 同一字面量（不 import，避免拖入 handler 依赖链）
const KEY_PREFIX = 'scheduler_job_last_run:';
const EXPECTED_KEY = 'scheduler_jobs_expected';
// 一轮 job 串行 worst case ~25min（见 scheduler-jobs.js 重入守卫注释），30min 为过期线
export const STALE_SECONDS = 1800;

router.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value_json, EXTRACT(EPOCH FROM (now() - updated_at))::int AS age_seconds
       FROM working_memory
       WHERE key LIKE $1 OR key = $2`,
      [`${KEY_PREFIX}%`, EXPECTED_KEY]
    );
    let expected = null;
    const jobs = [];
    for (const row of rows) {
      if (row.key === EXPECTED_KEY) {
        const c = parseInt(row.value_json?.count, 10);
        expected = Number.isFinite(c) ? c : null;
        continue;
      }
      const v = row.value_json || {};
      jobs.push({
        name: row.key.slice(KEY_PREFIX.length),
        ok: v.ok === true,
        age_seconds: row.age_seconds,
        at: v.at ?? null,
      });
    }
    const healthy =
      expected !== null &&
      jobs.length >= expected &&
      jobs.every((j) => j.ok && j.age_seconds <= STALE_SECONDS);
    res.json({ jobs, expected, healthy });
  } catch (err) {
    console.error('[sentinel] health error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

挂载（`packages/brain/src/routes.js`）：import 区加
```js
import sentinelRouter from './routes/sentinel.js';
```
`router.use('/handoffs', handoffsRouter);` 之后加：
```js
// 调度哨兵健康 — GET /sentinel/health（warroom 哨兵灯，relay-baton4 item1）
router.use('/sentinel', sentinelRouter);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/sentinel-health.test.js`
Expected: PASS（6 个用例全绿）

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/routes/sentinel.js packages/brain/src/routes.js
git commit -m "feat(brain): GET /api/brain/sentinel/health 调度哨兵灯（warroom 数据层）"
```

---

### Task 3: smoke 脚本 + 版本 bump + DevGate

**Files:**
- Create: `packages/brain/scripts/smoke/warroom-readonly-api-smoke.sh`
- Modify: `packages/brain/package.json`（1.238.6 → 1.239.0）
- Modify: `packages/brain/package-lock.json`（**两处**：顶层 version + `packages[""].version`）
- Modify: `.brain-versions`（末尾追加一行 `1.239.0`）
- Modify: `DEFINITION.md`（`**Brain 版本**: 1.239.0`）

- [ ] **Step 1: 写 smoke 脚本**（lint-feature-has-smoke 闸门要求：feat: + brain/src → 必须新增 smoke.sh；CI 兼容 = 静态结构断言，照 zombie-reaper-smoke.sh 先例）

```bash
#!/usr/bin/env bash
# Smoke: warroom-readonly-api — relay-baton4 item1
# 验证：
#   1. routes/handoffs.js 存在且为只读摘要路由（result.handoff 倒序 + artifacts.pr_urls 提取）
#   2. routes/sentinel.js 存在且哨兵键前缀与 scheduler-jobs.js 字面量一致
#   3. src/routes.js 已挂载两个新路由
set -euo pipefail

echo "[warroom-readonly-api-smoke] 1. handoffs.js 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/handoffs.js', 'utf8');
const checks = [
  [\"result ? 'handoff'\", '只取带 handoff 的 tasks'],
  [\"(result->'handoff'->>'created_at') DESC\", '按交接单时间倒序'],
  ['artifacts?.pr_urls', 'pr_urls 从 artifacts 提取'],
  [\"payload->>'journey_id'\", 'journey_id 过滤有 payload 兜底'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('缺少: ' + d)); process.exit(1); }
if (/INSERT|UPDATE|DELETE/i.test(src)) { console.error('FAIL: 出现写语句，违反只读约束'); process.exit(1); }
console.log('handoffs.js 结构正确 ✓');
"

echo "[warroom-readonly-api-smoke] 2. sentinel.js 结构 + 键前缀同步"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/sentinel.js', 'utf8');
const sched = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
const m = src.match(/KEY_PREFIX = '([^']+)'/);
if (!m) { console.error('FAIL: sentinel.js 未定义 KEY_PREFIX'); process.exit(1); }
if (!sched.includes(\"'\" + m[1] + \"'\")) { console.error('FAIL: KEY_PREFIX 与 scheduler-jobs.js 不一致'); process.exit(1); }
const checks = [
  ['scheduler_jobs_expected', '读 expected 键'],
  ['EXTRACT(EPOCH FROM', 'age 由 SQL 计算'],
  ['STALE_SECONDS', '过期阈值常量'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('缺少: ' + d)); process.exit(1); }
if (/INSERT|UPDATE|DELETE/i.test(src)) { console.error('FAIL: 出现写语句，违反只读约束'); process.exit(1); }
console.log('sentinel.js 结构正确 ✓');
"

echo "[warroom-readonly-api-smoke] 3. routes.js 已挂载"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes.js', 'utf8');
for (const p of [\"router.use('/handoffs', handoffsRouter)\", \"router.use('/sentinel', sentinelRouter)\"]) {
  if (!src.includes(p)) { console.error('FAIL: routes.js 缺少挂载: ' + p); process.exit(1); }
}
console.log('routes.js 挂载正确 ✓');
"

echo "[warroom-readonly-api-smoke] ✅ 全部通过"
```

写完 `chmod +x packages/brain/scripts/smoke/warroom-readonly-api-smoke.sh` 并跑一遍确认 PASS，再故意把 routes.js 挂载行断言改错跑一次确认会 FAIL（proven-to-fire）——确认后恢复。

- [ ] **Step 2: 版本 bump（minor：纯新增 API）**

```bash
cd packages/brain
npm version 1.239.0 --no-git-tag-version   # 同时改 package.json + package-lock.json 两处
cd ../..
echo "1.239.0" >> .brain-versions
# DEFINITION.md 第 9 行改为：**Brain 版本**: 1.239.0
```

- [ ] **Step 3: DevGate 三连**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node --check packages/brain/server.js
```
Expected: 三个全 ✅

- [ ] **Step 4: 全量单测回归**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/ 2>&1 | tail -5`
Expected: 新旧测试全绿

- [ ] **Step 5: commit**

```bash
git add packages/brain/scripts/smoke/warroom-readonly-api-smoke.sh packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): bump 1.239.0 + warroom-readonly-api smoke（版本四处同步）"
```

---

## Self-Review 结论

- Spec 覆盖：端点 1 → Task 1；端点 2 → Task 2；版本/门禁/smoke → Task 3；decisions/recent 跳过（spec 明示）✓
- 无占位符；类型/字段名前后一致（pr_urls 取 artifacts、expected 读 count、age SQL 算）✓
- 单一 PR 范围，无需再拆 ✓
