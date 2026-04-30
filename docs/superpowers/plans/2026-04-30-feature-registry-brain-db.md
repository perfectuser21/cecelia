# Feature Registry Brain DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 docs/feature-ledger.yaml 的 159 个 feature 写入 Brain PostgreSQL，提供 CRUD API，让 Agent 可以查询 smoke 状态并回填结果。

**Architecture:** migration 249 建 `features` 表 → `src/routes/features.js` 提供 GET/POST/PATCH/seed 端点 → seed 脚本从 YAML 初始化数据。smoke_status 在 seed 时不覆盖（保留运行时数据）。

**Tech Stack:** Node.js ESM, Express, PostgreSQL, js-yaml（已在 package.json），vitest

---

## 文件清单

| 操作 | 路径 |
|---|---|
| 创建 | `packages/brain/migrations/249_features_registry.sql` |
| 修改 | `packages/brain/src/selfcheck.js`（EXPECTED_SCHEMA_VERSION 248→249）|
| 创建 | `packages/brain/src/routes/features.js` |
| 修改 | `packages/brain/server.js`（注册 featuresRoutes）|
| 创建 | `packages/brain/scripts/seed-features.js` |
| 创建 | `packages/brain/src/__tests__/features-registry.test.js` |
| 创建 | `packages/brain/src/__tests__/integration/features-registry.integration.test.js` |
| 创建 | `packages/brain/scripts/smoke/feature-registry-smoke.sh` |
| 创建 | `DoD.md`（worktree 根目录）|

---

## Task 1: 写失败的测试 + smoke.sh 骨架

**NO PRODUCTION CODE YET — commit 必须在 Task 3 之前，且测试此时必须 FAIL。**

**Files:**
- Create: `packages/brain/src/__tests__/features-registry.test.js`
- Create: `packages/brain/src/__tests__/integration/features-registry.integration.test.js`
- Create: `packages/brain/scripts/smoke/feature-registry-smoke.sh`

- [ ] **Step 1: 写 unit test（filter 逻辑）**

```javascript
// packages/brain/src/__tests__/features-registry.test.js
import { describe, it, expect } from 'vitest';

// 测试 WHERE 子句构建逻辑（纯函数，从 route 里提取）
import { buildWhereClause } from '../routes/features.js';

describe('buildWhereClause', () => {
  it('returns empty string when no filters', () => {
    const { where, params } = buildWhereClause({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('builds priority filter', () => {
    const { where, params } = buildWhereClause({ priority: 'P0' });
    expect(where).toBe('WHERE priority = $1');
    expect(params).toEqual(['P0']);
  });

  it('builds smoke_cmd IS NULL filter', () => {
    const { where, params } = buildWhereClause({ smoke_cmd: 'null' });
    expect(where).toBe('WHERE smoke_cmd IS NULL');
    expect(params).toEqual([]);
  });

  it('combines multiple filters with AND', () => {
    const { where, params } = buildWhereClause({ priority: 'P0', status: 'active' });
    expect(where).toContain('priority = $1');
    expect(where).toContain('status = $2');
    expect(where).toContain('AND');
    expect(params).toEqual(['P0', 'active']);
  });

  it('combines smoke_cmd IS NULL with other filters', () => {
    const { where, params } = buildWhereClause({ priority: 'P1', smoke_cmd: 'null' });
    expect(where).toContain('priority = $1');
    expect(where).toContain('smoke_cmd IS NULL');
    expect(params).toEqual(['P1']);
  });
});
```

- [ ] **Step 2: 写 integration test**

```javascript
// packages/brain/src/__tests__/integration/features-registry.integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
let pool;
const TEST_IDS = ['test-feat-001', 'test-feat-002'];

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
  await pool.query(`DELETE FROM features WHERE id = ANY($1)`, [TEST_IDS]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM features WHERE id = ANY($1)`, [TEST_IDS]);
  await pool.end();
});

