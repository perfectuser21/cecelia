# Acceptance 刀 1：Brain 验收公网端点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain 新增验收两表 + 内网建单端点 + 独立 5223 公网 listener（pending 拉取 / results 回写），为 Notion Worker 验收闭环提供 SSOT 地基。

**Architecture:** migration 369 建 acceptance_runs/acceptance_checks；`src/routes/acceptance.js` 工厂注入 pool 导出内网/公网两个 router；`src/acceptance-public-server.js` 独立 express app（Bearer timingSafeEqual fail-closed + 限流）listen 5223；server.js 挂内网 router 并在主 listen 后启动公网 listener。

**Tech Stack:** Node ESM + express + pg pool（工厂注入）+ vitest + supertest + express-rate-limit（已有依赖）。

**Spec:** `docs/superpowers/specs/2026-07-29-acceptance-brain-endpoints-design.md`

**死规矩：**
- 本地验 migration 必须 `DB_NAME=cecelia_scratch`，严禁裸跑（会打进生产库，07-17 有实弹事故）
- TDD：每个 Task commit-1 = 红测试，commit-2 = 绿实现
- 所有输出简体中文

---

### Task 1: Migration 369 两张验收表

**Files:**
- Create: `packages/brain/migrations/369_acceptance_tables.sql`

- [ ] **Step 1: 写 migration 文件**

```sql
-- Migration 369: acceptance_runs / acceptance_checks — Notion Worker 验收闭环 SSOT（Acceptance 刀 1）

CREATE TABLE IF NOT EXISTS acceptance_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  gp_id TEXT,
  line TEXT,
  surface TEXT,
  version TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','passed','failed')),
  pass_rate NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','harness')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS acceptance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES acceptance_runs(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('FR','NFR','Invariant','SOP')),
  name TEXT NOT NULL,
  device TEXT,
  result TEXT CHECK (result IN ('通过','不通过','无法验证')),
  note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acceptance_checks_run ON acceptance_checks(run_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_runs_status ON acceptance_runs(status, created_at);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('369', 'Acceptance runs/checks tables for Notion Worker loop', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 在 scratch 库验证**

```bash
createdb -U cecelia cecelia_scratch 2>/dev/null || true
cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js
DB_NAME=cecelia_scratch psql -U cecelia -d cecelia_scratch -c "\d acceptance_runs" -c "\d acceptance_checks"
```

Expected: 两表结构完整输出，schema_version 含 369。

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/369_acceptance_tables.sql
git commit -m "feat(brain): migration 369 acceptance_runs/acceptance_checks 两表"
```

---

### Task 2: 内网 router — POST /runs 幂等建单 + GET /runs/:run_key

**Files:**
- Create: `packages/brain/src/routes/acceptance.js`
- Test: `packages/brain/src/routes/__tests__/acceptance-internal.test.js`

- [ ] **Step 1: 写 failing test**

