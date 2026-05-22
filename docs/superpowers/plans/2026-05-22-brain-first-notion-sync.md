# Brain 优先写入 + 异步 Notion 推送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 walking-skeleton 系列脚本从 Notion-first 改为 Brain-first，Brain DB 是唯一写入终点，Brain tick 异步推 Notion。

**Architecture:** 脚本调 Brain HTTP API（POST /api/brain/journeys 等）写 DB（notion_synced_at=NULL），Brain tick 每轮扫描 NULL 行批量推 Notion API，成功后更新 notion_id + notion_synced_at。

**Tech Stack:** Node.js ES modules, Express Router, pg pool, Notion REST API v1, vitest

**前提：** 本 worktree 已 rebase 到 Sprint A（migration 281），journeys/journey_features/issues 表含 notion_synced_at 字段。

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `packages/brain/src/recurring-notion-sync.js` | 修改 | export notionReq + getToken |
| `packages/brain/src/routes/journeys.js` | 新建 | POST /journeys, POST /journey_features, PATCH /journey_features/:id, POST /issues |
| `packages/brain/server.js` | 修改 | 注册 journeys 路由 |
| `packages/brain/src/notion-push-sync.js` | 新建 | tick 异步推 Notion 逻辑 |
| `packages/brain/src/tick-runner.js` | 修改 | 末尾调 runNotionPushSync |
| `packages/brain/src/__tests__/journeys-api.test.js` | 新建 | routes/journeys.js 单测 |
| `packages/brain/src/__tests__/notion-push-sync.test.js` | 新建 | notion-push-sync.js 单测 |
| `packages/brain/scripts/smoke/notion-brain-first-smoke.sh` | 新建 | Brain API 写 DB 端到端验证 |
| `~/.claude/skills/walking-skeleton/scripts/init-journey.js` | 改写 | Brain API 替代 Notion-direct |
| `~/.claude/skills/walking-skeleton/scripts/add-feature.js` | 改写 | Brain API 替代 Notion-direct |
| `~/.claude/skills/walking-skeleton/scripts/thicken.js` | 改写 | Brain API 替代 Notion-direct |
| `scripts/notion-create-issue.js` | 改写 | Brain API 替代 Notion-direct |

---

### Task 1: E2E smoke 骨架 + 失败测试（TDD Red）

**Files:**
- Create: `packages/brain/scripts/smoke/notion-brain-first-smoke.sh`
- Create: `packages/brain/src/__tests__/journeys-api.test.js`

- [ ] **Step 1: 写 smoke 骨架（先 exit 1 — Red）**

```bash
cat > packages/brain/scripts/smoke/notion-brain-first-smoke.sh << 'EOF'
#!/bin/bash
# notion-brain-first-smoke.sh — Brain-first journeys/issues 写入验证
# 环境变量：DATABASE_URL（默认 postgresql://cecelia@localhost:5432/cecelia）
set -e

DB="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"

if ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] SKIP — 无 DB 连接"
  exit 0
fi

echo "[smoke] 测试 POST /api/brain/journeys..."
RESP=$(curl -sf -X POST "$BRAIN/api/brain/journeys" \
  -H "Content-Type: application/json" \
  -d '{"name":"_smoke_journey_test_","journey_type":"dev_pipeline","description":"smoke test"}' 2>&1 || echo "CURL_FAIL")

if echo "$RESP" | grep -q "CURL_FAIL\|html\|<!"; then
  echo "FAIL: POST /api/brain/journeys 端点不存在（端点未实现）"
  exit 1
fi

JOURNEY_ID=$(echo "$RESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.id||'')" 2>/dev/null || true)
[ -n "$JOURNEY_ID" ] || { echo "FAIL: 响应无 id 字段"; exit 1; }

DB_COUNT=$(psql "$DB" -tAc "SELECT COUNT(*) FROM journeys WHERE id='$JOURNEY_ID' AND notion_synced_at IS NULL")
[ "$DB_COUNT" = "1" ] || { echo "FAIL: journeys 行不存在或 notion_synced_at 不为 NULL"; exit 1; }

# 清理
psql "$DB" -tAc "DELETE FROM journeys WHERE id='$JOURNEY_ID'" >/dev/null

echo "[smoke] 测试 POST /api/brain/issues..."
IRESP=$(curl -sf -X POST "$BRAIN/api/brain/issues" \
  -H "Content-Type: application/json" \
  -d '{"title":"_smoke_issue_test_","priority":"P2"}' 2>&1 || echo "CURL_FAIL")

if echo "$IRESP" | grep -q "CURL_FAIL"; then
  echo "FAIL: POST /api/brain/issues 端点不存在"
  exit 1
fi

ISSUE_ID=$(echo "$IRESP" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.id||'')" 2>/dev/null || true)
[ -n "$ISSUE_ID" ] || { echo "FAIL: issues 响应无 id 字段"; exit 1; }

IDB_COUNT=$(psql "$DB" -tAc "SELECT COUNT(*) FROM issues WHERE id='$ISSUE_ID' AND notion_synced_at IS NULL")
[ "$IDB_COUNT" = "1" ] || { echo "FAIL: issues 行不存在或 notion_synced_at 不为 NULL"; exit 1; }

psql "$DB" -tAc "DELETE FROM issues WHERE id='$ISSUE_ID'" >/dev/null

echo "✅ notion-brain-first smoke 全部通过"
EOF
chmod +x packages/brain/scripts/smoke/notion-brain-first-smoke.sh
```

