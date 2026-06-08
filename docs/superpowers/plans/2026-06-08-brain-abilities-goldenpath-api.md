# Brain abilities + golden_path CRUD API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给 abilities / golden_path 两表加 Brain CRUD 路由 + migration，让 skill/外部可读写。

**Architecture:** 照搬 journeys.js journey_features 模式（pool.query、裸数组 GET、try-catch 500、动态 PATCH）。新 router 文件 + server.js 挂载 + migration 294 + 单元测试 + smoke。

**Tech Stack:** Node ESM, express, pg pool (`src/db.js` default export), vitest + supertest, 纯 SQL migration。

---

### Task 1: Migration 294（建表，幂等）

**Files:**
- Create: `packages/brain/migrations/294_abilities_goldenpath.sql`

- [ ] **Step 1: 写 migration（CREATE TABLE IF NOT EXISTS，与本地已建一致）**

```sql
-- Migration 294: abilities + golden_path 能力目录与黄金路径
-- abilities = 客户价值/使能件目录（kind 区分）；golden_path = 客户流程有序引用（scope 筛 + order 排）

CREATE TABLE IF NOT EXISTS abilities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  area          VARCHAR(50)  NOT NULL,
  journey_id    UUID REFERENCES journeys(id) ON DELETE SET NULL,
  kind          VARCHAR(20)  NOT NULL DEFAULT 'ability',
  type          VARCHAR(50),
  workflow_ref  VARCHAR(500),
  status        VARCHAR(20)  NOT NULL DEFAULT 'planned',
  notion_id     VARCHAR(100),
  notion_synced_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT abilities_area_check CHECK (area IN ('zenithjoy','cecelia','investment')),
  CONSTRAINT abilities_kind_check CHECK (kind IN ('ability','feature')),
  CONSTRAINT abilities_status_check CHECK (status IN ('working','broken','planned'))
);
CREATE INDEX IF NOT EXISTS idx_abilities_area ON abilities(area);
CREATE INDEX IF NOT EXISTS idx_abilities_journey ON abilities(journey_id);
CREATE INDEX IF NOT EXISTS idx_abilities_kind ON abilities(kind);

CREATE TABLE IF NOT EXISTS golden_path (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  VARCHAR(20) NOT NULL,
  scope_id    UUID NOT NULL,
  order_no    INTEGER NOT NULL,
  ability_id  UUID NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
  note        TEXT,
  notion_id   VARCHAR(100),
  notion_synced_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT golden_path_scope_check CHECK (scope_type IN ('run','project','initiative','journey'))
);
CREATE INDEX IF NOT EXISTS idx_golden_path_scope ON golden_path(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_golden_path_ability ON golden_path(ability_id);
```

- [ ] **Step 2: 本地验证幂等（表已存在不应报错）**

Run: `psql -h localhost -U cecelia cecelia -f packages/brain/migrations/294_abilities_goldenpath.sql`
Expected: `CREATE TABLE` 或 `NOTICE: relation already exists, skipping`，无 error

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/294_abilities_goldenpath.sql
git commit -m "feat(brain): migration 294 abilities + golden_path tables"
```

---

### Task 2: abilities.js 路由 + 单元测试（TDD）

**Files:**
- Create: `packages/brain/src/routes/abilities.js`
- Test: `packages/brain/src/routes/__tests__/abilities.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../abilities.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

