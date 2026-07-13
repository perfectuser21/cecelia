# [GP1/7] T1 golden_paths 底座 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新表 golden_paths（10 态状态机）+ 三个基础端点 + 保质期 delta 定时 job，全部带测试与 CI 两闸登记。

**Architecture:** 照设计 SSOT `docs/architecture/2026-07-12-golden-path-mode/architecture.md`（DDL 逐字段勿改）与 T1 设计文档 `docs/superpowers/specs/2026-07-12-gp1-golden-paths-foundation-design.md`（状态机流转表 / shelf-life 两规则）。migration 由 migrate.js 自动发现；route 挂 server.js `/api/brain` 前缀；job 照 receipt-collector 10min 自 gate 模式登记进 scheduler-jobs.js。

**Tech Stack:** Node.js (ESM) + express + pg + vitest + supertest（mock db）。

**工作目录：** 全部路径相对 worktree 根 `/Users/administrator/worktrees/cecelia/session-b9a12ca8`。

---

### Task 1: 失败测试先行（TDD commit-1）

**Files:**
- Test: `packages/brain/src/routes/__tests__/golden-paths.test.js`（新建）
- Test: `packages/brain/src/__tests__/gp-shelf-life.test.js`（新建）

- [ ] **Step 1: 写 routes 失败测试**

`packages/brain/src/routes/__tests__/golden-paths.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../golden-paths.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const GP_ROW = { id: 'gp-1', title: '朋友圈GP', one_liner: '一句话', status: 'candidate', source: 'strategist' };

describe('golden-paths routes（GP 蓝图级实体，区别于既有 golden_path FR 台账）', () => {
  beforeEach(() => mockQuery.mockReset());

  describe('GET /golden-paths', () => {
    it('无参返回全量列表', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GP_ROW] });
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths');
      expect(res.status).toBe(200);
      expect(res.body.golden_paths).toHaveLength(1);
      expect(mockQuery.mock.calls[0][0]).toMatch(/FROM golden_paths/);
    });

    it('?status= 过滤且参数化', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths?status=candidate');
      expect(res.status).toBe(200);
      expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE status = \$1/);
      expect(mockQuery.mock.calls[0][1]).toEqual(['candidate']);
    });

    it('非法 status 返回 400', async () => {
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths?status=bogus');
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('POST /golden-paths', () => {
    it('建 candidate 返回 201，默认 source=strategist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GP_ROW] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths')
        .send({ title: '朋友圈GP', one_liner: '一句话' });
      expect(res.status).toBe(201);
      expect(res.body.golden_path.status).toBe('candidate');
      expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO golden_paths/);
    });

    it('缺 title/one_liner 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths').send({ title: '只有标题' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('非法 source 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths')
        .send({ title: 't', one_liner: 'o', source: 'hacker' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /golden-paths/:id 状态机', () => {
    it('合法流转 candidate→proposed 返回 200', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'proposed' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'proposed' });
      expect(res.status).toBe(200);
      expect(res.body.golden_path.status).toBe('proposed');
    });

    it('非法流转 candidate→delivered 返回 409 INVALID_TRANSITION 且回传 allowed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'delivered' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(res.body.allowed).toEqual(['proposed', 'rejected', 'superseded', 'blocked_gate']);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('superseded 是终态，任何流转 409', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'superseded' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'candidate' });
      expect(res.status).toBe(409);
      expect(res.body.allowed).toEqual([]);
    });

    it('不存在返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/nope').send({ status: 'proposed' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GP_NOT_FOUND');
    });

    it('流转到 approved 自动注入 approved_at 与默认 review_after(+14d)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'converged' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'approved' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'approved' });
      expect(res.status).toBe(200);
      const updateSql = mockQuery.mock.calls[1][0];
      expect(updateSql).toMatch(/approved_at = now\(\)/);
      expect(updateSql).toMatch(/review_after = now\(\) \+ interval '14 days'/);
    });

    it('非状态字段更新（status_reason）不需要 status', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status_reason: 'x' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status_reason: 'x' });
      expect(res.status).toBe(200);
    });

    it('空 body 返回 400', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({});
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: 写 gp-shelf-life 失败测试**

`packages/brain/src/__tests__/gp-shelf-life.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGpShelfLife, __resetGpShelfLifeForTest } from '../gp-shelf-life.js';

function makePool(rowsList) {
  const query = vi.fn();
  for (const rows of rowsList) query.mockResolvedValueOnce({ rows });
  return { query };
}