- [ ] **Step 2: 写 journeys-api.test.js（Red — 路由未存在时全失败）**

```bash
cat > packages/brain/src/__tests__/journeys-api.test.js << 'EOF'
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

describe('POST /api/brain/journeys', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 journeys 表，notion_synced_at=NULL，返回行', async () => {
    const fakeRow = {
      id: 'uuid-1234',
      name: 'Test Journey',
      journey_type: 'dev_pipeline',
      notion_synced_at: null,
    };
    // areas lookup（name→id）
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no area found → area_id NULL
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const { default: router } = await import('../routes/journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journeys')
      .send({ name: 'Test Journey', journey_type: 'dev_pipeline' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('uuid-1234');
    expect(res.body.notion_synced_at).toBeNull();
  });

  it('name 缺失时返回 400', async () => {
    const { default: router } = await import('../routes/journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journeys')
      .send({ journey_type: 'dev_pipeline' });

    expect(res.status).toBe(400);
  });

  it('journey_type 非法值返回 400', async () => {
    const { default: router } = await import('../routes/journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journeys')
      .send({ name: 'X', journey_type: 'invalid_type' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/brain/issues', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 issues 表，notion_synced_at=NULL，返回行', async () => {
    const fakeRow = { id: 'issue-uuid', title: 'Bug', priority: 'P2', notion_synced_at: null };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const { default: router } = await import('../routes/journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/issues')
      .send({ title: 'Bug', priority: 'P2' });

    expect(res.status).toBe(201);
    expect(res.body.notion_synced_at).toBeNull();
  });
});

describe('POST /api/brain/journey_features', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 journey_features，notion_synced_at=NULL', async () => {
    const fakeRow = { id: 'feat-uuid', name: 'Feature A', thickness: 'thin', notion_synced_at: null };
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journey lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // area lookup
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] }); // insert

    const { default: router } = await import('../routes/journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'Feature A', thickness: 'thin' });

    expect(res.status).toBe(201);
    expect(res.body.notion_synced_at).toBeNull();
  });
});
EOF
```

- [ ] **Step 3: 确认测试失败（Red）**

```bash
cd packages/brain && npx vitest run src/__tests__/journeys-api.test.js --reporter=verbose 2>&1 | tail -20
```

期望：`FAIL` — `Cannot find module '../routes/journeys.js'` 或类似错误

- [ ] **Step 4: 提交 Red 状态**

```bash
git add packages/brain/src/__tests__/journeys-api.test.js packages/brain/scripts/smoke/notion-brain-first-smoke.sh
git commit -m "test(brain): [RED] journeys-api + notion-brain-first smoke 骨架"
```

---

### Task 2: export notionReq + 创建 routes/journeys.js（Green）

**Files:**
- Modify: `packages/brain/src/recurring-notion-sync.js:25`
- Create: `packages/brain/src/routes/journeys.js`
- Modify: `packages/brain/server.js:70`

- [ ] **Step 1: export notionReq 和 getToken**

在 `packages/brain/src/recurring-notion-sync.js` 中，将 `function notionReq` 和 `function getToken` 改为 export：