describe('abilities routes', () => {
  beforeEach(() => mockQuery.mockReset());

  it('GET /abilities 返回数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', name: '抖音视频发布', kind: 'ability' }] });
    const res = await (await req())(await makeApp()).get('/api/brain/abilities');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /abilities 缺 name 返回 400', async () => {
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ area: 'zenithjoy' });
    expect(res.status).toBe(400);
  });

  it('POST /abilities 建一条返回 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a2', name: 'X', area: 'zenithjoy', kind: 'ability' }] });
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ name: 'X', area: 'zenithjoy' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('X');
  });

  it('PATCH /abilities/:id 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await (await req())(await makeApp()).patch('/api/brain/abilities/nope').send({ status: 'working' });
    expect(res.status).toBe(404);
  });

  it('GET /golden_path 返回数组（按 order_no）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1', order_no: 1, ability_id: 'a1' }] });
    const res = await (await req())(await makeApp()).get('/api/brain/golden_path?scope_type=journey&scope_id=j1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /golden_path 缺字段返回 400', async () => {
    const res = await (await req())(await makeApp()).post('/api/brain/golden_path').send({ scope_type: 'journey' });
    expect(res.status).toBe(400);
  });

  it('DB 报错返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    const res = await (await req())(await makeApp()).get('/api/brain/abilities');
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/abilities.test.js`
Expected: FAIL（abilities.js 不存在 / Cannot find module）

- [ ] **Step 3: 写 abilities.js 实现**

```javascript
import express from 'express';
import pool from '../db.js';

const router = express.Router();

const ABILITY_KINDS = ['ability', 'feature'];
const ABILITY_STATUS = ['working', 'broken', 'planned'];
const SCOPE_TYPES = ['run', 'project', 'initiative', 'journey'];

// ---------- abilities ----------

// GET /api/brain/abilities
router.get('/abilities', async (req, res) => {
  try {
    const { area, journey_id, kind, status, limit = 200 } = req.query;
    const params = [];
    const clauses = [];
    if (area)       { params.push(area);       clauses.push(`area=$${params.length}`); }
    if (journey_id) { params.push(journey_id); clauses.push(`journey_id=$${params.length}`); }
    if (kind)       { params.push(kind);       clauses.push(`kind=$${params.length}`); }
    if (status)     { params.push(status);     clauses.push(`status=$${params.length}`); }
    params.push(parseInt(limit, 10) || 200);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM abilities ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /abilities error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/abilities
router.post('/abilities', async (req, res) => {
  try {
    const { name, area, journey_id, kind, type, workflow_ref, status } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!area) return res.status(400).json({ error: 'area is required' });
    if (kind && !ABILITY_KINDS.includes(kind))
      return res.status(400).json({ error: `kind must be one of: ${ABILITY_KINDS.join(',')}` });
    if (status && !ABILITY_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ABILITY_STATUS.join(',')}` });
    const { rows } = await pool.query(
      `INSERT INTO abilities (name, area, journey_id, kind, type, workflow_ref, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, area, journey_id || null, kind || 'ability', type || null, workflow_ref || null, status || 'planned']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[abilities] POST /abilities error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/abilities/:id
router.patch('/abilities/:id', async (req, res) => {
  try {
    const { name, kind, type, workflow_ref, status } = req.body;
    if (kind && !ABILITY_KINDS.includes(kind))
      return res.status(400).json({ error: `kind must be one of: ${ABILITY_KINDS.join(',')}` });
    if (status && !ABILITY_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ABILITY_STATUS.join(',')}` });
    const sets = [], vals = []; let idx = 1;
    if (name)         { sets.push(`name=$${idx++}`);         vals.push(name); }
    if (kind)         { sets.push(`kind=$${idx++}`);         vals.push(kind); }
    if (type)         { sets.push(`type=$${idx++}`);         vals.push(type); }
    if (workflow_ref) { sets.push(`workflow_ref=$${idx++}`); vals.push(workflow_ref); }
    if (status)       { sets.push(`status=$${idx++}`);       vals.push(status); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE abilities SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[abilities] PATCH /abilities/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- golden_path ----------

// GET /api/brain/golden_path
router.get('/golden_path', async (req, res) => {
  try {
    const { scope_type, scope_id, limit = 200 } = req.query;
    const params = [];
    const clauses = [];
    if (scope_type) { params.push(scope_type); clauses.push(`scope_type=$${params.length}`); }
    if (scope_id)   { params.push(scope_id);   clauses.push(`scope_id=$${params.length}`); }
    params.push(parseInt(limit, 10) || 200);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM golden_path ${where} ORDER BY order_no ASC LIMIT $${params.length}`, params
    );
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /golden_path error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/golden_path
router.post('/golden_path', async (req, res) => {
  try {
    const { scope_type, scope_id, order_no, ability_id, note } = req.body;
    if (!scope_type || !scope_id || order_no == null || !ability_id)
      return res.status(400).json({ error: 'scope_type, scope_id, order_no, ability_id are required' });
    if (!SCOPE_TYPES.includes(scope_type))
      return res.status(400).json({ error: `scope_type must be one of: ${SCOPE_TYPES.join(',')}` });
    const { rows } = await pool.query(
      `INSERT INTO golden_path (scope_type, scope_id, order_no, ability_id, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [scope_type, scope_id, order_no, ability_id, note || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[abilities] POST /golden_path error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/golden_path/:id
router.patch('/golden_path/:id', async (req, res) => {
  try {
    const { order_no, ability_id, note } = req.body;
    const sets = [], vals = []; let idx = 1;
    if (order_no != null) { sets.push(`order_no=$${idx++}`);   vals.push(order_no); }
    if (ability_id)       { sets.push(`ability_id=$${idx++}`); vals.push(ability_id); }
    if (note != null)     { sets.push(`note=$${idx++}`);       vals.push(note); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE golden_path SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[abilities] PATCH /golden_path/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/abilities.test.js`
Expected: PASS（7 passed）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/abilities.js packages/brain/src/routes/__tests__/abilities.test.js
git commit -m "feat(brain): abilities + golden_path CRUD routes + unit tests"
```

---

### Task 3: server.js 挂载路由

**Files:**
- Modify: `packages/brain/server.js`（import 区 + line ~319 挂载区）

- [ ] **Step 1: 加 import（与 journeysRouter import 相邻）**

在 `import journeysRouter from './src/routes/journeys.js';` 下一行加：
```javascript
import abilitiesRouter from './src/routes/abilities.js';
```

- [ ] **Step 2: 加挂载（与 `app.use('/api/brain', journeysRouter);` 相邻）**

```javascript
app.use('/api/brain', abilitiesRouter);
```

- [ ] **Step 3: 验证 Brain 能起 + 路由可达**

Run: `cd packages/brain && node -e "import('./server.js').then(()=>console.log('boot ok')).catch(e=>{console.error(e);process.exit(1)})" & sleep 3; curl -sf localhost:5221/api/brain/abilities | head -c 200; kill %1`
Expected: 返回 JSON 数组（含 zenithjoy 25 条，本地 DB）

> 若本地 5221 已被常驻 Brain 占用：直接 `curl -sf localhost:5221/api/brain/abilities | jq -e 'type=="array"'`（常驻 Brain 重启后即含新路由）。验证返回数组即可。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/server.js
git commit -m "feat(brain): mount abilities router"
```

---

### Task 4: smoke 脚本

**Files:**
- Create: `packages/brain/scripts/smoke/abilities-api-smoke.sh`

- [ ] **Step 1: 写 smoke**

```bash
#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── abilities API smoke ──"
r=$(curl -sf "$BRAIN/api/brain/abilities?limit=5") || { fail "abilities GET 不可达"; r="{}"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "abilities GET 返回数组" || fail "abilities GET 结构异常"

g=$(curl -sf "$BRAIN/api/brain/golden_path?limit=5") || { fail "golden_path GET 不可达"; g="{}"; }
echo "$g" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "golden_path GET 返回数组" || fail "golden_path GET 结构异常"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
```

- [ ] **Step 2: 本地跑一遍**

Run: `chmod +x packages/brain/scripts/smoke/abilities-api-smoke.sh && bash packages/brain/scripts/smoke/abilities-api-smoke.sh`
Expected: `✅ 全部通过`

- [ ] **Step 3: Commit**

```bash
git add packages/brain/scripts/smoke/abilities-api-smoke.sh
git commit -m "test(brain): abilities-api real-env smoke"
```

---

## Self-Review
- Spec coverage: migration(Task1) / 6 路由(Task2) / 挂载(Task3) / smoke(Task4) / 单元测试(Task2) — 全覆盖 ✅
- 无 placeholder：每步含真实代码/命令 ✅
- 类型一致：路由字段与 migration 列名一致（kind/status/scope_type/order_no/ability_id）✅