describe('gp-shelf-life（保质期 delta + 报备否决窗自动生效）', () => {
  beforeEach(() => __resetGpShelfLifeForTest());

  it('10min 自 gate：间隔内第二次调用 skip', async () => {
    const pool = makePool([[], []]);
    await runGpShelfLife(pool);
    const second = await runGpShelfLife(pool);
    expect(second.skipped).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('规则1：approved 超 review_after → expired + status_reason（DoD F7）', async () => {
    const pool = makePool([[{ id: 'gp-1', title: 't' }], []]);
    const result = await runGpShelfLife(pool);
    expect(result.expired).toBe(1);
    const sql1 = pool.query.mock.calls[0][0];
    expect(sql1).toMatch(/SET status = 'expired'/);
    expect(sql1).toMatch(/status_reason/);
    expect(sql1).toMatch(/WHERE status = 'approved' AND review_after IS NOT NULL AND review_after < now\(\)/);
  });

  it('规则2：converged+auto_release 过 veto_deadline → 自动生效 approved 留痕（DoD F6, b416bfb3）', async () => {
    const pool = makePool([[], [{ id: 'gp-2', title: 't2' }]]);
    const result = await runGpShelfLife(pool);
    expect(result.autoReleased).toBe(1);
    const sql2 = pool.query.mock.calls[1][0];
    expect(sql2).toMatch(/SET status = 'approved', approved_at = now\(\), review_after = now\(\) \+ interval '14 days'/);
    expect(sql2).toMatch(/b416bfb3/);
    expect(sql2).toMatch(/WHERE status = 'converged' AND auto_release = true/);
    expect(sql2).toMatch(/veto_deadline IS NOT NULL AND veto_deadline < now\(\)/);
  });

  it('DB 错误 fail-open 不抛', async () => {
    const query = vi.fn().mockRejectedValue(new Error('db down'));
    const result = await runGpShelfLife({ query });
    expect(result.expired).toBe(0);
    expect(result.autoReleased).toBe(0);
  });
});
```

- [ ] **Step 3: 跑测试确认全红**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/golden-paths.test.js src/__tests__/gp-shelf-life.test.js`
Expected: FAIL（golden-paths.js / gp-shelf-life.js 模块不存在）

- [ ] **Step 4: Commit（commit-1，测试先行）**

```bash
git add packages/brain/src/routes/__tests__/golden-paths.test.js packages/brain/src/__tests__/gp-shelf-life.test.js
git commit -m "test(brain): GP1/T1 golden_paths 状态机+shelf-life 失败测试先行"
```

---

### Task 2: migration + routes 实现（commit-2 上半）

**Files:**
- Create: `packages/brain/migrations/334_golden_paths.sql`
- Create: `packages/brain/src/routes/golden-paths.js`
- Modify: `packages/brain/src/selfcheck.js:28`（`'333'`→`'334'`）
- Modify: `packages/brain/server.js`（~:81 import 区 + ~:363 挂载区）

- [ ] **Step 1: 写 migration（DDL 照 architecture.md 逐字段，仅加 IF NOT EXISTS/COMMENT 惯例）**

`packages/brain/migrations/334_golden_paths.sql`：

```sql
-- Migration 334: golden_paths — GP 蓝图级提案实体 + 生命周期状态机（GP loop T1）
-- 设计 SSOT: docs/architecture/2026-07-12-golden-path-mode/architecture.md（字段清单勿改）
-- 注意：与既有 golden_path（单数，任务级累积 FR 台账，migration 303）是两个实体，互不影响。

CREATE TABLE IF NOT EXISTS golden_paths (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  one_liner     text NOT NULL,
  journey_id    uuid REFERENCES journeys(id),
  kr_id         uuid,
  est_scale     text,
  status        text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','proposed','converged','approved','in_dev',
                      'delivered','expired','rejected','blocked_gate','superseded')),
  source        text NOT NULL DEFAULT 'strategist'
    CHECK (source IN ('strategist','alex_direct','capture_triage')),
  proposal_doc  text,
  demo_url      text,
  judgment_refs uuid[],
  findings_log  jsonb DEFAULT '[]',
  auto_release  boolean DEFAULT false,
  veto_deadline timestamptz,
  approved_at   timestamptz,
  review_after  timestamptz,
  status_reason text,
  proposal_task_id uuid REFERENCES tasks(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_golden_paths_status ON golden_paths(status);

COMMENT ON TABLE golden_paths IS 'GP 蓝图级提案实体（10 态生命周期状态机）——区别于 golden_path（任务级累积FR台账）';
COMMENT ON COLUMN golden_paths.auto_release IS '报备制（b416bfb3 五条件）：true 时走 24h 否决窗';
COMMENT ON COLUMN golden_paths.review_after IS '保质期：默认 approved_at + 14 天，超期未 in_dev 由 gp-shelf-life 置 expired';
```

- [ ] **Step 2: 改 selfcheck.js**

`packages/brain/src/selfcheck.js:28`：`export const EXPECTED_SCHEMA_VERSION = '333';` → `'334'`

- [ ] **Step 3: 写 route**

`packages/brain/src/routes/golden-paths.js`：

```js
// golden_paths（GP 蓝图级提案实体）基础端点——GP loop T1
// select/approve/veto 三个拍板端点在 T7，不在本文件。
// 既有 /golden_path（单数下划线，routes/abilities.js，任务级 FR 台账）是另一实体。
import express from 'express';
import pool from '../db.js';

const router = express.Router();

export const GP_STATUSES = ['candidate', 'proposed', 'converged', 'approved', 'in_dev',
  'delivered', 'expired', 'rejected', 'blocked_gate', 'superseded'];
export const GP_SOURCES = ['strategist', 'alex_direct', 'capture_triage'];

// 状态机流转白名单（活清单原则：任何状态可捞回，superseded 终态）
export const ALLOWED_TRANSITIONS = {
  candidate:    ['proposed', 'rejected', 'superseded', 'blocked_gate'],
  proposed:     ['converged', 'rejected', 'superseded', 'blocked_gate'],
  converged:    ['approved', 'rejected', 'superseded', 'blocked_gate'],
  approved:     ['in_dev', 'expired', 'converged', 'superseded', 'blocked_gate'],
  in_dev:       ['delivered', 'superseded', 'blocked_gate'],
  expired:      ['converged', 'superseded', 'blocked_gate'],
  rejected:     ['candidate', 'superseded'],
  blocked_gate: ['candidate', 'proposed', 'converged', 'approved', 'in_dev', 'superseded'],
  delivered:    ['superseded'],
  superseded:   []
};

const PATCHABLE_FIELDS = ['one_liner', 'est_scale', 'proposal_doc', 'demo_url', 'judgment_refs',
  'findings_log', 'auto_release', 'veto_deadline', 'review_after', 'status_reason', 'proposal_task_id'];

router.get('/golden-paths', async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !GP_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `invalid status: ${status}` });
    }
    const { rows } = status
      ? await pool.query('SELECT * FROM golden_paths WHERE status = $1 ORDER BY created_at DESC', [status])
      : await pool.query('SELECT * FROM golden_paths ORDER BY created_at DESC');
    res.json({ success: true, golden_paths: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/golden-paths', async (req, res) => {
  try {
    const { title, one_liner, journey_id, kr_id, est_scale, source, proposal_doc } = req.body || {};
    if (!title || !one_liner) {
      return res.status(400).json({ success: false, error: 'title 和 one_liner 必填' });
    }
    if (source && !GP_SOURCES.includes(source)) {
      return res.status(400).json({ success: false, error: `invalid source: ${source}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO golden_paths (title, one_liner, journey_id, kr_id, est_scale, source, proposal_doc)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'strategist'), $7)
       RETURNING *`,
      [title, one_liner, journey_id || null, kr_id || null, est_scale || null, source || null, proposal_doc || null]
    );
    res.status(201).json({ success: true, golden_path: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/golden-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { rows: cur } = await pool.query('SELECT status FROM golden_paths WHERE id = $1', [id]);
    if (cur.length === 0) {
      return res.status(404).json({ success: false, error: 'golden_path not found', code: 'GP_NOT_FOUND' });
    }
    const currentStatus = cur[0].status;

    const sets = [];
    const vals = [];
    let i = 1;

    if (body.status !== undefined) {
      if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(body.status)) {
        return res.status(409).json({
          success: false,
          error: 'Invalid status transition',
          code: 'INVALID_TRANSITION',
          current_status: currentStatus,
          requested_status: body.status,
          allowed: ALLOWED_TRANSITIONS[currentStatus] || []
        });
      }
      sets.push(`status = $${i++}`);
      vals.push(body.status);
      if (body.status === 'approved') {
        sets.push(`approved_at = now()`);
        if (body.review_after === undefined) sets.push(`review_after = now() + interval '14 days'`);
      }
    }
    for (const f of PATCHABLE_FIELDS) {
      if (body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(f === 'findings_log' ? JSON.stringify(body[f]) : body[f]);
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, error: '无可更新字段' });
    }
    sets.push('updated_at = now()');
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE golden_paths SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    res.json({ success: true, golden_path: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
```