```javascript
// 改：function getToken() {
export function getToken() {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error('NOTION_API_KEY 未配置');
  return token;
}

// 改：async function notionReq(token, path, method = 'GET', body = null) {
export async function notionReq(token, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`https://api.notion.com/v1${path}`, opts);
  const data = await res.json();

  if (!res.ok) {
    const err  = new Error(`Notion ${method} ${path} → ${res.status}: ${data.message}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
```

- [ ] **Step 2: 创建 routes/journeys.js**

```javascript
// packages/brain/src/routes/journeys.js
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_JOURNEY_TYPES = ['user_facing', 'autonomous', 'dev_pipeline', 'agent_remote'];
const VALID_THICKNESS     = ['thin', 'medium', 'thick', 'mature'];
const VALID_PRIORITY      = ['P0', 'P1', 'P2', 'P3'];

// POST /api/brain/journeys
router.post('/journeys', async (req, res) => {
  const { name, journey_type, description, maturity, status, e2e_test_path, area, steps } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!journey_type || !VALID_JOURNEY_TYPES.includes(journey_type)) {
    return res.status(400).json({ error: `journey_type must be one of: ${VALID_JOURNEY_TYPES.join(',')}` });
  }

  // area name → area_id lookup
  let areaId = null;
  if (area) {
    const { rows } = await pool.query('SELECT id FROM areas WHERE name=$1 LIMIT 1', [area]);
    if (rows.length > 0) areaId = rows[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO journeys
       (name, journey_type, description, maturity, status, e2e_test_path, area_id, notion_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
     RETURNING *`,
    [
      name,
      journey_type,
      description || null,
      maturity || 'not_started',
      status || 'active',
      e2e_test_path || null,
      areaId,
    ]
  );
  const journey = rows[0];

  // steps 可选：插入 journey_steps
  if (Array.isArray(steps) && steps.length > 0) {
    for (let i = 0; i < steps.length; i++) {
      await pool.query(
        `INSERT INTO journey_steps (journey_id, name, step_number, notion_synced_at)
         VALUES ($1,$2,$3,NULL) ON CONFLICT (journey_id, step_number) DO NOTHING`,
        [journey.id, steps[i], i + 1]
      );
    }
  }

  res.status(201).json(journey);
});