```js
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAcceptanceInternalRouter } from '../acceptance.js';

function makeApp(pool) {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

function makeClient(scripts) {
  // scripts: (sql, params) => result | undefined；未匹配返回空 rows
  const query = vi.fn(async (sql, params) => scripts(sql, params) ?? { rows: [] });
  return { query, release: vi.fn() };
}

function makePool(client) {
  return { connect: vi.fn(async () => client), query: vi.fn() };
}

const RUN_ROW = { id: 'run-uuid-1', run_key: 'r1', title: 'T', status: 'pending' };

describe('POST /api/brain/acceptance/runs', () => {
  it('建新单：201，checks 生成 check_key 序号', async () => {
    const inserted = [];
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT * FROM acceptance_runs WHERE run_key')) return { rows: [] };
      if (sql.includes('INSERT INTO acceptance_runs')) return { rows: [RUN_ROW] };
      if (sql.includes('INSERT INTO acceptance_checks')) {
        inserted.push(params[1]);
        return { rows: [{ id: `c-${inserted.length}`, check_key: params[1], kind: params[2], name: params[3] }] };
      }
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/runs')
      .send({ run_key: 'r1', title: 'T', checks: [
        { kind: 'FR', name: 'step1' },
        { kind: 'NFR', name: 'latency' },
      ] });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(inserted).toEqual(['r1:001', 'r1:002']);
  });

  it('重复 run_key：200 返回现有单，不覆盖', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT * FROM acceptance_runs WHERE run_key')) return { rows: [RUN_ROW] };
      if (sql.includes('SELECT * FROM acceptance_checks WHERE run_id')) return { rows: [{ check_key: 'r1:001' }] };
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/runs')
      .send({ run_key: 'r1', title: 'T', checks: [{ kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
  });

  it('缺 run_key/title → 400', async () => {
    const res = await request(makeApp(makePool(makeClient(() => undefined))))
      .post('/api/brain/acceptance/runs').send({ title: 'T', checks: [{ kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(400);
  });

  it('checks 空数组 → 400', async () => {
    const res = await request(makeApp(makePool(makeClient(() => undefined))))
      .post('/api/brain/acceptance/runs').send({ run_key: 'r1', title: 'T', checks: [] });
    expect(res.status).toBe(400);
  });

  it('kind 非法 → 400', async () => {
    const res = await request(makeApp(makePool(makeClient(() => undefined))))
      .post('/api/brain/acceptance/runs').send({ run_key: 'r1', title: 'T', checks: [{ kind: 'XX', name: 'x' }] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/brain/acceptance/runs/:run_key', () => {
  it('存在 → 200 带 checks；不存在 → 404', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT * FROM acceptance_runs WHERE run_key')) return { rows: [RUN_ROW] };
      if (sql.includes('SELECT * FROM acceptance_checks WHERE run_id')) return { rows: [{ check_key: 'r1:001' }] };
    });
    const ok = await request(makeApp(makePool(client))).get('/api/brain/acceptance/runs/r1');
    expect(ok.status).toBe(200);
    expect(ok.body.checks).toHaveLength(1);

    const miss = makeClient(() => ({ rows: [] }));
    const nf = await request(makeApp(makePool(miss))).get('/api/brain/acceptance/runs/none');
    expect(nf.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/acceptance-internal.test.js`
Expected: FAIL（acceptance.js 不存在）

- [ ] **Step 3: commit 红测试**

```bash
git add packages/brain/src/routes/__tests__/acceptance-internal.test.js
git commit -m "test(brain): acceptance 内网建单端点 failing tests (Red)"
```

- [ ] **Step 4: 写实现**

`packages/brain/src/routes/acceptance.js`：

