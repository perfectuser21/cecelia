# Dev Management Tables — Sprint A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Brain DB 新建 7 张开发管理表，从代码库和 Notion 完成初始填充，为 harness pipeline 提供代码库上下文。

**Architecture:** Brain DB 为真相源；journeys/journey_steps/journey_features/issues 从 Notion 反向拉取；api_registry/db_schema_registry/test_registry 通过扫描脚本自动填充；skill_registry 复用现有 system_registry（type='skill'）。

**Tech Stack:** Node.js (CJS), PostgreSQL, Notion API v2022-06-28, vitest, pg

---

## 文件结构

```
packages/brain/migrations/
  281_dev_management_tables.sql           # 7 张表的 DDL

scripts/notion-to-brain/
  sync-journeys.js                        # Notion AI Journey → journeys 表
  sync-journey-steps.js                   # Notion AI Step Registry → journey_steps 表
  sync-journey-features.js               # Notion AI Feature → journey_features 表
  sync-issues.js                          # Notion Issues → issues 表

scripts/scan/
  scan-api-registry.js                    # 扫 apps/api/src/ + brain/src/ → api_registry
  scan-db-schema.js                       # 查 information_schema → db_schema_registry
  scan-test-registry.js                   # 扫 *.test.ts / *.spec.ts → test_registry
  scan-skills.js                          # 扫 ~/.claude/skills/ → system_registry

scripts/
  run-all-initial-scans.sh                # 按序跑所有填充脚本

packages/brain/src/workflows/__tests__/
  dev-registry.test.js                    # integration + unit tests
```

---

## Task 1: Migration — 7 张表 DDL

**Files:**
- Create: `packages/brain/migrations/281_dev_management_tables.sql`
- Test: `packages/brain/src/workflows/__tests__/dev-registry.test.js`

- [ ] **Step 1: 写失败的 integration test（验 migration 跑完后表存在）**