// GET /api/brain/journeys/:id
router.get('/journeys/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM journeys WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// POST /api/brain/journey_features
router.post('/journey_features', async (req, res) => {
  const { name, journey_id, thickness, status, area, unit_test_path, version } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (thickness && !VALID_THICKNESS.includes(thickness)) {
    return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
  }

  // journey_id lookup（若传 notion_id 格式则转换）
  let journeyUuid = journey_id || null;
  if (journey_id) {
    const { rows: jr } = await pool.query(
      'SELECT id FROM journeys WHERE id=$1 OR notion_id=$1 LIMIT 1', [journey_id]
    );
    journeyUuid = jr.length ? jr[0].id : null;
  }

  let areaId = null;
  if (area) {
    const { rows: ar } = await pool.query('SELECT id FROM areas WHERE name=$1 LIMIT 1', [area]);
    if (ar.length) areaId = ar[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO journey_features
       (name, journey_id, thickness, status, area_id, unit_test_path, version, notion_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
     RETURNING *`,
    [
      name,
      journeyUuid,
      thickness || 'thin',
      status || 'planned',
      areaId,
      unit_test_path || null,
      version || null,
    ]
  );
  res.status(201).json(rows[0]);
});

// PATCH /api/brain/journey_features/:id
router.patch('/journey_features/:id', async (req, res) => {
  const { thickness, status, unit_test_path, version } = req.body;
  if (thickness && !VALID_THICKNESS.includes(thickness)) {
    return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
  }

  const sets = [];
  const vals = [];
  let idx = 1;
  if (thickness)      { sets.push(`thickness=$${idx++}`);      vals.push(thickness); }
  if (status)         { sets.push(`status=$${idx++}`);          vals.push(status); }
  if (unit_test_path) { sets.push(`unit_test_path=$${idx++}`);  vals.push(unit_test_path); }
  if (version)        { sets.push(`version=$${idx++}`);         vals.push(version); }
  if (!sets.length)   return res.status(400).json({ error: 'no fields to update' });

  // thickness 变更 → 需重新推 Notion
  if (thickness) { sets.push(`notion_synced_at=NULL`); }
  sets.push(`updated_at=NOW()`);
  vals.push(req.params.id);

  const { rows } = await pool.query(
    `UPDATE journey_features SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
    vals
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// POST /api/brain/issues  （Brain-first issues 写入）
router.post('/issues', async (req, res) => {
  const { title, priority, status, sub_area, body: bodyText, pr_url } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (priority && !VALID_PRIORITY.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITY.join(',')}` });
  }

  const { rows } = await pool.query(
    `INSERT INTO issues
       (title, priority, status, sub_area, body, pr_url, notion_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     RETURNING *`,
    [
      title,
      priority || 'P2',
      status || 'In progress',
      sub_area || null,
      bodyText || null,
      pr_url || null,
    ]
  );
  res.status(201).json(rows[0]);
});

export default router;
```

- [ ] **Step 3: 注册路由到 server.js**

在 `packages/brain/server.js` 第 70 行附近（walkingSkeletonRouter import 后）添加：

```javascript
// 在 import walkingSkeletonRouter 后添加：
import journeysRouter from './src/routes/journeys.js';
```

在 `packages/brain/server.js` 第 301 行附近（`app.use('/api/brain', walkingSkeletonRouter)` 后）添加：

```javascript
app.use('/api/brain', journeysRouter);
```

- [ ] **Step 4: 运行测试（Green）**

```bash
cd packages/brain && npx vitest run src/__tests__/journeys-api.test.js --reporter=verbose 2>&1 | tail -20
```

期望：所有测试 PASS

- [ ] **Step 5: 本地验证 smoke**

```bash
# 前提：Brain 在本机运行（localhost:5221）
bash packages/brain/scripts/smoke/notion-brain-first-smoke.sh
```

期望：`✅ notion-brain-first smoke 全部通过`

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/recurring-notion-sync.js \
        packages/brain/src/routes/journeys.js \
        packages/brain/server.js \
        packages/brain/src/__tests__/journeys-api.test.js
git commit -m "feat(brain): Brain-first journeys/journey_features/issues API (notion_synced_at=NULL)"
```

---

### Task 3: notion-push-sync.js + 测试

**Files:**
- Create: `packages/brain/src/notion-push-sync.js`
- Create: `packages/brain/src/__tests__/notion-push-sync.test.js`

- [ ] **Step 1: 写失败测试（Red）**

```javascript
// packages/brain/src/__tests__/notion-push-sync.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Notion DB IDs（从 Sprint A sync 脚本）
const JOURNEY_DB  = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB  = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB   = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';

const mockQuery    = vi.fn();
const mockNotionReq = vi.fn();

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../recurring-notion-sync.js', () => ({
  notionReq: mockNotionReq,
  getToken: () => 'fake-token',
}));

describe('runNotionPushSync', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotionReq.mockReset();
  });

  it('无待同步行时不调 Notion API', async () => {
    // journeys / journey_features / issues 均无 NULL 行
    mockQuery.mockResolvedValue({ rows: [] });

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    expect(mockNotionReq).not.toHaveBeenCalled();
  });

  it('有待同步 journey 时调 Notion API 创建页面并更新 notion_synced_at', async () => {
    const journey = {
      id: 'j-uuid',
      name: 'Test Journey',
      journey_type: 'dev_pipeline',
      description: null,
      maturity: 'not_started',
      e2e_test_path: null,
      area_notion_id: null,
    };

    // journeys 有 1 行
    mockQuery.mockResolvedValueOnce({ rows: [journey] });
    // journey_features — 无
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // issues — 无
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Notion POST /pages 返回
    mockNotionReq.mockResolvedValueOnce({ id: 'notion-page-id-1' });
    // UPDATE journeys SET notion_id, notion_synced_at
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    expect(mockNotionReq).toHaveBeenCalledTimes(1);
    // 第一个 Notion 调用应是 POST /pages
    expect(mockNotionReq.mock.calls[0][1]).toBe('/pages');
    expect(mockNotionReq.mock.calls[0][2]).toBe('POST');
    // parent 应指向 JOURNEY_DB
    expect(mockNotionReq.mock.calls[0][3].parent.database_id).toBe(JOURNEY_DB);

    // 应有 UPDATE 调用更新 notion_id + notion_synced_at
    const updateCall = mockQuery.mock.calls.find(c => c[0].includes('UPDATE journeys'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain('notion-page-id-1');
  });

  it('Notion API 失败时跳过该行（notion_synced_at 保持 NULL）', async () => {
    const journey = { id: 'j-uuid', name: 'X', journey_type: 'dev_pipeline', area_notion_id: null };
    mockQuery.mockResolvedValueOnce({ rows: [journey] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    mockNotionReq.mockRejectedValueOnce(new Error('Notion timeout'));
    // notion_sync_log 记录
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    // 不应抛出异常
    await expect(runNotionPushSync({ query: mockQuery })).resolves.not.toThrow();

    // 不应调 UPDATE journeys SET notion_synced_at
    const updateCall = mockQuery.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE journeys') && c[0].includes('notion_synced_at')
    );
    expect(updateCall).toBeUndefined();
  });
});
```

- [ ] **Step 2: 确认 Red**

```bash
cd packages/brain && npx vitest run src/__tests__/notion-push-sync.test.js --reporter=verbose 2>&1 | tail -15
```

期望：FAIL — `Cannot find module '../notion-push-sync.js'`

- [ ] **Step 3: 实现 notion-push-sync.js**

```javascript
// packages/brain/src/notion-push-sync.js
/**
 * notion-push-sync.js — Brain→Notion 异步推送
 *
 * 扫描 journeys/journey_features/issues 中 notion_synced_at=NULL 的行，
 * 批量调 Notion API 创建/更新页面，成功后写回 notion_id + notion_synced_at=NOW()。
 *
 * 每张表每轮最多处理 10 行（防 Notion API 限流）。
 * 失败的行保留 notion_synced_at=NULL，下次 tick 重试。
 */

import { notionReq, getToken } from './recurring-notion-sync.js';

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB  = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';

// Sub Area Notion page IDs（与 scripts/notion-to-brain/sync-issues.js 保持一致）
const SUB_AREA_NOTION_IDS = {
  brain:       '5c0c40c2-ba63-8184-bc3d-f1c5e48caee4',
  engine:      '64bc40c2-ba63-81b0-a7e2-c2f7bb3b2e31',
  cecelia:     '7e7c40c2-ba63-8117-8d5d-e3e18a3c6b04',
  'multi-agent': '8acc40c2-ba63-810b-8e07-c5c3d34d8e13',
  zenithjoy:   'cf5c40c2-ba63-8182-9b3e-f2d1a4e5c6f0',
  dashboard:   'a17c40c2-ba63-83e2-9c3d-b4e2f1a5c7d8',
};

function buildRichText(text) {
  if (!text) return [];
  return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
}

async function pushJourneys(pool, token) {
  const { rows } = await pool.query(`
    SELECT j.*, a.notion_id AS area_notion_id
    FROM journeys j
    LEFT JOIN areas a ON a.id = j.area_id
    WHERE j.notion_synced_at IS NULL
    LIMIT 10
  `);

  for (const j of rows) {
    try {
      const properties = {
        Name: { title: [{ text: { content: j.name } }] },
        Description: { rich_text: buildRichText(j.description) },
        'Journey Type': { select: { name: j.journey_type } },
        Maturity: { select: { name: j.maturity } },
        Status: { select: { name: j.status || 'active' } },
      };
      if (j.e2e_test_path) {
        properties['E2E Test Path'] = { rich_text: buildRichText(j.e2e_test_path) };
      }
      if (j.area_notion_id) {
        properties['Area'] = { relation: [{ id: j.area_notion_id }] };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: JOURNEY_DB },
        properties,
      });

      await pool.query(
        'UPDATE journeys SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, j.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] journey ${j.id} 推送失败: ${err.message}`);
      await pool.query(
        `INSERT INTO notion_sync_log (direction, source, records_synced, records_failed, error_message)
         VALUES ('push','notion-push-sync',0,1,$1)`,
        [err.message]
      ).catch(() => {});
    }
  }
}

async function pushJourneyFeatures(pool, token) {
  const { rows } = await pool.query(`
    SELECT f.*, j.notion_id AS journey_notion_id, a.notion_id AS area_notion_id
    FROM journey_features f
    LEFT JOIN journeys j ON j.id = f.journey_id
    LEFT JOIN areas a ON a.id = f.area_id
    WHERE f.notion_synced_at IS NULL
      AND (f.journey_id IS NULL OR j.notion_id IS NOT NULL)
    LIMIT 10
  `);

  for (const f of rows) {
    try {
      const properties = {
        Name: { title: [{ text: { content: f.name } }] },
        Thickness: { select: { name: f.thickness } },
        Status: { select: { name: f.status || 'planned' } },
      };
      if (f.journey_notion_id) {
        properties['Journey'] = { relation: [{ id: f.journey_notion_id }] };
      }
      if (f.area_notion_id) {
        properties['Area'] = { relation: [{ id: f.area_notion_id }] };
      }
      if (f.unit_test_path) {
        properties['Unit Test Path'] = { rich_text: buildRichText(f.unit_test_path) };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: FEATURE_DB },
        properties,
      });

      await pool.query(
        'UPDATE journey_features SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, f.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] feature ${f.id} 推送失败: ${err.message}`);
      await pool.query(
        `INSERT INTO notion_sync_log (direction, source, records_synced, records_failed, error_message)
         VALUES ('push','notion-push-sync',0,1,$1)`,
        [err.message]
      ).catch(() => {});
    }
  }
}

async function pushIssues(pool, token) {
  const { rows } = await pool.query(`
    SELECT * FROM issues WHERE notion_synced_at IS NULL LIMIT 10
  `);

  for (const issue of rows) {
    try {
      const properties = {
        Issue: { title: [{ text: { content: issue.title } }] },
        Priority: { select: { name: issue.priority || 'P2' } },
        Status: { status: { name: issue.status || 'In progress' } },
      };
      if (issue.sub_area && SUB_AREA_NOTION_IDS[issue.sub_area]) {
        properties['Sub Area'] = { relation: [{ id: SUB_AREA_NOTION_IDS[issue.sub_area] }] };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: ISSUES_DB },
        properties,
        children: issue.body ? [{
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: buildRichText(issue.body) },
        }] : undefined,
      });

      await pool.query(
        'UPDATE issues SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, issue.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] issue ${issue.id} 推送失败: ${err.message}`);
      await pool.query(
        `INSERT INTO notion_sync_log (direction, source, records_synced, records_failed, error_message)
         VALUES ('push','notion-push-sync',0,1,$1)`,
        [err.message]
      ).catch(() => {});
    }
  }
}

export async function runNotionPushSync(pool) {
  let token;
  try {
    token = getToken();
  } catch {
    // NOTION_API_KEY 未配置 — 静默跳过（CI 环境）
    return;
  }

  await pushJourneys(pool, token);
  await pushJourneyFeatures(pool, token);
  await pushIssues(pool, token);
}
```

- [ ] **Step 4: 确认 Green**

```bash
cd packages/brain && npx vitest run src/__tests__/notion-push-sync.test.js --reporter=verbose 2>&1 | tail -15
```

期望：所有测试 PASS

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/notion-push-sync.js packages/brain/src/__tests__/notion-push-sync.test.js
git commit -m "feat(brain): notion-push-sync — 异步推送 journeys/features/issues 到 Notion"
```

---

### Task 4: tick-runner.js 集成 notion-push-sync

**Files:**
- Modify: `packages/brain/src/tick-runner.js`

- [ ] **Step 1: 在 tick-runner.js 末尾（executeTick return 之前）添加 notion sync 调用**

在 `packages/brain/src/tick-runner.js` 的 `executeTick()` 函数末尾、`return { success: true, ... }` 之前，添加：

```javascript
  // Notion 异步推送（低优先级，非阻塞）
  try {
    const { runNotionPushSync } = await import('./notion-push-sync.js');
    await runNotionPushSync(pool);
  } catch (notionSyncErr) {
    console.warn('[tick] notion-push-sync 失败（non-fatal）:', notionSyncErr.message);
  }
```

- [ ] **Step 2: 确认现有 tick 测试仍全绿**

```bash
cd packages/brain && npx vitest run src/__tests__/tick-*.test.js --reporter=verbose 2>&1 | tail -20
```

期望：已有 tick 测试全 PASS（notion-push-sync 有 mock 覆盖）

- [ ] **Step 3: 提交**

```bash
git add packages/brain/src/tick-runner.js
git commit -m "feat(brain): tick-runner 集成 notion-push-sync（每 tick 异步推 Notion）"
```

---

### Task 5: 添加 journeys-api.test.js 到 vitest exclude + 写 brain-integration 版本

**Files:**
- Modify: `packages/brain/vitest.config.js`
- Create: `packages/brain/src/workflows/__tests__/journeys-integration.test.js`（可选，有真 DB 时跑）

> **注意**：journeys-api.test.js 用 mock pool，属于 unit test，不需要 exclude。确认配置正确即可。

- [ ] **Step 1: 确认 journeys-api.test.js 在 brain-unit 中正常运行**

```bash
cd packages/brain && npx vitest run src/__tests__/journeys-api.test.js src/__tests__/notion-push-sync.test.js --reporter=verbose 2>&1 | tail -20
```

期望：全部 PASS，无 DB 连接错误

- [ ] **Step 2: 确认 smoke 脚本在本地 Brain 运行**

```bash
bash packages/brain/scripts/smoke/notion-brain-first-smoke.sh
```

期望：`✅ notion-brain-first smoke 全部通过`

- [ ] **Step 3: 提交 smoke DoD 勾选**

将 smoke 文件中第一行注释改为：
```bash
#!/bin/bash
# [x] notion-brain-first-smoke — 已验证通过
```

```bash
git add packages/brain/scripts/smoke/notion-brain-first-smoke.sh
git commit -m "chore(brain): 标记 notion-brain-first smoke 已验证"
```

---

### Task 6: 改写 init-journey.js（Brain-first）

**Files:**
- Modify: `~/.claude/skills/walking-skeleton/scripts/init-journey.js`

> 这是仓库外文件，改完后确认本地能调通 Brain API。

- [ ] **Step 1: 读取现有文件了解完整参数**

```bash
cat ~/.claude/skills/walking-skeleton/scripts/init-journey.js
```

- [ ] **Step 2: 将 init-journey.js 改写为 Brain-first**

删除所有 Notion API 调用（`fetch(notionApiBase + '/pages', ...)`），替换为：

```javascript
// 关键变化：用 Brain API 替代 Notion-direct
// 以下是核心调用逻辑（保留参数解析和 loadNotionKey() 可删除）

async function initJourney({ name, area, type: journeyType, description, steps, e2ePath }) {
  const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

  const resp = await fetch(`${BRAIN_URL}/api/brain/journeys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      journey_type: journeyType || 'user_facing',
      description: description || '',
      area,
      e2e_test_path: e2ePath || '',
      steps: steps ? steps.split('|') : [],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
  }

  const journey = await resp.json();
  console.log(`✅ Journey 已写入 Brain DB`);
  console.log(`   ID: ${journey.id}`);
  console.log(`   名称: ${journey.name}`);
  console.log(`   Notion 同步: 待 Brain tick 推送（notion_synced_at=null）`);
  return journey;
}
```

完整改写后的文件保留：
- `--name`, `--area`, `--type`, `--description`, `--e2e-path`, `--steps` 参数解析
- 删除：`loadNotionKey()`, Notion DB ID 常量, `notionRequest()` 调用

- [ ] **Step 3: 本地验证（需 Brain 运行）**

```bash
node ~/.claude/skills/walking-skeleton/scripts/init-journey.js \
  --name "测试 Journey" \
  --type "dev_pipeline" \
  --description "smoke 测试"