- [ ] **Step 4: server.js 挂载**

在 `packages/brain/server.js` import 区（abilitiesRouter 那行后）加：
```js
import goldenPathsRouter from './src/routes/golden-paths.js';
```
在挂载区（`app.use('/api/brain', abilitiesRouter);` 后）加：
```js
app.use('/api/brain', goldenPathsRouter);
```

- [ ] **Step 5: 跑 routes 测试确认绿**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/golden-paths.test.js`
Expected: PASS 全绿

---

### Task 3: gp-shelf-life job + scheduler 登记（commit-2 下半）

**Files:**
- Create: `packages/brain/src/gp-shelf-life.js`
- Modify: `packages/brain/src/scheduler-jobs.js`（:20 import 区 + :27-40 JOBS 数组）

- [ ] **Step 1: 写 job**

`packages/brain/src/gp-shelf-life.js`：

```js
// GP 保质期 delta job（GP loop T1，DoD F6/F7）——照 receipt-collector.js 10min 自 gate 模式
// 只 import 不依赖任何模块；严禁 import notifier/alerting（防环）。全路径 fail-open。
const INTERVAL_MS = parseInt(
  process.env.CECELIA_GP_SHELF_LIFE_INTERVAL_MS || String(10 * 60 * 1000),
  10
);
let lastRunAt = 0;
export function __resetGpShelfLifeForTest() { lastRunAt = 0; }