```js
/**
 * Acceptance 验收端点（刀 1）— Notion Worker 闭环 SSOT
 * 内网 router：建单/查单（挂 5221 /api/brain/acceptance）
 * 公网 router：pending 拉取 / results 回写（挂 5223，见 acceptance-public-server.js）
 */
import express from 'express';

export const ACCEPTANCE_KINDS = ['FR', 'NFR', 'Invariant', 'SOP'];
export const ACCEPTANCE_RESULTS = ['通过', '不通过', '无法验证'];
const SOURCES = ['manual', 'harness'];

async function loadChecks(q, runId) {
  const { rows } = await q.query(
    'SELECT * FROM acceptance_checks WHERE run_id = $1 ORDER BY check_key',
    [runId]
  );
  return rows;
}

export function createAcceptanceInternalRouter({ pool }) {
  const router = express.Router();

  router.post('/runs', async (req, res) => {
    const { run_key, title, gp_id, line, surface, version, source = 'manual', checks } = req.body || {};
    if (!run_key || !title) return res.status(400).json({ error: 'run_key and title are required' });
    if (!Array.isArray(checks) || checks.length === 0) {
      return res.status(400).json({ error: 'checks must be a non-empty array' });
    }
    for (const [i, c] of checks.entries()) {
      if (!c || !c.name) return res.status(400).json({ error: `checks[${i}].name is required` });
      if (!ACCEPTANCE_KINDS.includes(c.kind)) {
        return res.status(400).json({ error: `checks[${i}].kind must be one of: ${ACCEPTANCE_KINDS.join(',')}` });
      }
    }
    if (!SOURCES.includes(source)) return res.status(400).json({ error: `source must be one of: ${SOURCES.join(',')}` });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM acceptance_runs WHERE run_key = $1', [run_key]);
      if (existing.rows.length > 0) {
        const existingChecks = await loadChecks(client, existing.rows[0].id);
        await client.query('COMMIT');
        return res.status(200).json({ run: existing.rows[0], checks: existingChecks, created: false });
      }
      const { rows: runRows } = await client.query(
        `INSERT INTO acceptance_runs (run_key, title, gp_id, line, surface, version, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [run_key, title, gp_id || null, line || null, surface || null, version || null, source]
      );
      const run = runRows[0];
      const createdChecks = [];
      for (let i = 0; i < checks.length; i++) {
        const c = checks[i];
        const checkKey = `${run_key}:${String(i + 1).padStart(3, '0')}`;
        const { rows } = await client.query(
          `INSERT INTO acceptance_checks (run_id, check_key, kind, name, device)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [run.id, checkKey, c.kind, c.name, c.device || null]
        );
        createdChecks.push(rows[0]);
      }
      await client.query('COMMIT');
      return res.status(201).json({ run, checks: createdChecks, created: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[acceptance] POST /runs error:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  router.get('/runs/:run_key', async (req, res) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT * FROM acceptance_runs WHERE run_key = $1', [req.params.run_key]);
      if (rows.length === 0) return res.status(404).json({ error: 'run not found' });
      const checks = await loadChecks(client, rows[0].id);
      return res.json({ run: rows[0], checks });
    } catch (err) {
      console.error('[acceptance] GET /runs/:run_key error:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  return router;
}
```

- [ ] **Step 5: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/acceptance-internal.test.js`
Expected: PASS 全绿

- [ ] **Step 6: commit 实现**

```bash
git add packages/brain/src/routes/acceptance.js
git commit -m "feat(brain): acceptance 内网建单/查单端点 (Green)"
```

---

### Task 3: 公网 router — GET /acceptance/pending + POST /acceptance/results（重算）

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`（追加 createAcceptancePublicRouter）
- Test: `packages/brain/src/routes/__tests__/acceptance-public.test.js`

- [ ] **Step 1: 写 failing test**

```js
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAcceptancePublicRouter } from '../acceptance.js';

function makeApp(pool) {
  const app = express();
  app.use(express.json());
  app.use(createAcceptancePublicRouter({ pool }));
  return app;
}

function makeClient(scripts) {
  const query = vi.fn(async (sql, params) => scripts(sql, params) ?? { rows: [] });
  return { query, release: vi.fn() };
}

describe('GET /acceptance/pending', () => {
  it('返回 pending/in_review 的 runs 各带 checks', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM acceptance_runs')) {
          return { rows: [{ id: 'A', run_key: 'r1', status: 'pending' }] };
        }
        if (sql.includes('FROM acceptance_checks')) {
          return { rows: [{ run_id: 'A', check_key: 'r1:001', result: null }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool)).get('/acceptance/pending');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].checks).toHaveLength(1);
  });
});

describe('POST /acceptance/results', () => {
  it('result 枚举非法 → 400 整批拒绝', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [{ check_key: 'r1:001', result: 'yes' }] });
    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('未知 check_key → 400 列出 missing，事务回滚', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:999', result: '通过' },
      ] });
    expect(res.status).toBe(400);
    expect(res.body.missing).toEqual(['r1:999']);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('合法批次：落库 + 重算 pass_rate/status（全判有挂 → failed）', async () => {
    const updates = [];
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }, { check_key: 'r1:002', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) { updates.push(params); return { rows: [] }; }
      if (sql.includes('FILTER')) {
        return { rows: [{ total: 2, pass: 1, fail: 1, pending: 0 }] };
      }
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:002', result: '不通过', note: 'step8 挂了' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.runs[0].status).toBe('failed');
    expect(res.body.runs[0].pass_rate).toBe(0.5);
    expect(updates).toHaveLength(2);
  });

  it('还有未判项 → status=in_review', async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) return { rows: [] };
      if (sql.includes('FILTER')) return { rows: [{ total: 3, pass: 1, fail: 0, pending: 2 }] };
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [{ check_key: 'r1:001', result: '通过' }] });
    expect(res.status).toBe(200);
    expect(res.body.runs[0].status).toBe('in_review');
  });

  it('results 空/非数组 → 400', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool)).post('/acceptance/results').send({ results: [] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/acceptance-public.test.js`
Expected: FAIL（createAcceptancePublicRouter 未导出）

- [ ] **Step 3: commit 红测试**

```bash
git add packages/brain/src/routes/__tests__/acceptance-public.test.js
git commit -m "test(brain): acceptance 公网 pending/results failing tests (Red)"
```

- [ ] **Step 4: 在 acceptance.js 追加实现**

```js
export function createAcceptancePublicRouter({ pool }) {
  const router = express.Router();

  router.get('/acceptance/pending', async (_req, res) => {
    try {
      const { rows: runs } = await pool.query(
        `SELECT * FROM acceptance_runs WHERE status IN ('pending','in_review') ORDER BY created_at`
      );
      const ids = runs.map((r) => r.id);
      let checkRows = [];
      if (ids.length > 0) {
        const { rows } = await pool.query(
          'SELECT * FROM acceptance_checks WHERE run_id = ANY($1) ORDER BY check_key',
          [ids]
        );
        checkRows = rows;
      }
      const byRun = new Map(runs.map((r) => [r.id, { ...r, checks: [] }]));
      for (const c of checkRows) byRun.get(c.run_id)?.checks.push(c);
      return res.json({ runs: [...byRun.values()] });
    } catch (err) {
      console.error('[acceptance] GET /pending error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/acceptance/results', async (req, res) => {
    const { results } = req.body || {};
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results must be a non-empty array' });
    }
    const invalid = [];
    for (const [i, r] of results.entries()) {
      if (!r || !r.check_key) invalid.push({ index: i, error: 'check_key required' });
      else if (!ACCEPTANCE_RESULTS.includes(r.result)) {
        invalid.push({ index: i, check_key: r.check_key, error: `result must be one of: ${ACCEPTANCE_RESULTS.join(',')}` });
      }
    }
    if (invalid.length > 0) return res.status(400).json({ error: 'invalid results', invalid });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const keys = results.map((r) => r.check_key);
      const { rows: found } = await client.query(
        'SELECT check_key, run_id FROM acceptance_checks WHERE check_key = ANY($1)',
        [keys]
      );
      const foundKeys = new Set(found.map((r) => r.check_key));
      const missing = keys.filter((k) => !foundKeys.has(k));
      if (missing.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'unknown check_key', missing });
      }
      for (const r of results) {
        await client.query(
          `UPDATE acceptance_checks SET result = $1, note = $2, decided_at = NOW(), updated_at = NOW()
           WHERE check_key = $3`,
          [r.result, r.note || null, r.check_key]
        );
      }
      const runIds = [...new Set(found.map((r) => r.run_id))];
      const updatedRuns = [];
      for (const runId of runIds) {
        const { rows: counts } = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE result = '通过')::int AS pass,
                  COUNT(*) FILTER (WHERE result = '不通过')::int AS fail,
                  COUNT(*) FILTER (WHERE result IS NULL)::int AS pending
             FROM acceptance_checks WHERE run_id = $1`,
          [runId]
        );
        const { total, pass, fail, pending } = counts[0];
        const passRate = total > 0 ? pass / total : 0;
        const status = pending > 0 ? 'in_review' : fail > 0 ? 'failed' : pass === total ? 'passed' : 'in_review';
        const { rows: updated } = await client.query(
          `UPDATE acceptance_runs SET pass_rate = $1, status = $2, updated_at = NOW()
           WHERE id = $3 RETURNING run_key, pass_rate, status`,
          [passRate, status, runId]
        );
        updatedRuns.push(updated[0]);
      }
      await client.query('COMMIT');
      return res.json({ updated: results.length, runs: updatedRuns });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[acceptance] POST /results error:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  return router;
}
```

注意：测试断言 `pass_rate` 为数字 0.5——UPDATE 参数 `passRate` 直接传 JS number，mock 里 params[0] 原样返回即数字；真库里 NUMERIC 列读回是字符串，integration 测试断言时用 `Number()` 转换。

- [ ] **Step 5: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/acceptance-public.test.js`
Expected: PASS 全绿