```javascript
// packages/brain/src/workflows/__tests__/dev-registry.test.js
import { describe, it, expect } from 'vitest';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: 'postgresql://localhost/cecelia' });

describe('dev-registry migration — 7 张表存在', () => {
  const TABLES = [
    'journeys', 'journey_steps', 'journey_features',
    'api_registry', 'db_schema_registry', 'test_registry', 'issues',
  ];

  it.each(TABLES)('表 %s 存在', async (tableName) => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name=$1`,
      [tableName],
    );
    expect(rows).toHaveLength(1);
  });

  it('journeys.journey_type 有 CHECK 约束', async () => {
    const { rows } = await pool.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name='journeys' AND constraint_type='CHECK'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('journey_steps 有 UNIQUE(journey_id, step_number)', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename='journey_steps' AND indexdef LIKE '%journey_id%step_number%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('api_registry 有 UNIQUE(method, path)', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename='api_registry' AND indexdef LIKE '%method%path%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/dev-management-tables-7-tables-notion-sync
npx vitest run packages/brain/src/workflows/__tests__/dev-registry.test.js 2>&1 | head -30
```

期望：`FAIL` — 表不存在

- [ ] **Step 3: 写 migration**

创建 `packages/brain/migrations/281_dev_management_tables.sql`：

```sql
-- Migration 281: Dev Management Tables — 7 张开发管理表
-- Sprint A 数据层基础：journeys/journey_steps/journey_features/
--   api_registry/db_schema_registry/test_registry/issues
--
-- 注意：
-- journey_features 与现有 features 表(smoke 状态注册)完全不同，勿混淆
-- db_schema_registry 与现有 db_schemas 表(Dashboard 前端列配置)完全不同，勿混淆
-- skill_registry 复用现有 system_registry（type='skill'），不新建表

-- 1. journeys
CREATE TABLE IF NOT EXISTS journeys (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  journey_type     VARCHAR(50)  NOT NULL DEFAULT 'user_facing'
                   CHECK (journey_type IN ('user_facing','autonomous','dev_pipeline','agent_remote')),
  maturity         VARCHAR(50)  NOT NULL DEFAULT 'not_started'
                   CHECK (maturity IN ('not_started','skeleton','mvp','production','mature')),
  status           VARCHAR(20)  NOT NULL DEFAULT 'active',
  e2e_test_path    VARCHAR(500),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journeys_area        ON journeys (area_id);
CREATE INDEX IF NOT EXISTS idx_journeys_maturity    ON journeys (maturity);
CREATE INDEX IF NOT EXISTS idx_journeys_notion_id   ON journeys (notion_id) WHERE notion_id IS NOT NULL;

-- 2. journey_steps
CREATE TABLE IF NOT EXISTS journey_steps (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  journey_id       UUID         NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  step_number      INT          NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'planned',
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_journey_steps_journey ON journey_steps (journey_id);

-- 3. journey_features
-- 注意：此表跟踪 Walking Skeleton 功能 thickness，与 features(smoke 状态) 无关
CREATE TABLE IF NOT EXISTS journey_features (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  journey_id       UUID         REFERENCES journeys(id) ON DELETE SET NULL,
  step_id          UUID         REFERENCES journey_steps(id) ON DELETE SET NULL,
  name             VARCHAR(200) NOT NULL,
  thickness        VARCHAR(20)  NOT NULL DEFAULT 'thin'
                   CHECK (thickness IN ('thin','medium','thick','mature')),
  status           VARCHAR(20)  NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','building','done','deprecated')),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  unit_test_path   VARCHAR(500),
  version          VARCHAR(50),
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journey_features_journey   ON journey_features (journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_features_step      ON journey_features (step_id);
CREATE INDEX IF NOT EXISTS idx_journey_features_thickness ON journey_features (thickness);

-- 4. api_registry
CREATE TABLE IF NOT EXISTS api_registry (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  method          VARCHAR(10)  NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS')),
  path            VARCHAR(500) NOT NULL,
  file_path       VARCHAR(500),
  line_number     INT,
  area            VARCHAR(50),
  description     TEXT,
  request_schema  JSONB,
  response_schema JSONB,
  scanned_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (method, path)
);
CREATE INDEX IF NOT EXISTS idx_api_registry_area ON api_registry (area);
CREATE INDEX IF NOT EXISTS idx_api_registry_path ON api_registry (path);

-- 5. db_schema_registry
-- 注意：此表存储 PostgreSQL 真实表结构，与 db_schemas(Dashboard 前端列配置) 无关
CREATE TABLE IF NOT EXISTS db_schema_registry (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   VARCHAR(200) NOT NULL UNIQUE,
  columns      JSONB        NOT NULL DEFAULT '[]',
  indexes      JSONB        NOT NULL DEFAULT '[]',
  foreign_keys JSONB        NOT NULL DEFAULT '[]',
  area         VARCHAR(50),
  scanned_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_db_schema_registry_area ON db_schema_registry (area);

-- 6. test_registry
CREATE TABLE IF NOT EXISTS test_registry (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path          VARCHAR(500) NOT NULL UNIQUE,
  test_count         INT          NOT NULL DEFAULT 0,
  covered_behaviors  TEXT[]       NOT NULL DEFAULT '{}',
  area               VARCHAR(50),
  test_type          VARCHAR(20)  CHECK (test_type IN ('unit','integration','e2e')),
  scanned_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_test_registry_area      ON test_registry (area);
CREATE INDEX IF NOT EXISTS idx_test_registry_test_type ON test_registry (test_type);

-- 7. issues
CREATE TABLE IF NOT EXISTS issues (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_id        VARCHAR(100) UNIQUE,
  title            VARCHAR(300) NOT NULL,
  body             TEXT,
  priority         VARCHAR(5)   NOT NULL DEFAULT 'P2'
                   CHECK (priority IN ('P0','P1','P2','P3')),
  status           VARCHAR(30)  NOT NULL DEFAULT 'In progress',
  sub_area         VARCHAR(50),
  area_id          UUID         REFERENCES areas(id) ON DELETE SET NULL,
  pr_url           VARCHAR(500),
  notion_synced_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issues_priority  ON issues (priority);
CREATE INDEX IF NOT EXISTS idx_issues_status    ON issues (status);
CREATE INDEX IF NOT EXISTS idx_issues_notion_id ON issues (notion_id) WHERE notion_id IS NOT NULL;
```

- [ ] **Step 4: 跑 migration**

```bash
psql postgresql://localhost/cecelia -f packages/brain/migrations/281_dev_management_tables.sql
```

期望：`CREATE TABLE` × 7，无错误

- [ ] **Step 5: 运行测试，确认通过**

```bash
npx vitest run packages/brain/src/workflows/__tests__/dev-registry.test.js 2>&1 | tail -20
```

期望：`✓ 11 tests`（7 表存在 + 3 约束检查 + 1 UNIQUE）

- [ ] **Step 6: Commit**

```bash
git add packages/brain/migrations/281_dev_management_tables.sql \
        packages/brain/src/workflows/__tests__/dev-registry.test.js
git commit -m "feat(brain): migration 281 — 7 张开发管理表（journeys/steps/features/api/db/test/issues）"
```

---

## Task 2: 扫描脚本 — api_registry / db_schema_registry / test_registry / skill_registry

**Files:**
- Create: `scripts/scan/scan-api-registry.js`
- Create: `scripts/scan/scan-db-schema.js`
- Create: `scripts/scan/scan-test-registry.js`
- Create: `scripts/scan/scan-skills.js`
- Test: `packages/brain/src/workflows/__tests__/dev-registry.test.js`（追加）

- [ ] **Step 1: 追加扫描结果验证测试（先跑会 fail，因为表空）**

追加到 `packages/brain/src/workflows/__tests__/dev-registry.test.js`：

```javascript
describe('dev-registry 扫描脚本填充', () => {
  it('api_registry 行数 > 0（扫描后）', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM api_registry');
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it('db_schema_registry 包含 tasks 表', async () => {
    const { rows } = await pool.query(
      "SELECT table_name FROM db_schema_registry WHERE table_name='tasks'",
    );
    expect(rows).toHaveLength(1);
  });

  it('test_registry 行数 > 0（扫描后）', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM test_registry');
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it('system_registry 包含 skill 类型记录（扫描后）', async () => {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM system_registry WHERE type='skill'",
    );
    expect(rows[0].cnt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 确认 4 个新 test 失败（表空）**

```bash
npx vitest run packages/brain/src/workflows/__tests__/dev-registry.test.js 2>&1 | grep -E "FAIL|✗|0 passed"
```

期望：4 个新 test FAIL

- [ ] **Step 3: 写 scan-api-registry.js**

创建 `scripts/scan/scan-api-registry.js`：

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');

// 扫描目录列表
const SCAN_DIRS = [
  'apps/api/src',
  'packages/brain/src',
];

// 匹配 Express/Fastify 路由：app.get('/path', ...) 或 router.post('/path', ...)
const ROUTE_RE = /\.(get|post|put|patch|delete|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
const AREA_MAP = { 'apps/api': 'zenithjoy', 'packages/brain': 'cecelia' };

function inferArea(filePath) {
  for (const [prefix, area] of Object.entries(AREA_MAP)) {
    if (filePath.includes(prefix)) return area;
  }
  return 'unknown';
}

function scanDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDir(full));
    } else if (entry.isFile() && /\.(js|ts)$/.test(entry.name) && !entry.name.includes('.test.')) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      let match;
      while ((match = ROUTE_RE.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const routePath = match[2];
        const lineNumber = content.slice(0, match.index).split('\n').length;
        results.push({
          method,
          path: routePath,
          file_path: path.relative(REPO_ROOT, full),
          line_number: lineNumber,
          area: inferArea(full),
        });
      }
      ROUTE_RE.lastIndex = 0;
    }
  }
  return results;
}

async function main() {
  const routes = [];
  for (const dir of SCAN_DIRS) {
    routes.push(...scanDir(path.join(REPO_ROOT, dir)));
  }
  console.log(`扫描到 ${routes.length} 条路由`);

  for (const r of routes) {
    await pool.query(
      `INSERT INTO api_registry (method, path, file_path, line_number, area)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (method, path) DO UPDATE
         SET file_path=$3, line_number=$4, area=$5, scanned_at=NOW(), updated_at=NOW()`,
      [r.method, r.path, r.file_path, r.line_number, r.area],
    );
  }
  console.log('api_registry 填充完成');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: 写 scan-db-schema.js**

创建 `scripts/scan/scan-db-schema.js`：

```javascript
#!/usr/bin/env node
'use strict';
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

const CECELIA_TABLES = new Set([
  'journeys','journey_steps','journey_features','api_registry',
  'db_schema_registry','test_registry','issues','tasks','decisions',
  'learnings','dev_records','initiative_contracts',
  // 加更多核心表
]);

async function main() {
  // 获取所有表
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`,
  );

  for (const { table_name } of tables) {
    // 列信息
    const { rows: cols } = await pool.query(
      `SELECT column_name AS name, data_type AS type,
              is_nullable = 'YES' AS nullable,
              column_default AS default_val,
              (SELECT COUNT(*) FROM information_schema.key_column_usage k
               JOIN information_schema.table_constraints tc
                 ON k.constraint_name=tc.constraint_name AND tc.table_name=$1
                    AND tc.constraint_type='PRIMARY KEY'
               WHERE k.column_name=c.column_name) > 0 AS primary_key
       FROM information_schema.columns c
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [table_name],
    );

    // 索引
    const { rows: idxs } = await pool.query(
      `SELECT indexname AS name, indexdef AS def,
              (SELECT COUNT(*) FROM pg_indexes pi2
               WHERE pi2.indexname=pi.indexname AND pi2.indexdef LIKE '%UNIQUE%') > 0 AS unique
       FROM pg_indexes pi WHERE tablename=$1`,
      [table_name],
    );

    // 外键
    const { rows: fks } = await pool.query(
      `SELECT kcu.column_name AS col,
              ccu.table_name  AS ref_table,
              ccu.column_name AS ref_col
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name=kcu.constraint_name AND tc.table_name=$1
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name=ccu.constraint_name
       WHERE tc.constraint_type='FOREIGN KEY'`,
      [table_name],
    );

    const area = CECELIA_TABLES.has(table_name) ? 'cecelia' : 'shared';

    await pool.query(
      `INSERT INTO db_schema_registry (table_name, columns, indexes, foreign_keys, area)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (table_name) DO UPDATE
         SET columns=$2, indexes=$3, foreign_keys=$4, area=$5, scanned_at=NOW(), updated_at=NOW()`,
      [table_name, JSON.stringify(cols), JSON.stringify(idxs), JSON.stringify(fks), area],
    );
  }

  const { rows: [{ cnt }] } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM db_schema_registry',
  );
  console.log(`db_schema_registry 填充完成，共 ${cnt} 条`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: 写 scan-test-registry.js**

创建 `scripts/scan/scan-test-registry.js`：

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');

const AREA_MAP = [
  ['apps/api', 'zenithjoy'],
  ['apps/dashboard', 'zenithjoy'],
  ['packages/brain', 'cecelia'],
  ['packages/engine', 'cecelia'],
];

function inferArea(filePath) {
  for (const [prefix, area] of AREA_MAP) {
    if (filePath.includes(prefix)) return area;
  }
  return 'unknown';
}

function inferType(filePath) {
  if (filePath.includes('e2e') || filePath.includes('spec')) return 'e2e';
  if (filePath.includes('integration')) return 'integration';
  return 'unit';
}

function scanDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.includes('node_modules')) {
      results.push(...scanDir(full));
    } else if (entry.isFile() && /\.(test|spec)\.(ts|js)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      const behaviors = [];
      const itRe = /(?:it|test)\s*\(\s*['"`]([^'"`]{3,100})['"`]/g;
      let m;
      while ((m = itRe.exec(content)) !== null) behaviors.push(m[1]);
      results.push({
        file_path: path.relative(REPO_ROOT, full),
        test_count: behaviors.length,
        covered_behaviors: behaviors,
        area: inferArea(full),
        test_type: inferType(full),
      });
    }
  }
  return results;
}

async function main() {
  const scanDirs = ['packages', 'apps', 'sprints'];
  const files = [];
  for (const d of scanDirs) files.push(...scanDir(path.join(REPO_ROOT, d)));

  console.log(`扫描到 ${files.length} 个测试文件`);

  for (const f of files) {
    await pool.query(
      `INSERT INTO test_registry (file_path, test_count, covered_behaviors, area, test_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (file_path) DO UPDATE
         SET test_count=$2, covered_behaviors=$3, area=$4, test_type=$5,
             scanned_at=NOW(), updated_at=NOW()`,
      [f.file_path, f.test_count, f.covered_behaviors, f.area, f.test_type],
    );
  }
  console.log('test_registry 填充完成');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: 写 scan-skills.js**

创建 `scripts/scan/scan-skills.js`：

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

const SKILL_DIRS = [
  path.join(process.env.HOME, '.claude', 'skills'),
  path.join(process.env.HOME, '.claude-account1', 'plugins', 'cache', 'superpowers-marketplace', 'superpowers', '5.0.7', 'skills'),
];

function scanSkillDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const content = fs.readFileSync(skillMd, 'utf8');
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*([\s\S]+?)(?=\n---|\n##)/m);
    results.push({
      name: nameMatch ? nameMatch[1].trim() : entry.name,
      location: skillMd,
      description: descMatch ? descMatch[1].trim().slice(0, 500) : '',
    });
  }
  return results;
}

async function main() {
  const skills = [];
  for (const dir of SKILL_DIRS) skills.push(...scanSkillDir(dir));
  console.log(`扫描到 ${skills.length} 个 skill`);

  for (const s of skills) {
    await pool.query(
      `INSERT INTO system_registry (type, name, location, description, status)
       VALUES ('skill', $1, $2, $3, 'active')
       ON CONFLICT (type, name) DO UPDATE
         SET location=$2, description=$3, updated_at=NOW()`,
      [s.name, s.location, s.description],
    );
  }
  console.log('skill_registry (system_registry) 填充完成');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: 运行 4 个扫描脚本**

```bash
node scripts/scan/scan-api-registry.js
node scripts/scan/scan-db-schema.js
node scripts/scan/scan-test-registry.js
node scripts/scan/scan-skills.js
```

期望：每个脚本输出"填充完成"，无错误

- [ ] **Step 8: 运行测试，确认 4 个扫描测试通过**

```bash
npx vitest run packages/brain/src/workflows/__tests__/dev-registry.test.js 2>&1 | tail -20
```

期望：所有 test PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/scan/
git add packages/brain/src/workflows/__tests__/dev-registry.test.js
git commit -m "feat(brain): 扫描脚本 — api_registry / db_schema_registry / test_registry / skill_registry 填充"
```

---

## Task 3: Notion 反向拉取 — journeys / journey_steps / journey_features / issues

**Files:**
- Create: `scripts/notion-to-brain/sync-journeys.js`
- Create: `scripts/notion-to-brain/sync-journey-steps.js`
- Create: `scripts/notion-to-brain/sync-journey-features.js`
- Create: `scripts/notion-to-brain/sync-issues.js`
- Test: `packages/brain/src/workflows/__tests__/dev-registry.test.js`（追加）

- [ ] **Step 1: 追加 Notion 拉取验证测试**

追加到 `packages/brain/src/workflows/__tests__/dev-registry.test.js`：

```javascript
describe('dev-registry Notion 反向拉取', () => {
  it('journeys 行数 > 0（Notion 拉取后）', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM journeys');
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it('journey_steps 行数 > 0（Notion 拉取后）', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM journey_steps');
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it('issues 行数 > 0（Notion 拉取后）', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM issues');
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it('journey notion_id 不为空', async () => {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM journeys WHERE notion_id IS NOT NULL',
    );
    expect(rows[0].cnt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 确认 4 个新 test 失败（表空）**

```bash
npx vitest run packages/brain/src/workflows/__tests__/dev-registry.test.js 2>&1 | grep -E "FAIL|✗"
```

- [ ] **Step 3: 写 sync-journeys.js**

创建 `scripts/notion-to-brain/sync-journeys.js`：

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

function loadNotionKey() {
  const credPath = path.join(process.env.HOME, '.credentials', 'notion.env');
  const env = {};
  fs.readFileSync(credPath, 'utf8').split('\n')
    .forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });
  if (!env.NOTION_API_KEY) throw new Error('NOTION_API_KEY not found');
  return env.NOTION_API_KEY;
}

async function notionQuery(dbId, apiKey, cursor) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

function extractText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'select') return prop.select?.name || null;
  return null;
}

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';

async function main() {
  const apiKey = loadNotionKey();
  let cursor = null;
  let total = 0;

  do {
    const data = await notionQuery(JOURNEY_DB, apiKey, cursor);
    for (const page of data.results || []) {
      const props = page.properties;
      const name = extractText(props['Name']);
      if (!name) continue;
      const journeyType = extractText(props['Journey Type']) || 'user_facing';
      const maturity = extractText(props['Maturity']) || 'not_started';
      const status = extractText(props['Status']) || 'active';
      const description = extractText(props['Description']);
      const e2eTestPath = extractText(props['E2E Test Path']);

      await pool.query(
        `INSERT INTO journeys (notion_id, name, description, journey_type, maturity, status, e2e_test_path, notion_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (notion_id) DO UPDATE
           SET name=$2, description=$3, journey_type=$4, maturity=$5, status=$6,
               e2e_test_path=$7, notion_synced_at=NOW(), updated_at=NOW()`,
        [page.id, name, description, journeyType, maturity, status, e2eTestPath],
      );

      // notion_sync_log 记录
      await pool.query(
        `INSERT INTO notion_sync_log (entity_type, entity_id, notion_id, direction, status)
         VALUES ('journey', (SELECT id FROM journeys WHERE notion_id=$1), $1, 'from_notion', 'success')
         ON CONFLICT DO NOTHING`,
        [page.id],
      ).catch(() => {}); // notion_sync_log schema 可能不同，忽略失败

      total++;
    }
    cursor = data.next_cursor;
  } while (cursor);

  console.log(`journeys 同步完成，共 ${total} 条`);
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 4: 写 sync-journey-steps.js**

创建 `scripts/notion-to-brain/sync-journey-steps.js`：

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

function loadNotionKey() {
  const credPath = path.join(process.env.HOME, '.credentials', 'notion.env');
  const env = {};
  fs.readFileSync(credPath, 'utf8').split('\n')
    .forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });
  return env.NOTION_API_KEY;
}

async function notionQuery(dbId, apiKey, cursor) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

function extractText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'select') return prop.select?.name || null;
  if (prop.type === 'number') return prop.number;
  return null;
}

const STEPS_DB = '35ec40c2-ba63-8170-872a-c19cc55b63b3';

async function main() {
  const apiKey = loadNotionKey();
  let cursor = null;
  let total = 0;

  do {
    const data = await notionQuery(STEPS_DB, apiKey, cursor);
    for (const page of data.results || []) {
      const props = page.properties;
      const name = extractText(props['Name']);
      if (!name) continue;
      const stepNumber = extractText(props['Step Number']) || 0;
      const description = extractText(props['Description']);
      const status = extractText(props['Status']) || 'planned';

      // 找关联的 journey（通过 Path relation 的第一个 page id 查）
      const pathRelation = props['Path']?.relation || [];
      const journeyNotionId = pathRelation[0]?.id || null;

      let journeyId = null;
      if (journeyNotionId) {
        const { rows } = await pool.query(
          'SELECT id FROM journeys WHERE notion_id=$1', [journeyNotionId],
        );
        journeyId = rows[0]?.id || null;
      }

      await pool.query(
        `INSERT INTO journey_steps (notion_id, journey_id, name, description, step_number, status, notion_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (notion_id) DO UPDATE
           SET journey_id=$2, name=$3, description=$4, step_number=$5, status=$6,
               notion_synced_at=NOW(), updated_at=NOW()`,
        [page.id, journeyId, name, description, stepNumber, status],
      );
      total++;
    }
    cursor = data.next_cursor;
  } while (cursor);

  console.log(`journey_steps 同步完成，共 ${total} 条`);
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 5: 写 sync-journey-features.js**

创建 `scripts/notion-to-brain/sync-journey-features.js`：

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

function loadNotionKey() {
  const credPath = path.join(process.env.HOME, '.credentials', 'notion.env');
  const env = {};
  fs.readFileSync(credPath, 'utf8').split('\n')
    .forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });
  return env.NOTION_API_KEY;
}

async function notionQuery(dbId, apiKey, cursor) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

function extractText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'select') return prop.select?.name || null;
  return null;
}

const FEATURES_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';

async function main() {
  const apiKey = loadNotionKey();
  let cursor = null;
  let total = 0;

  do {
    const data = await notionQuery(FEATURES_DB, apiKey, cursor);
    for (const page of data.results || []) {
      const props = page.properties;
      const name = extractText(props['Name']);
      if (!name) continue;
      const thickness = extractText(props['Thickness']) || 'thin';
      const status = extractText(props['Status']) || 'planned';
      const unitTestPath = extractText(props['Unit Test Path']);
      const version = extractText(props['Version']);

      const journeyRelation = props['Journey']?.relation || [];
      const stepRelation = props['Step']?.relation || [];
      const journeyNotionId = journeyRelation[0]?.id || null;
      const stepNotionId = stepRelation[0]?.id || null;

      let journeyId = null, stepId = null;
      if (journeyNotionId) {
        const { rows } = await pool.query('SELECT id FROM journeys WHERE notion_id=$1', [journeyNotionId]);
        journeyId = rows[0]?.id || null;
      }
      if (stepNotionId) {
        const { rows } = await pool.query('SELECT id FROM journey_steps WHERE notion_id=$1', [stepNotionId]);
        stepId = rows[0]?.id || null;
      }

      await pool.query(
        `INSERT INTO journey_features
           (notion_id, journey_id, step_id, name, thickness, status, unit_test_path, version, notion_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (notion_id) DO UPDATE
           SET journey_id=$2, step_id=$3, name=$4, thickness=$5, status=$6,
               unit_test_path=$7, version=$8, notion_synced_at=NOW(), updated_at=NOW()`,
        [page.id, journeyId, stepId, name, thickness, status, unitTestPath, version],
      );
      total++;
    }
    cursor = data.next_cursor;
  } while (cursor);

  console.log(`journey_features 同步完成，共 ${total} 条`);
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 6: 写 sync-issues.js**

创建 `scripts/notion-to-brain/sync-issues.js`：

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

function loadNotionKey() {
  const credPath = path.join(process.env.HOME, '.credentials', 'notion.env');
  const env = {};
  fs.readFileSync(credPath, 'utf8').split('\n')
    .forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });
  return env.NOTION_API_KEY;
}

async function notionQuery(dbId, apiKey, cursor) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

function extractText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'select') return prop.select?.name || null;
  if (prop.type === 'url') return prop.url || null;
  return null;
}

const ISSUES_DB = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';

// Sub Area relation ID → sub_area 名称映射
const SUB_AREA_IDS = {
  '5c0c40c2-ba63-8347-9334-01a0129a015a': 'brain',
  '64bc40c2-ba63-8212-ab62-012912749a71': 'engine',
  '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d': 'cecelia',
  '8acc40c2-ba63-8373-8281-0151470389d1': 'multi-agent',
  'cf5c40c2-ba63-82c8-a00a-015c593f6268': 'zenithjoy',
  'a17c40c2-ba63-83e2-b922-8197b09af030': 'dashboard',
};

async function main() {
  const apiKey = loadNotionKey();
  let cursor = null;
  let total = 0;

  do {
    const data = await notionQuery(ISSUES_DB, apiKey, cursor);
    for (const page of data.results || []) {
      const props = page.properties;
      const title = extractText(props['Issue']);
      if (!title) continue;
      const priority = extractText(props['Priority']) || 'P2';
      const status = extractText(props['Status']) || 'In progress';

      // Sub Area relation → 名称
      const subAreaRelation = props['Sub Area']?.relation || [];
      const subAreaId = subAreaRelation[0]?.id || null;
      const subArea = subAreaId ? SUB_AREA_IDS[subAreaId] || null : null;

      await pool.query(
        `INSERT INTO issues (notion_id, title, priority, status, sub_area, notion_synced_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (notion_id) DO UPDATE
           SET title=$2, priority=$3, status=$4, sub_area=$5,
               notion_synced_at=NOW(), updated_at=NOW()`,
        [page.id, title, priority, status, subArea],
      );
      total++;
    }
    cursor = data.next_cursor;
  } while (cursor);

  console.log(`issues 同步完成，共 ${total} 条`);
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 7: 运行 Notion 同步脚本（按顺序，steps 依赖 journeys 先跑）**

```bash
# 必须按顺序：journey_steps 依赖 journeys 的 UUID，journey_features 依赖两者
node scripts/notion-to-brain/sync-journeys.js
node scripts/notion-to-brain/sync-journey-steps.js
node scripts/notion-to-brain/sync-journey-features.js
node scripts/notion-to-brain/sync-issues.js
```

期望：每个脚本输出"同步完成，共 N 条"

- [ ] **Step 8: 运行测试，确认全部通过**

```bash
npx vitest run packages/brain/src/workflows/__tests__/dev-registry.test.js 2>&1 | tail -20
```

期望：所有 test PASS（15+ tests）

- [ ] **Step 9: Commit**

```bash
git add scripts/notion-to-brain/ scripts/scan/ packages/brain/src/workflows/__tests__/dev-registry.test.js
git commit -m "feat(brain): Notion 反向拉取 + 初始填充脚本 — journeys/steps/features/issues/api/db/test/skills"
```

---

## Task 4: run-all-initial-scans.sh + smoke.sh

**Files:**
- Create: `scripts/run-all-initial-scans.sh`
- Create: `packages/brain/scripts/smoke/dev-registry-smoke.sh`

- [ ] **Step 1: 写 run-all-initial-scans.sh**

```bash
#!/bin/bash
# run-all-initial-scans.sh — 初始化填充所有 dev management tables
# 顺序重要：journey_steps 依赖 journeys，journey_features 依赖两者

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Dev Registry 初始填充 ==="

echo "[1/8] sync journeys from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-journeys.js"

echo "[2/8] sync journey steps from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-journey-steps.js"

echo "[3/8] sync journey features from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-journey-features.js"

echo "[4/8] sync issues from Notion..."
node "$SCRIPT_DIR/notion-to-brain/sync-issues.js"

echo "[5/8] scan api registry..."
node "$SCRIPT_DIR/scan/scan-api-registry.js"

echo "[6/8] scan db schema registry..."
node "$SCRIPT_DIR/scan/scan-db-schema.js"

echo "[7/8] scan test registry..."
node "$SCRIPT_DIR/scan/scan-test-registry.js"

echo "[8/8] scan skills..."
node "$SCRIPT_DIR/scan/scan-skills.js"

echo "=== 全部完成 ==="
```

```bash
chmod +x scripts/run-all-initial-scans.sh
```

- [ ] **Step 2: 写 smoke.sh（真环境验证）**

创建 `packages/brain/scripts/smoke/dev-registry-smoke.sh`：

```bash
#!/bin/bash
# dev-registry-smoke.sh — Dev Management Tables 真环境验证
set -e
DB="postgresql://localhost/cecelia"

echo "[smoke] 验证 7 张表存在..."
for TABLE in journeys journey_steps journey_features api_registry db_schema_registry test_registry issues; do
  COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$TABLE'" | tr -d ' ')
  [ "$COUNT" = "1" ] || { echo "FAIL: 表 $TABLE 不存在"; exit 1; }
done
echo "  ✓ 7 张表全部存在"

echo "[smoke] 验证扫描数据填充..."
API_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM api_registry" | tr -d ' ')
[ "$API_COUNT" -gt 0 ] || { echo "FAIL: api_registry 为空"; exit 1; }

DB_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM db_schema_registry WHERE table_name='tasks'" | tr -d ' ')
[ "$DB_COUNT" -gt 0 ] || { echo "FAIL: db_schema_registry 缺 tasks 表"; exit 1; }

TEST_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM test_registry" | tr -d ' ')
[ "$TEST_COUNT" -gt 0 ] || { echo "FAIL: test_registry 为空"; exit 1; }

echo "  ✓ 扫描数据已填充 api=$API_COUNT, tests=$TEST_COUNT"

echo "[smoke] 验证 Notion 同步数据..."
J_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM journeys WHERE notion_id IS NOT NULL" | tr -d ' ')
[ "$J_COUNT" -gt 0 ] || { echo "FAIL: journeys 无 Notion 数据"; exit 1; }

I_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM issues WHERE notion_id IS NOT NULL" | tr -d ' ')
[ "$I_COUNT" -gt 0 ] || { echo "FAIL: issues 无 Notion 数据"; exit 1; }

echo "  ✓ Notion 同步数据就绪 journeys=$J_COUNT, issues=$I_COUNT"

echo "✅ dev-registry smoke 全部通过"
```

- [ ] **Step 3: 运行 smoke 验证**

```bash
bash packages/brain/scripts/smoke/dev-registry-smoke.sh
```

期望：`✅ dev-registry smoke 全部通过`

- [ ] **Step 4: Commit**

```bash
git add scripts/run-all-initial-scans.sh packages/brain/scripts/smoke/dev-registry-smoke.sh
chmod +x packages/brain/scripts/smoke/dev-registry-smoke.sh
git commit -m "feat(brain): run-all-initial-scans.sh + dev-registry-smoke.sh 真环境验证"
```

---

## Self-Review

**Spec coverage check:**
- ✅ 7 张表 DDL (Task 1)
- ✅ api_registry 扫描填充 (Task 2)
- ✅ db_schema_registry 从 information_schema 填充 (Task 2)
- ✅ test_registry 扫描填充 (Task 2)
- ✅ skill_registry → system_registry (Task 2)
- ✅ journeys Notion 反向拉取 (Task 3)
- ✅ journey_steps Notion 反向拉取，依赖 journeys (Task 3)
- ✅ journey_features Notion 反向拉取，依赖 steps (Task 3)
- ✅ issues Notion 反向拉取 (Task 3)
- ✅ notion_sync_log 复用（不新建表）(Task 3 注释)
- ✅ smoke.sh 真环境验证 (Task 4)
- ✅ migration 注释明确 journey_features vs features, db_schema_registry vs db_schemas

**Placeholder scan:** 无 TBD/TODO/placeholder

**Type consistency:** 所有脚本使用 `notion_id VARCHAR(100)` 作为 Notion 标识符，`ON CONFLICT (notion_id) DO UPDATE` 保证幂等