export async function runGpShelfLife(dbPool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, expired: 0, autoReleased: 0 };
  lastRunAt = now;

  let expired = 0;
  let autoReleased = 0;
  try {
    // 规则1（DoD F7）：保质期——approved 超 review_after 未开工 → expired（重上批审段）
    const r1 = await dbPool.query(
      `UPDATE golden_paths
       SET status = 'expired',
           status_reason = '保质期过期：approved 超 review_after 未开工（delta）',
           updated_at = now()
       WHERE status = 'approved' AND review_after IS NOT NULL AND review_after < now()
       RETURNING id, title`
    );
    expired = r1.rows.length;
    if (expired > 0) {
      console.warn(`[gp-shelf-life] ${expired} 条 approved GP 保质期过期置 expired: ${r1.rows.map(r => r.id).join(',')}`);
    }

    // 规则2（DoD F6）：报备否决窗——converged+auto_release 过 veto_deadline 未否决 → 自动生效 approved 留痕
    const r2 = await dbPool.query(
      `UPDATE golden_paths
       SET status = 'approved', approved_at = now(), review_after = now() + interval '14 days',
           status_reason = '报备制自动生效：24h 否决窗过期无否决（b416bfb3）',
           updated_at = now()
       WHERE status = 'converged' AND auto_release = true
         AND veto_deadline IS NOT NULL AND veto_deadline < now()
       RETURNING id, title`
    );
    autoReleased = r2.rows.length;
    if (autoReleased > 0) {
      console.warn(`[gp-shelf-life] ${autoReleased} 条报备 GP 否决窗过期自动生效 approved: ${r2.rows.map(r => r.id).join(',')}`);
    }
  } catch (err) {
    console.warn('[gp-shelf-life] 检查失败（fail-open）:', err.message);
  }
  return { expired, autoReleased };
}
```

- [ ] **Step 2: scheduler-jobs.js 登记**

import 区加：
```js
import { runGpShelfLife } from './gp-shelf-life.js';
```
JOBS 数组（receipt-collector 条目后）加：
```js
{ name: 'gp-shelf-life', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runGpShelfLife, description: 'GP 保质期 delta（自带10min gate，approved 超 review_after 置 expired；报备否决窗过期自动生效，GP1/T1）' },
```

- [ ] **Step 3: 跑 shelf-life 测试确认绿 + scheduler-jobs 既有测试不破**

Run: `cd packages/brain && npx vitest run src/__tests__/gp-shelf-life.test.js src/__tests__/scheduler-jobs.test.js`（后者若存在）
Expected: PASS

- [ ] **Step 4: Commit（commit-2，实现变绿）**

```bash
git add packages/brain/migrations/334_golden_paths.sql packages/brain/src/routes/golden-paths.js \
  packages/brain/src/gp-shelf-life.js packages/brain/src/scheduler-jobs.js \
  packages/brain/src/selfcheck.js packages/brain/server.js