- [ ] **Step 6: commit 实现**

```bash
git add packages/brain/src/routes/acceptance.js
git commit -m "feat(brain): acceptance 公网 pending/results 端点 + 通过率重算 (Green)"
```

---

### Task 4: 公网 listener — Bearer 鉴权（fail-closed）+ 独立 app

**Files:**
- Create: `packages/brain/src/acceptance-public-server.js`
- Test: `packages/brain/src/__tests__/acceptance-public-server.test.js`

- [ ] **Step 1: 写 failing test**

```js
import request from 'supertest';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createAcceptancePublicApp, createBearerAuth, startAcceptancePublicServer } from '../acceptance-public-server.js';

const TOKEN = 'test-token-abc';

function makePool() {
  return { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() };
}

describe('createAcceptancePublicApp 鉴权', () => {
  it('无 Authorization → 401', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending');
    expect(res.status).toBe(401);
  });

  it('错 token → 401', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('对 token → 200 进入业务路由', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it('未知路径 → 404（即使带对 token）', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/api/brain/tasks')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe('startAcceptancePublicServer fail-closed', () => {
  afterEach(() => { delete process.env.ACCEPTANCE_API_TOKEN; });

  it('ACCEPTANCE_API_TOKEN 未配置 → 返回 null 不监听', () => {
    delete process.env.ACCEPTANCE_API_TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    expect(server).toBeNull();
  });

  it('配置了 token → 返回 server 并监听', async () => {
    process.env.ACCEPTANCE_API_TOKEN = TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    expect(server).not.toBeNull();
    await new Promise((r) => server.close(r));
  });
});

describe('安全加固', () => {
  it('createBearerAuth 空/缺 token → throw', () => {
    expect(() => createBearerAuth('')).toThrow();
    expect(() => createBearerAuth(undefined)).toThrow();
  });

  it('malformed JSON（带对 token）→ 400 bad request 不泄堆栈', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .post('/acceptance/results')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad request' });
  });

  it('响应不带 x-powered-by 指纹', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('无 token 的 POST 大 body → 401（json 解析在鉴权之后）', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .post('/acceptance/results')
      .send({ results: Array.from({ length: 100 }, (_, i) => ({ check_key: `k${i}`, result: '通过' })) });
    expect(res.status).toBe(401);
  });

  it('listener 默认绑定 127.0.0.1', async () => {
    process.env.ACCEPTANCE_API_TOKEN = TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    await new Promise((r) => server.on('listening', r));
    expect(server.address().address).toBe('127.0.0.1');
    await new Promise((r) => server.close(r));
    delete process.env.ACCEPTANCE_API_TOKEN;
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/acceptance-public-server.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: commit 红测试**

```bash
git add packages/brain/src/__tests__/acceptance-public-server.test.js
git commit -m "test(brain): acceptance 公网 listener 鉴权 failing tests (Red)"
```

- [ ] **Step 4: 写实现**

`packages/brain/src/acceptance-public-server.js`：

```js
/**
 * Acceptance 公网 listener（5223）— 只挂 pending/results 两个端点
 * fail-closed：ACCEPTANCE_API_TOKEN 未配置则不启动
 * 决策 c08c2173：禁止把 5221 Brain API 整体暴露公网
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createAcceptancePublicRouter } from './routes/acceptance.js';

export function createBearerAuth(expectedToken) {
  if (!expectedToken || typeof expectedToken !== 'string') {
    throw new Error('createBearerAuth: expectedToken is required');
  }
  const expectedBuf = Buffer.from(expectedToken);
  return function bearerAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const givenBuf = Buffer.from(given);
    const ok = expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf);
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
    return next();
  };
}

export function createAcceptancePublicApp({ pool, token }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);  // 本机 cloudflared 一层反代，req.ip 取真实客户端 IP
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(createBearerAuth(token));
  app.use(express.json({ limit: '1mb' }));
  app.use(createAcceptancePublicRouter({ pool }));
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed' || err?.status === 400) {
      return res.status(400).json({ error: 'bad request' });
    }
    console.error('[acceptance-public] unhandled error:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

export function startAcceptancePublicServer({ pool, port }) {
  const token = process.env.ACCEPTANCE_API_TOKEN;
  if (!token) {
    console.log('[acceptance-public] ACCEPTANCE_API_TOKEN 未配置，公网 listener 不启动（fail-closed）');
    return null;
  }
  const app = createAcceptancePublicApp({ pool, token });
  const server = createServer(app);
  server.on('error', (err) => console.error('[acceptance-public][ALERT] listener error:', err.message));
  const host = process.env.ACCEPTANCE_PUBLIC_HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`[acceptance-public] listening on ${host}:${port}（仅 /acceptance/pending 与 /acceptance/results）`);
  });
  return server;
}
```

**中间件顺序是安全约束，不是风格**：限流 → 鉴权 → JSON 解析。JSON 解析放在鉴权之后，未认证请求才不会消耗解析开销；限流放在最前，未带 token 的暴力猜测同样被限流。错误兜底必须是最后一个 `app.use`（4 参数签名），否则 malformed JSON 会走 express 默认处理器泄漏堆栈。

- [ ] **Step 5: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/acceptance-public-server.test.js`
Expected: PASS 全绿

- [ ] **Step 6: commit 实现**

```bash
git add packages/brain/src/acceptance-public-server.js
git commit -m "feat(brain): acceptance 独立公网 listener + Bearer fail-closed 鉴权 (Green)"
```

---

### Task 5: server.js 接线 + 部署文档

**Files:**
- Modify: `packages/brain/server.js`（两处：内网 router 挂载段 + 主 listen 之后）
- Create: `docs/current/acceptance-endpoint-deploy.md`

- [ ] **Step 1: server.js 加 import（与其他 routes import 放一起，约 85 行区域）**

```js
import { createAcceptanceInternalRouter } from './src/routes/acceptance.js';
import { startAcceptancePublicServer } from './src/acceptance-public-server.js';
```

- [ ] **Step 2: 挂内网 router（放在 server.js:386-396 挂载段附近，pool 用该文件已有的 pool 引用——先 grep `from './src/db.js'` 确认变量名）**

```js
app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
```

- [ ] **Step 3: 主 listen 成功后启动公网 listener（server.js:629 listenWithRetry 之后）**

```js
// Acceptance 公网 listener（刀 1，决策 c08c2173）：token 未配置时静默不启动
try {
  const ACCEPTANCE_PUBLIC_PORT = Number(process.env.ACCEPTANCE_PUBLIC_PORT || 5223);
  startAcceptancePublicServer({ pool, port: ACCEPTANCE_PUBLIC_PORT });
} catch (err) {
  console.error('[acceptance-public] 启动失败（不影响主服务）:', err.message);
}
```

- [ ] **Step 4: 语法冒烟（Brain deploy 死规矩）**

Run: `cd packages/brain && node --check server.js && node --check src/acceptance-public-server.js && node --check src/routes/acceptance.js`
Expected: 无输出（全过）

- [ ] **Step 5: 全量单测回归**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/ src/__tests__/acceptance-public-server.test.js`
Expected: 新旧全绿

- [ ] **Step 6: 写部署文档**

`docs/current/acceptance-endpoint-deploy.md`：

```markdown
# Acceptance 公网端点部署（刀 1 配套）

## Token 生成与存放
1. `openssl rand -base64 32` 生成 token
2. 1Password CS Vault 建条目 `Acceptance API`（credential 字段）
3. 双写 `~/.credentials/acceptance.env`（chmod 600）：`ACCEPTANCE_API_TOKEN=<token>`
4. Brain 生产容器 env 注入 `ACCEPTANCE_API_TOKEN`（cecelia-deploy compose env）——未注入则 5223 不启动（fail-closed）

## cloudflared 暴露
现有 tunnel 的 ingress 追加：
    - hostname: brain-acceptance.zenjoymedia.media
      service: http://localhost:5223
Cloudflare DNS 加对应 CNAME 后 `cloudflared tunnel ingress validate` + 重启 tunnel。

## Worker 侧
    cd <worker 项目> && echo "BRAIN_ACCEPTANCE_TOKEN=<token>" >> .env && ntn workers env push --yes

## 验证
    curl -s https://brain-acceptance.zenjoymedia.media/acceptance/pending -H "Authorization: Bearer $ACCEPTANCE_API_TOKEN"
    # 无 token 应 401；带 token 应返回 {"runs":[...]}
```

- [ ] **Step 7: Commit**

```bash
git add packages/brain/server.js docs/current/acceptance-endpoint-deploy.md
git commit -m "feat(brain): server.js 接线 acceptance 内网路由 + 5223 公网 listener + 部署文档"
```

---

### Task 6: Integration 测试（真库全链）

**Files:**
- Test: `packages/brain/src/__tests__/integration/acceptance.integration.test.js`

- [ ] **Step 1: 写 integration 测试（CI 的 brain-integration job 会先 migrate cecelia_test 再跑）**

```js
import express from 'express';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter, createAcceptancePublicRouter } from '../../routes/acceptance.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  app.use(createAcceptancePublicRouter({ pool }));
  return app;
}

const RUN_KEY = `itest-run-${process.pid}`;

describe('acceptance 全链 integration', () => {
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('建单 → pending 可见 → 回写 results → pass_rate/status 更新', async () => {
    const app = makeApp();

    const create = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY,
      title: 'integration 测试单',
      gp_id: 'customer_smart_acquisition',
      checks: [
        { kind: 'FR', name: 'step1' },
        { kind: 'FR', name: 'step2' },
        { kind: 'Invariant', name: '不向未授权账号发消息' },
      ],
    });
    expect(create.status).toBe(201);
    expect(create.body.checks).toHaveLength(3);

    const again = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY, title: '重复', checks: [{ kind: 'FR', name: 'x' }],
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);

    const pending = await request(app).get('/acceptance/pending');
    expect(pending.status).toBe(200);
    const mine = pending.body.runs.find((r) => r.run_key === RUN_KEY);
    expect(mine.checks).toHaveLength(3);

    const results = await request(app).post('/acceptance/results').send({
      results: [
        { check_key: `${RUN_KEY}:001`, result: '通过' },
        { check_key: `${RUN_KEY}:002`, result: '不通过', note: '挂了' },
        { check_key: `${RUN_KEY}:003`, result: '通过' },
      ],
    });
    expect(results.status).toBe(200);
    const updated = results.body.runs.find((r) => r.run_key === RUN_KEY);
    expect(updated.status).toBe('failed');
    expect(Number(updated.pass_rate)).toBeCloseTo(2 / 3);

    const { rows } = await pool.query('SELECT status, pass_rate FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('failed');
  });
});
```

- [ ] **Step 2: 本地 scratch 库跑一遍**

Run: `cd packages/brain && DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/__tests__/integration/acceptance.integration.test.js`
Expected: PASS（scratch 库已在 Task 1 migrate 过）

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/integration/acceptance.integration.test.js
git commit -m "test(brain): acceptance 全链 integration 测试"
```

---

### Task 7: 版本 bump + DevGate

**Files:**
- Modify: `packages/brain/package.json` + `packages/brain/package-lock.json` + `.brain-versions` + `DEFINITION.md`

- [ ] **Step 1: bump**

```bash
cd packages/brain && npm version patch --no-git-tag-version
NEW=$(node -p "require('./package.json').version")
cd ../.. && echo "$NEW" >> .brain-versions
# DEFINITION.md 的 "**Brain 版本**: x.y.z" 行改成 $NEW（Edit 工具改）
```

- [ ] **Step 2: DevGate 三闸**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```

Expected: 全过。facts-check 失败 → 按报错对齐 DEFINITION.md；version-sync 失败 → 检查四处版本。

- [ ] **Step 3: 全量回归**

Run: `cd packages/brain && npx vitest run`
Expected: 全绿（若有既有失败，确认与本改动无关并记录）

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): bump vX.Y.Z — acceptance 刀 1"
```