```

期望：输出 `✅ Journey 已写入 Brain DB` + Journey ID

- [ ] **Step 4: 确认 Brain DB 有对应行**

```bash
psql postgresql://localhost/cecelia -c "SELECT id, name, notion_synced_at FROM journeys ORDER BY created_at DESC LIMIT 1"
```

期望：notion_synced_at 为 NULL（待 tick 同步）

---

### Task 7: 改写 add-feature.js + thicken.js（Brain-first）

**Files:**
- Modify: `~/.claude/skills/walking-skeleton/scripts/add-feature.js`
- Modify: `~/.claude/skills/walking-skeleton/scripts/thicken.js`

- [ ] **Step 1: 改写 add-feature.js**

删除 Notion-direct 调用，替换为：

```javascript
async function addFeature({ name, journeyId, thickness, area, unitTestPath }) {
  const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

  const resp = await fetch(`${BRAIN_URL}/api/brain/journey_features`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      journey_id: journeyId || null,
      thickness: thickness || 'thin',
      area,
      unit_test_path: unitTestPath || null,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
  }

  const feature = await resp.json();
  console.log(`✅ Feature 已写入 Brain DB`);
  console.log(`   ID: ${feature.id}`);
  console.log(`   名称: ${feature.name}, thickness: ${feature.thickness}`);
  console.log(`   Notion 同步: 待 Brain tick 推送`);
  return feature;
}
```

保留：参数解析（`--name`, `--journey-id`, `--thickness`, `--area`, `--unit-test-path`）
删除：Maturity gating 的 Notion API 查询（Brain API 端不强制 gating，gating 逻辑在 walking-skeleton skill 文档中说明）

- [ ] **Step 2: 改写 thicken.js**

删除 Notion PATCH 调用，替换为：

```javascript
async function thicken({ featureId, to, reason, replacesOldThin }) {
  if (!replacesOldThin) throw new Error('--replaces-old-thin 必填');
  if (!reason) throw new Error('--reason 必填');

  const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

  const resp = await fetch(`${BRAIN_URL}/api/brain/journey_features/${featureId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thickness: to }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
  }

  const feature = await resp.json();
  console.log(`✅ Feature 已升级 thickness → ${feature.thickness}`);
  console.log(`   Notion 同步: 待 Brain tick 重推（notion_synced_at=null）`);
  return feature;
}
```

保留：`--feature-id`, `--to`, `--reason`, `--replaces-old-thin` 参数解析

- [ ] **Step 3: 本地验证 add-feature.js**

```bash
# 先获取一个 journey id
JOURNEY_ID=$(psql postgresql://localhost/cecelia -tAc "SELECT id FROM journeys ORDER BY created_at DESC LIMIT 1")
node ~/.claude/skills/walking-skeleton/scripts/add-feature.js \
  --name "测试 Feature" \
  --journey-id "$JOURNEY_ID" \
  --thickness "thin"
```

期望：输出 `✅ Feature 已写入 Brain DB`

---

### Task 8: 改写 notion-create-issue.js（Brain-first）

**Files:**
- Modify: `scripts/notion-create-issue.js`

- [ ] **Step 1: 读取现有文件**

```bash
cat scripts/notion-create-issue.js
```

- [ ] **Step 2: 改写核心逻辑**

删除 Notion API 直接调用，替换为 Brain API：

```javascript
// 改写后的核心函数
async function createIssue({ title, priority, subArea, body, prUrl }) {
  const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

  const resp = await fetch(`${BRAIN_URL}/api/brain/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      priority: priority || 'P2',
      sub_area: subArea || null,
      body: body || null,
      pr_url: prUrl || null,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Brain API 错误 ${resp.status}: ${err.error || resp.statusText}`);
  }

  const issue = await resp.json();
  console.log(`✅ Issue 已写入 Brain DB`);
  console.log(`   ID: ${issue.id}`);
  console.log(`   标题: ${issue.title}, 优先级: ${issue.priority}`);
  console.log(`   Notion 同步: 待 Brain tick 推送`);
  return issue;
}
```

保留：sub_area 自动推断逻辑（从 git diff 推断），命令行参数解析
删除：`loadNotionKey()`, Notion DB ID 常量, `fetch(notionApiBase + '/pages', ...)` 调用

- [ ] **Step 3: 本地验证**

```bash
node scripts/notion-create-issue.js \
  --title "Sprint B 测试 Issue" \
  --priority P3 \
  --sub-area brain \
  --body "Brain-first 改写验证"
```

期望：输出 `✅ Issue 已写入 Brain DB` + 查询 DB 确认行存在

- [ ] **Step 4: 提交**

```bash
git add scripts/notion-create-issue.js
git commit -m "feat: notion-create-issue.js Brain-first 改写（删旧 Notion-direct 代码）"
```

---

### Task 9: DoD 勾选 + PR 准备

- [ ] **Step 1: 运行全量测试**

```bash
cd packages/brain && npx vitest run src/__tests__/journeys-api.test.js src/__tests__/notion-push-sync.test.js --reporter=verbose 2>&1 | tail -20
```

期望：所有测试 PASS

- [ ] **Step 2: smoke 全量验证**

```bash
bash packages/brain/scripts/smoke/notion-brain-first-smoke.sh
```

期望：`✅ notion-brain-first smoke 全部通过`

- [ ] **Step 3: 写 learning 文档**

```bash
mkdir -p docs/learnings
cat > docs/learnings/cp-0522140154-sprint-b-brain-first-notion-sync.md << 'EOF'
## Sprint B — Brain 优先写入 + 异步 Notion 推送（2026-05-22）

### 根本原因
walking-skeleton 系列脚本直接写 Notion（Notion-first），Brain DB 对这些数据无感知，
且 Notion 不可用时整个写操作失败。

### 下次预防
- [ ] walking-skeleton 相关操作统一走 Brain API，不直接调 Notion API
- [ ] 新增 Notion 相关字段的 DB 列时，确认 recurring-notion-sync.js 的 notionReq 已 export
- [ ] Brain tick 集成新模块时，用 dynamic import 模式（`await import('./module.js')`）
- [ ] journey_features 推 Notion 时需确认 journey.notion_id 已非 NULL（否则 relation 为空）
EOF
git add docs/learnings/cp-0522140154-sprint-b-brain-first-notion-sync.md
git commit -m "docs: Sprint B learning"
```

- [ ] **Step 4: push + PR**

```bash
git push origin HEAD
gh pr create \
  --title "feat(brain): Sprint B — walking-skeleton Brain-first + 异步 Notion 推送" \
  --body "$(cat <<'EOF'
## Summary
- Brain API: POST /journeys, POST /journey_features, PATCH /journey_features/:id, POST /issues
- notion-push-sync.js: 每 tick 扫描 notion_synced_at=NULL 行批量推 Notion
- init-journey.js / add-feature.js / thicken.js / notion-create-issue.js 改为调 Brain API
- 删除所有 Notion-direct 代码（减肥后增肌）

## Test Plan
- [ ] brain-unit: journeys-api.test.js + notion-push-sync.test.js 全 PASS
- [ ] real-env-smoke: notion-brain-first-smoke.sh PASS
- [ ] 本地：init-journey.js / notion-create-issue.js 调通 Brain API + DB 有对应行

🤖 Generated with Claude Code
EOF
)"
```