git commit -m "feat(brain): GP1/T1 golden_paths 底座——新表+状态机端点+保质期delta job"
```

---

### Task 4: smoke 脚本 + allowlist 登记（CI 闸1）

**Files:**
- Create: `packages/brain/scripts/smoke/golden-paths-t1-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`（追加一行）

- [ ] **Step 1: 先读既有样例定环境约定**

Run: `cat packages/brain/scripts/smoke/t4-receipt-collector-smoke.sh`
照它的 env/端口/psql 约定写新脚本（BRAIN_URL、DATABASE_URL 等变量名保持一致）。

- [ ] **Step 2: 写 smoke 脚本（骨架，按 Step 1 实际约定调整变量）**

`packages/brain/scripts/smoke/golden-paths-t1-smoke.sh`（DoD F1 全链）：

```bash
#!/usr/bin/env bash
# GP1/T1 smoke：golden_paths 表存在 + 非法状态 INSERT 被 CHECK 拒 + 三端点全链（DoD F1）
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PSQL="${PSQL:-psql "$DATABASE_URL"}"

# 1. 表存在 + 非法状态被 CHECK 拒
$PSQL -c "SELECT 1 FROM golden_paths LIMIT 0" >/dev/null
if $PSQL -c "INSERT INTO golden_paths (title, one_liner, status) VALUES ('bad', 'bad', 'bogus')" 2>/dev/null; then
  echo "❌ 非法状态 INSERT 未被 CHECK 拒"; exit 1
fi

# 2. POST 建 candidate
GP_ID=$(curl -sf -X POST "$BRAIN_URL/api/brain/golden-paths" -H "Content-Type: application/json" \
  -d '{"title":"smoke GP","one_liner":"smoke 用例"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).golden_path.id))")
[ -n "$GP_ID" ]

# 3. GET 过滤可见
curl -sf "$BRAIN_URL/api/brain/golden-paths?status=candidate" | grep -q "$GP_ID"

# 4. PATCH 合法流转 200 / 非法流转 409
curl -sf -X PATCH "$BRAIN_URL/api/brain/golden-paths/$GP_ID" -H "Content-Type: application/json" -d '{"status":"proposed"}' >/dev/null
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BRAIN_URL/api/brain/golden-paths/$GP_ID" -H "Content-Type: application/json" -d '{"status":"delivered"}')
[ "$HTTP" = "409" ] || { echo "❌ 非法流转应 409，得 $HTTP"; exit 1; }

# 清理
$PSQL -c "DELETE FROM golden_paths WHERE id = '$GP_ID'"
echo "✅ golden-paths-t1-smoke PASS"
```

`chmod +x` 该脚本。

- [ ] **Step 3: 登记 allowlist**

`packages/quality/smoke-allowlist.txt` 追加一行：`golden-paths-t1-smoke.sh`

- [ ] **Step 4: 本地语法冒烟**

Run: `bash -n packages/brain/scripts/smoke/golden-paths-t1-smoke.sh && node --check packages/brain/src/routes/golden-paths.js && node --check packages/brain/src/gp-shelf-life.js && node --check packages/brain/server.js`
Expected: 无输出（全过）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/smoke/golden-paths-t1-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "test(brain): GP1/T1 smoke 全链脚本+allowlist 登记（棘轮闸）"
```

---

### Task 5: DevGate + 版本 bump + 全量验证

**Files:**
- Modify: `packages/brain/package.json` + `package-lock.json` + `.brain-versions` + `DEFINITION.md:9`（版本四处，minor bump）

- [ ] **Step 1: 版本 bump（minor，新功能）**

```bash
cd packages/brain && npm version minor --no-git-tag-version && cd ../..
NEW_V=$(node -p "require('./packages/brain/package.json').version")
echo "$NEW_V" >> .brain-versions
# DEFINITION.md「Brain 版本」行同步改为 $NEW_V
```

- [ ] **Step 2: DevGate 三连**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全过。facts-check 若因 EXPECTED_SCHEMA_VERSION/版本变化报错，按其提示同步 DEFINITION.md。

- [ ] **Step 3: 相关测试全量**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/golden-paths.test.js src/__tests__/gp-shelf-life.test.js`
（不跑全量 brain vitest——环境级 OOM 已知，交给 CI。）
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): version bump（GP1/T1 golden_paths 底座）"
```