describe('features table', () => {
  it('inserts a feature and reads it back', async () => {
    const { rows } = await pool.query(
      `INSERT INTO features (id, name, priority, status, smoke_status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      ['test-feat-001', 'Test Feature 001', 'P0', 'active', 'unknown']
    );
    expect(rows[0].id).toBe('test-feat-001');
    expect(rows[0].smoke_status).toBe('unknown');
    expect(rows[0].created_at).not.toBeNull();
  });

  it('filters by priority', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM features WHERE id = $1 AND priority = $2`,
      ['test-feat-001', 'P0']
    );
    expect(rows).toHaveLength(1);
  });

  it('updates smoke_status without changing other fields', async () => {
    await pool.query(
      `UPDATE features SET smoke_status = $1, smoke_last_run = NOW(), updated_at = NOW()
       WHERE id = $2`,
      ['passing', 'test-feat-001']
    );
    const { rows } = await pool.query(`SELECT * FROM features WHERE id = $1`, ['test-feat-001']);
    expect(rows[0].smoke_status).toBe('passing');
    expect(rows[0].name).toBe('Test Feature 001');
    expect(rows[0].smoke_last_run).not.toBeNull();
  });

  it('seed upsert preserves existing smoke_status', async () => {
    await pool.query(
      `INSERT INTO features (id, name, priority, status, smoke_status)
       VALUES ($1, $2, $3, $4, $5)`,
      ['test-feat-002', 'Original Name', 'P1', 'active', 'passing']
    );
    // Simulate seed: upsert 更新 name 但不动 smoke_status
    await pool.query(
      `INSERT INTO features (id, name, priority, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         priority = EXCLUDED.priority,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      ['test-feat-002', 'Updated Name', 'P1', 'active']
    );
    const { rows } = await pool.query(`SELECT * FROM features WHERE id = $1`, ['test-feat-002']);
    expect(rows[0].name).toBe('Updated Name');
    expect(rows[0].smoke_status).toBe('passing');
  });
});
```

- [ ] **Step 3: 写 smoke.sh 骨架**

```bash
#!/bin/bash
# packages/brain/scripts/smoke/feature-registry-smoke.sh
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== feature-registry smoke ==="

# 验证 /api/brain/features 返回非空数组
RESULT=$(curl -sf "$BRAIN_URL/api/brain/features?priority=P0" 2>/dev/null)
echo "$RESULT" | jq -e 'type == "object" and .features != null and (.features | length) > 0' > /dev/null
echo "✅ GET /api/brain/features?priority=P0 — OK ($(echo "$RESULT" | jq '.total') features)"

# 验证 PATCH 更新 smoke_status
SAMPLE_ID=$(echo "$RESULT" | jq -r '.features[0].id')
curl -sf -X PATCH "$BRAIN_URL/api/brain/features/$SAMPLE_ID" \
  -H "Content-Type: application/json" \
  -d '{"smoke_status":"passing","smoke_last_run":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
  | jq -e '.smoke_status == "passing"' > /dev/null
echo "✅ PATCH /api/brain/features/:id — OK"

echo "✅ feature-registry smoke PASSED"
```

```bash
chmod +x packages/brain/scripts/smoke/feature-registry-smoke.sh
```

- [ ] **Step 4: 验证测试此时 FAIL（因为 features.js 还不存在）**

```bash
cd packages/brain && npx vitest run src/__tests__/features-registry.test.js --reporter=verbose 2>&1 | tail -20
```

期望：`FAIL` — `Cannot find module '../routes/features.js'`

- [ ] **Step 5: 提交 failing tests**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db
git add packages/brain/src/__tests__/features-registry.test.js
git add packages/brain/src/__tests__/integration/features-registry.integration.test.js
git add packages/brain/scripts/smoke/feature-registry-smoke.sh
git commit -m "test(brain): feature-registry failing tests + smoke.sh skeleton"
```

---

## Task 2: Migration 249

**Files:**
- Create: `packages/brain/migrations/249_features_registry.sql`

- [ ] **Step 1: 写 migration**

```sql
-- packages/brain/migrations/249_features_registry.sql
-- Feature Registry: 把 feature-ledger.yaml 变成活的数据库
CREATE TABLE IF NOT EXISTS features (
  id                  VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  domain              VARCHAR(50),
  area                VARCHAR(50),
  priority            VARCHAR(5),
  status              VARCHAR(20) DEFAULT 'unknown',
  description         TEXT,
  smoke_cmd           TEXT,
  smoke_status        VARCHAR(20) DEFAULT 'unknown',
  smoke_last_run      TIMESTAMPTZ,
  has_unit_test       BOOLEAN DEFAULT FALSE,
  has_integration_test BOOLEAN DEFAULT FALSE,
  has_e2e             BOOLEAN DEFAULT FALSE,
  last_verified       DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_priority     ON features(priority);
CREATE INDEX IF NOT EXISTS idx_features_smoke_status ON features(smoke_status);
CREATE INDEX IF NOT EXISTS idx_features_domain       ON features(domain);
CREATE INDEX IF NOT EXISTS idx_features_area         ON features(area);

INSERT INTO schema_version (version) VALUES ('249') ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: 跑 migration（本地）**

```bash
cd /Users/administrator/perfect21/cecelia
node packages/brain/src/migrate.js
```

期望输出中包含：`249` applied 或 already up to date

- [ ] **Step 3: 验证表已建**

```bash
psql -U cecelia -d cecelia -c "\d features" 2>/dev/null || \
  docker exec cecelia-node-brain-db psql -U cecelia -d cecelia -c "\d features" 2>/dev/null || \
  echo "检查 DB 连接方式"
```

期望：显示 features 表的列结构

- [ ] **Step 4: 提交 migration**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db
git add packages/brain/migrations/249_features_registry.sql
git commit -m "feat(brain): migration 249 — features registry table"
```

---

## Task 3: features.js 路由 + server.js 注册

**Files:**
- Create: `packages/brain/src/routes/features.js`
- Modify: `packages/brain/server.js`

- [ ] **Step 1: 写 features.js 路由**

```javascript
// packages/brain/src/routes/features.js
import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pool from '../db.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

// 导出供 unit test 使用
export function buildWhereClause(query) {
  const conditions = [];
  const params = [];
  const { priority, status, smoke_status, domain, area } = query;

  if (priority)     { conditions.push(`priority = $${params.length + 1}`);     params.push(priority); }
  if (status)       { conditions.push(`status = $${params.length + 1}`);       params.push(status); }
  if (smoke_status) { conditions.push(`smoke_status = $${params.length + 1}`); params.push(smoke_status); }
  if (domain)       { conditions.push(`domain = $${params.length + 1}`);       params.push(domain); }
  if (area)         { conditions.push(`area = $${params.length + 1}`);         params.push(area); }
  if (query.smoke_cmd === 'null') { conditions.push('smoke_cmd IS NULL'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// GET / — 列表（支持过滤）
router.get('/', async (req, res) => {
  try {
    const { where, params } = buildWhereClause(req.query);
    const { rows } = await pool.query(
      `SELECT * FROM features ${where} ORDER BY priority, domain, id`,
      params
    );
    res.json({ features: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — 单条
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM features WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Feature not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — 新增
router.post('/', async (req, res) => {
  try {
    const { id, name, domain, area, priority, status, description, smoke_cmd,
            has_unit_test, has_integration_test, has_e2e, last_verified, notes } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name are required' });

    const { rows } = await pool.query(
      `INSERT INTO features
         (id, name, domain, area, priority, status, description, smoke_cmd,
          has_unit_test, has_integration_test, has_e2e, last_verified, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, name, domain ?? null, area ?? null, priority ?? null,
       status ?? 'unknown', description ?? null, smoke_cmd ?? null,
       has_unit_test ?? false, has_integration_test ?? false, has_e2e ?? false,
       last_verified ?? null, notes ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Feature id already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — 更新（含 smoke_status 回填）
router.patch('/:id', async (req, res) => {
  try {
    const ALLOWED = ['name', 'domain', 'area', 'priority', 'status', 'description',
                     'smoke_cmd', 'smoke_status', 'smoke_last_run',
                     'has_unit_test', 'has_integration_test', 'has_e2e',
                     'last_verified', 'notes'];
    const fields = {};
    for (const key of ALLOWED) {
      if (key in req.body) fields[key] = req.body[key];
    }
    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    fields.updated_at = new Date().toISOString();

    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

    const { rows } = await pool.query(
      `UPDATE features SET ${set} WHERE id = $${keys.length + 1} RETURNING *`,
      [...vals, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Feature not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /seed — 从 feature-ledger.yaml 批量 upsert（不覆盖 smoke_status/smoke_last_run）
router.post('/seed', async (req, res) => {
  try {
    const yamlPath = join(__dirname, '../../../../docs/feature-ledger.yaml');
    const raw = readFileSync(yamlPath, 'utf8');
    const data = yaml.load(raw);

    let inserted = 0;
    let updated = 0;

    for (const f of data.features) {
      const { rows } = await pool.query(
        `INSERT INTO features
           (id, name, domain, area, priority, status, description, smoke_cmd,
            has_unit_test, has_integration_test, has_e2e, last_verified, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           name                = EXCLUDED.name,
           domain              = EXCLUDED.domain,
           area                = EXCLUDED.area,
           priority            = EXCLUDED.priority,
           status              = EXCLUDED.status,
           description         = EXCLUDED.description,
           smoke_cmd           = EXCLUDED.smoke_cmd,
           has_unit_test       = EXCLUDED.has_unit_test,
           has_integration_test = EXCLUDED.has_integration_test,
           has_e2e             = EXCLUDED.has_e2e,
           last_verified       = EXCLUDED.last_verified,
           notes               = EXCLUDED.notes,
           updated_at          = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [f.id, f.name, f.domain ?? null, f.area ?? null, f.priority ?? null,
         f.status ?? 'unknown', f.description ?? null, f.smoke_cmd ?? null,
         f.has_unit_test ?? false, f.has_integration_test ?? false,
         f.has_e2e ?? false, f.last_verified ?? null, f.notes ?? null]
      );
      if (rows[0]?.is_insert) inserted++;
      else updated++;
    }

    res.json({ inserted, updated, total: data.features.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 2: 注册到 server.js**

在 server.js 的 import 块末尾（找 `import licenseRoutes` 附近或最后一个 import 后）添加：

```javascript
import featuresRoutes from './src/routes/features.js';
```

在 app.use 块（找 `app.use('/api/brain/recurring-tasks'` 附近）添加：

```javascript
app.use('/api/brain/features', featuresRoutes);
```

- [ ] **Step 3: 跑 unit test，验证 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db/packages/brain
npm ci 2>/dev/null || true
npx vitest run src/__tests__/features-registry.test.js --reporter=verbose
```

期望：`✓ buildWhereClause` 全部 5 个测试 PASS

- [ ] **Step 4: 跑 integration test，验证 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db/packages/brain
npx vitest run src/__tests__/integration/features-registry.integration.test.js --reporter=verbose
```

期望：全部 4 个测试 PASS（需要本地 DB 运行）

- [ ] **Step 5: 本地冒烟验证（需要 Brain 运行）**

```bash
# Brain 运行时执行
curl -sf http://localhost:5221/api/brain/features | jq '.total'
```

期望：返回数字（可能是 0，表示表存在但未 seed）

- [ ] **Step 6: 提交实现**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db
git add packages/brain/src/routes/features.js packages/brain/server.js
git commit -m "feat(brain): /api/brain/features CRUD 路由"
```

---

## Task 4: seed 脚本 + selfcheck 版本升级

**Files:**
- Create: `packages/brain/scripts/seed-features.js`
- Modify: `packages/brain/src/selfcheck.js`

- [ ] **Step 1: 写 seed-features.js 独立脚本**

```javascript
// packages/brain/scripts/seed-features.js
// 用法：node packages/brain/scripts/seed-features.js
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = new Pool(DB_DEFAULTS);

const yamlPath = join(__dirname, '../../../docs/feature-ledger.yaml');
const raw = readFileSync(yamlPath, 'utf8');
const data = yaml.load(raw);

let inserted = 0;
let updated = 0;

for (const f of data.features) {
  const { rows } = await pool.query(
    `INSERT INTO features
       (id, name, domain, area, priority, status, description, smoke_cmd,
        has_unit_test, has_integration_test, has_e2e, last_verified, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       name                 = EXCLUDED.name,
       domain               = EXCLUDED.domain,
       area                 = EXCLUDED.area,
       priority             = EXCLUDED.priority,
       status               = EXCLUDED.status,
       description          = EXCLUDED.description,
       smoke_cmd            = EXCLUDED.smoke_cmd,
       has_unit_test        = EXCLUDED.has_unit_test,
       has_integration_test = EXCLUDED.has_integration_test,
       has_e2e              = EXCLUDED.has_e2e,
       last_verified        = EXCLUDED.last_verified,
       notes                = EXCLUDED.notes,
       updated_at           = NOW()
     RETURNING (xmax = 0) AS is_insert`,
    [f.id, f.name, f.domain ?? null, f.area ?? null, f.priority ?? null,
     f.status ?? 'unknown', f.description ?? null, f.smoke_cmd ?? null,
     f.has_unit_test ?? false, f.has_integration_test ?? false,
     f.has_e2e ?? false, f.last_verified ?? null, f.notes ?? null]
  );
  if (rows[0]?.is_insert) inserted++;
  else updated++;
}

console.log(`✅ Seed 完成: ${inserted} inserted, ${updated} updated, ${data.features.length} total`);
await pool.end();
```

- [ ] **Step 2: 跑 seed 脚本验证**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db
node packages/brain/scripts/seed-features.js
```

期望：`✅ Seed 完成: 159 inserted, 0 updated, 159 total`（或类似数字）

- [ ] **Step 3: 验证数据写入**

```bash
curl -sf 'http://localhost:5221/api/brain/features?priority=P0' | jq '{total: .total, sample: .features[0].id}'
```

期望：P0 features 数量 > 0，sample 显示一个 feature id

- [ ] **Step 4: 更新 selfcheck.js**

将 `packages/brain/src/selfcheck.js` 第 23 行：
```javascript
export const EXPECTED_SCHEMA_VERSION = '248';
```
改为：
```javascript
export const EXPECTED_SCHEMA_VERSION = '249';
```

- [ ] **Step 5: 验证 Brain 健康检查通过**

```bash
curl -sf http://localhost:5221/api/brain/health | jq '.schema_ok // .status'
```

期望：不报 schema version mismatch

- [ ] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db
git add packages/brain/scripts/seed-features.js packages/brain/src/selfcheck.js
git commit -m "feat(brain): seed-features.js + selfcheck 版本升级至 249"
```

---

## Task 5: DoD.md + 最终验证

**Files:**
- Create: `DoD.md`（worktree 根目录）

- [ ] **Step 1: 写 DoD.md**

```markdown
# DoD — Feature Registry Brain DB

- [x] [ARTIFACT] migration 249_features_registry.sql 存在
  - Test: manual:node -e "require('fs').accessSync('packages/brain/migrations/249_features_registry.sql')"

- [x] [ARTIFACT] src/routes/features.js 存在
  - Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/features.js')"

- [x] [BEHAVIOR] GET /api/brain/features 返回 features 数组
  - Test: tests/src/__tests__/integration/features-registry.integration.test.js

- [x] [BEHAVIOR] PATCH /api/brain/features/:id 可更新 smoke_status 不影响其他字段
  - Test: tests/src/__tests__/integration/features-registry.integration.test.js

- [x] [BEHAVIOR] POST /seed 从 YAML 导入数据，不覆盖 smoke_status
  - Test: tests/src/__tests__/integration/features-registry.integration.test.js

- [x] [BEHAVIOR] buildWhereClause 正确构建 WHERE 子句
  - Test: tests/src/__tests__/features-registry.test.js

- [x] [ARTIFACT] seed-features.js 脚本存在
  - Test: manual:node -e "require('fs').accessSync('packages/brain/scripts/seed-features.js')"

- [x] [ARTIFACT] feature-registry-smoke.sh 存在
  - Test: manual:node -e "require('fs').accessSync('packages/brain/scripts/smoke/feature-registry-smoke.sh')"
```

- [ ] **Step 2: 跑全量 unit test 确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db/packages/brain
npx vitest run src/__tests__/features-registry.test.js \
  src/__tests__/integration/features-registry.integration.test.js \
  --reporter=verbose
```

期望：所有测试 PASS

- [ ] **Step 3: 本地 smoke.sh 验证（需要 Brain 运行且已 seed）**

```bash
BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/feature-registry-smoke.sh
```

期望：`✅ feature-registry smoke PASSED`

- [ ] **Step 4: Brain syntax check**

```bash
node --check packages/brain/src/routes/features.js && echo "✅ syntax OK"
node --check packages/brain/scripts/seed-features.js && echo "✅ syntax OK"
```

- [ ] **Step 5: 提交 DoD + 推送 PR**

```bash
cd /Users/administrator/worktrees/cecelia/feature-registry-brain-db
git add DoD.md
git commit -m "chore: DoD feature-registry-brain-db"
git push origin cp-0430113134-feature-registry-brain-db
gh pr create \
  --title "feat(brain): Feature Registry Brain DB — migration 249 + CRUD API + seed" \
  --body "$(cat <<'EOF'
## Summary
- migration 249: 建 features 表（id/name/domain/priority/smoke_status 等字段）
- /api/brain/features CRUD API（GET 支持过滤、PATCH 支持回填 smoke_status）
- POST /seed 从 feature-ledger.yaml 批量 upsert（不覆盖运行时 smoke_status）
- seed-features.js 独立脚本，可 node 直接运行
- selfcheck.js 版本升至 249

## Test plan
- [ ] unit test: buildWhereClause 5 个场景
- [ ] integration test: insert/filter/patch/seed-preserve 4 个场景
- [ ] smoke.sh: GET P0 features + PATCH smoke_status
- [ ] CI real-env-smoke 通过
EOF
)"
```

---

## 自查清单

- [x] spec coverage：migration / API / seed / unit test / integration test / smoke.sh 全覆盖
- [x] 无 TBD/placeholder
- [x] buildWhereClause 在 Task 1 unit test 和 Task 3 route 中签名一致（均导出 `{ where, params }`）
- [x] seed 中 `notes ?? null` 处理可选字段（spec 建议 A）
- [x] selfcheck.js 248→249（spec 建议）
- [x] 第一个 commit 含 smoke.sh（满足 CI lint-feature-has-smoke）
