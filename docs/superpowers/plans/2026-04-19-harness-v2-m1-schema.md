# Harness v2 M1 Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Harness v2 架构添加数据模型基础 —— 3 张新表 + 扩展 tasks.task_type + 同步代码常量

**Architecture:** 4 个顺序 SQL migration（236-239）+ 2 个常量文件改动 + 1 个 vitest integration test。Migration runner 按文件名数字顺序应用，因此 238 中的 `REFERENCES initiative_contracts(id)` 对 236 的依赖安全。代码常量和 schema 保持同步，否则 pre-flight-check 会拒绝新任务。

**Tech Stack:** PostgreSQL / Node.js (ESM) / vitest / pg

Base spec: `docs/superpowers/specs/2026-04-19-harness-v2-m1-schema-design.md`
Base PRD: `docs/design/harness-v2-prd.md` §4

---

## File Structure

**Create:**
- `packages/brain/migrations/236_harness_v2_initiative_contracts.sql`
- `packages/brain/migrations/237_harness_v2_task_dependencies.sql`
- `packages/brain/migrations/238_harness_v2_initiative_runs.sql`
- `packages/brain/migrations/239_harness_v2_task_types.sql`
- `packages/brain/src/__tests__/harness-v2-schema.integration.test.js`

**Modify:**
- `packages/brain/src/task-router.js`（VALID_TASK_TYPES / SKILL_WHITELIST / LOCATION_MAP / TASK_REQUIREMENTS）
- `packages/brain/src/pre-flight-check.js`（SYSTEM_TASK_TYPES 数组）

---

### Task 1: Migration 236 — initiative_contracts 表

**Files:**
- Create: `packages/brain/migrations/236_harness_v2_initiative_contracts.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- Migration 236: Harness v2 新表 initiative_contracts
-- Alex 指示：不加 FK 到 projects（projects 不保证每个 initiative_id 都有行）

CREATE TABLE IF NOT EXISTS initiative_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','superseded')),
  prd_content TEXT,
  contract_content TEXT,
  e2e_acceptance JSONB,
  budget_cap_usd NUMERIC(8,2) DEFAULT 10,
  timeout_sec INT DEFAULT 21600,
  review_rounds INT DEFAULT 0,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (initiative_id, version)
);

CREATE INDEX IF NOT EXISTS idx_initiative_contracts_initiative
  ON initiative_contracts(initiative_id, status);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('236', 'Harness v2: initiative_contracts 表（PRD/合同 SSOT + E2E 验收）', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 本地运行 migration 验证**

Run: `cd /Users/administrator/worktrees/cecelia/harness-v2-m1-schema && node packages/brain/src/migrate.js`
Expected: 输出 `[APPLY] 236_harness_v2_initiative_contracts.sql` → `[DONE]`

- [ ] **Step 3: psql 验证表存在**

Run: `PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "\d initiative_contracts"`
Expected: 表结构输出 14 列，含 UNIQUE + INDEX

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/236_harness_v2_initiative_contracts.sql
git commit -m "feat(brain): add initiative_contracts table (Harness v2 M1)"
```

---

### Task 2: Migration 237 — task_dependencies 表

**Files:**
- Create: `packages/brain/migrations/237_harness_v2_task_dependencies.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- Migration 237: Harness v2 新表 task_dependencies
-- 存 Task DAG 的边，runtime 拓扑排序用

CREATE TABLE IF NOT EXISTS task_dependencies (
  from_task_id UUID NOT NULL,
  to_task_id UUID NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'hard'
    CHECK (edge_type IN ('hard','soft')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_task_id, to_task_id),
  CHECK (from_task_id != to_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_from ON task_dependencies(from_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_to   ON task_dependencies(to_task_id);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('237', 'Harness v2: task_dependencies 表（DAG 边表，防自环）', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 运行 migration**

Run: `node packages/brain/src/migrate.js`
Expected: `[APPLY] 237_... [DONE]`

- [ ] **Step 3: 验证自环 CHECK 生效**

Run: `PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "INSERT INTO task_dependencies(from_task_id,to_task_id) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');"`
Expected: ERROR `violates check constraint`

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/237_harness_v2_task_dependencies.sql
git commit -m "feat(brain): add task_dependencies table with self-loop guard (Harness v2 M1)"
```

---

### Task 3: Migration 238 — initiative_runs 表

**Files:**
- Create: `packages/brain/migrations/238_harness_v2_initiative_runs.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- Migration 238: Harness v2 新表 initiative_runs
-- 阶段 A/B/C 共享的 Initiative 运行态（预算/超时/阶段指针）

CREATE TABLE IF NOT EXISTS initiative_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL,
  contract_id UUID REFERENCES initiative_contracts(id),
  phase TEXT NOT NULL DEFAULT 'A_contract'
    CHECK (phase IN ('A_contract','B_task_loop','C_final_e2e','done','failed')),
  current_task_id UUID,
  merged_task_ids UUID[] DEFAULT ARRAY[]::UUID[],
  cost_usd NUMERIC(8,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  deadline_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_initiative_runs_initiative ON initiative_runs(initiative_id);
CREATE INDEX IF NOT EXISTS idx_initiative_runs_phase      ON initiative_runs(phase);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('238', 'Harness v2: initiative_runs 表（阶段 A/B/C 运行态）', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 运行 migration**

Run: `node packages/brain/src/migrate.js`
Expected: `[APPLY] 238_... [DONE]`

- [ ] **Step 3: psql 验证 FK 到 initiative_contracts**

Run: `PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "\d initiative_runs"`
Expected: 看到 `contract_id` 列带 `REFERENCES initiative_contracts(id)` 外键

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/238_harness_v2_initiative_runs.sql
git commit -m "feat(brain): add initiative_runs table for phase A/B/C runtime state (Harness v2 M1)"
```

---

### Task 4: Migration 239 — 扩展 tasks.task_type CHECK

**Files:**
- Create: `packages/brain/migrations/239_harness_v2_task_types.sql`

- [ ] **Step 1: 读 232 拿到现有约束内容**

Run: `cat packages/brain/migrations/232_add_harness_generator_task_type.sql`
目的：确保新约束严格是"232 类型清单 + 三个新类型"，不丢老类型。

- [ ] **Step 2: 写 migration SQL**

```sql
-- Migration 239: Harness v2 新 task_type
-- 在 232 既有清单基础上追加 harness_initiative / harness_task / harness_final_e2e
-- 保留所有 v1 老类型（向后兼容）

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type = ANY (ARRAY[
    -- 基础类型
    'dev', 'review', 'talk', 'data', 'research',
    'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review',
    -- Codex 类型
    'codex_qa', 'codex_dev', 'codex_test_gen', 'pr_review',
    -- 系统类型
    'code_review', 'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session', 'intent_expand', 'cto_review',
    -- Pipeline v2 Gate 类型
    'spec_review', 'code_review_gate', 'prd_review', 'initiative_review',
    -- Scope 层飞轮
    'scope_plan', 'project_plan',
    -- OKR 新表飞轮
    'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan',
    -- 内容工厂 Pipeline
    'content-pipeline', 'content-research', 'content-generate',
    'content-review', 'content-export', 'content_publish',
    'content-copywriting', 'content-copy-review', 'content-image-review',
    -- 救援类型
    'pipeline_rescue',
    -- crystallize 能力蒸馏流水线
    'crystallize', 'crystallize_scope', 'crystallize_forge',
    'crystallize_verify', 'crystallize_register',
    -- Harness v3.x 旧类型（向后兼容，历史数据保留）
    'sprint_planner',
    'sprint_contract_propose',
    'sprint_contract_review',
    'sprint_generate',
    'sprint_evaluate',
    'sprint_fix',
    'sprint_report',
    'cecelia_event',
    -- Harness v4.0 类型
    'harness_planner',
    'harness_contract_propose',
    'harness_contract_review',
    'harness_generate',
    'harness_generator',
    'harness_ci_watch',
    'harness_evaluate',
    'harness_fix',
    'harness_deploy_watch',
    'harness_report',
    -- 平台采集
    'platform_scraper',
    -- Harness v2 新类型（本 migration）
    'harness_initiative',   -- 阶段 A 入口
    'harness_task',          -- 阶段 B 单 Task
    'harness_final_e2e'      -- 阶段 C 最终 E2E
  ])
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('239', 'Harness v2: 新 task_type（harness_initiative/harness_task/harness_final_e2e）', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 3: 运行 migration**

Run: `node packages/brain/src/migrate.js`
Expected: `[APPLY] 239_... [DONE]`

- [ ] **Step 4: 验证新旧 task_type 都接受**

Run:
```bash
PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "BEGIN; INSERT INTO tasks(id,title,task_type,status,priority) VALUES (gen_random_uuid(),'test','harness_initiative','queued','P2'); ROLLBACK;"
PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "BEGIN; INSERT INTO tasks(id,title,task_type,status,priority) VALUES (gen_random_uuid(),'test','harness_planner','queued','P2'); ROLLBACK;"
```
Expected: 两条都 `INSERT 0 1` + `ROLLBACK`

- [ ] **Step 5: Commit**

```bash
git add packages/brain/migrations/239_harness_v2_task_types.sql
git commit -m "feat(brain): add harness_initiative/harness_task/harness_final_e2e task types (Harness v2 M1)"
```

---

### Task 5: task-router.js 加三个新 task_type

**Files:**
- Modify: `packages/brain/src/task-router.js`

- [ ] **Step 1: 在 VALID_TASK_TYPES 最后加新类型（在 `'platform_scraper',` 行之后添加）**

找到现有的 `'platform_scraper',` 行（L49），在其后加：
```javascript
  // Harness v2 新类型（M1）
  'harness_initiative',    // 阶段 A 入口（一个 Initiative 一条）
  'harness_task',          // 阶段 B 单 Task（内部状态机）
  'harness_final_e2e',     // 阶段 C 最终 E2E 验收
```

- [ ] **Step 2: 在 SKILL_WHITELIST 末尾（`'platform_scraper': '/media-scraping',` 之后，`}` 之前）加映射**

```javascript
  // Harness v2 新类型（M1 复用现有 skill，M2/M5 会重写）
  'harness_initiative': '/harness-planner',   // 阶段 A — M1 复用 planner skill
  'harness_task': '/_internal',               // 阶段 B — Brain tick 内部状态机，不派 agent
  'harness_final_e2e': '/harness-evaluator',  // 阶段 C — M1 复用 evaluator skill
```

- [ ] **Step 3: 在 LOCATION_MAP 末尾（`'platform_scraper': 'us',` 之后）加**

```javascript
  // Harness v2 → US 本机
  'harness_initiative': 'us',
  'harness_task': 'us',
  'harness_final_e2e': 'us',
```

- [ ] **Step 4: 在 TASK_REQUIREMENTS 末尾（最后一条 harness_* 之后）加**

```javascript
  // Harness v2 — 需要 git 访问（US M4）
  'harness_initiative':       ['has_git'],
  'harness_task':             ['has_git'],
  'harness_final_e2e':        ['has_git'],
```

- [ ] **Step 5: sanity check — node 直接 import 看是否包含**

Run:
```bash
node -e "
import('./packages/brain/src/task-router.js').then(m => {
  const ok = ['harness_initiative','harness_task','harness_final_e2e'].every(t => m.VALID_TASK_TYPES.includes(t) && m.SKILL_WHITELIST[t] && m.LOCATION_MAP[t] === 'us');
  if (!ok) { console.error('FAIL'); process.exit(1); }
  console.log('OK');
});
"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/task-router.js
git commit -m "feat(brain): route harness_initiative/harness_task/harness_final_e2e task types"
```

---

### Task 6: pre-flight-check.js 加 SYSTEM_TASK_TYPES

**Files:**
- Modify: `packages/brain/src/pre-flight-check.js:32-39`

- [ ] **Step 1: 在 SYSTEM_TASK_TYPES 数组的 `'harness_report']` 之前（即 `'harness_generate', 'harness_fix', 'harness_evaluate', 'harness_report'` 那行）追加新类型**

现有最后一行：
```javascript
    'harness_generate', 'harness_fix', 'harness_evaluate', 'harness_report'];
```

改为：
```javascript
    'harness_generate', 'harness_fix', 'harness_evaluate', 'harness_report',
    // Harness v2（M1）
    'harness_initiative', 'harness_task', 'harness_final_e2e'];
```

- [ ] **Step 2: sanity check**

Run:
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/pre-flight-check.js','utf8');
['harness_initiative','harness_task','harness_final_e2e'].forEach(t => {
  if (!c.includes(\"'\"+t+\"'\")) { console.error('missing',t); process.exit(1); }
});
console.log('OK');
"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/pre-flight-check.js
git commit -m "feat(brain): whitelist harness_initiative/harness_task/harness_final_e2e as system tasks"
```

---

### Task 7: Integration test

**Files:**
- Create: `packages/brain/src/__tests__/harness-v2-schema.integration.test.js`

- [ ] **Step 1: 写测试文件（完整内容）**

```javascript
/**
 * Harness v2 M1 Schema Integration Test
 *
 * 验证 migration 236-239 的效果：
 * 1. 三张新表存在 + 关键列类型正确
 * 2. 各 CHECK 约束生效（status / phase / edge_type / 自环）
 * 3. UNIQUE(initiative_id, version) 生效
 * 4. tasks.task_type 接受三个新类型 + 老类型仍然接受
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
});

describe('Harness v2 M1 schema: tables exist', () => {
  it('initiative_contracts table exists', async () => {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='initiative_contracts'`
    );
    expect(r.rows).toHaveLength(1);
  });

  it('task_dependencies table exists', async () => {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='task_dependencies'`
    );
    expect(r.rows).toHaveLength(1);
  });

  it('initiative_runs table exists', async () => {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='initiative_runs'`
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe('Harness v2 M1 schema: column types', () => {
  it('initiative_contracts.budget_cap_usd is numeric', async () => {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='initiative_contracts' AND column_name='budget_cap_usd'`
    );
    expect(r.rows[0].data_type).toBe('numeric');
  });

  it('initiative_contracts.e2e_acceptance is jsonb', async () => {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='initiative_contracts' AND column_name='e2e_acceptance'`
    );
    expect(r.rows[0].data_type).toBe('jsonb');
  });

  it('initiative_runs.merged_task_ids is uuid array', async () => {
    const r = await pool.query(
      `SELECT data_type, udt_name FROM information_schema.columns
       WHERE table_name='initiative_runs' AND column_name='merged_task_ids'`
    );
    expect(r.rows[0].data_type).toBe('ARRAY');
    expect(r.rows[0].udt_name).toBe('_uuid');
  });

  it('task_dependencies has edge_type with default hard', async () => {
    const r = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='task_dependencies' AND column_name='edge_type'`
    );
    expect(r.rows[0].column_default).toMatch(/'hard'/);
  });
});

describe('Harness v2 M1 schema: CHECK constraints', () => {
  it('initiative_contracts rejects invalid status', async () => {
    const initiativeId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO initiative_contracts(initiative_id, status) VALUES ($1, 'invalid')`,
        [initiativeId]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('initiative_contracts accepts draft/approved/superseded', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const status of ['draft', 'approved', 'superseded']) {
        const initId = randomUUID();
        await client.query(
          `INSERT INTO initiative_contracts(initiative_id, version, status) VALUES ($1, 1, $2)`,
          [initId, status]
        );
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('initiative_contracts UNIQUE(initiative_id, version) enforced', async () => {
    const client = await pool.connect();
    const initId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO initiative_contracts(initiative_id, version) VALUES ($1, 1)`,
        [initId]
      );
      await expect(
        client.query(
          `INSERT INTO initiative_contracts(initiative_id, version) VALUES ($1, 1)`,
          [initId]
        )
      ).rejects.toThrow(/duplicate|unique/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('initiative_runs rejects invalid phase', async () => {
    const initId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO initiative_runs(initiative_id, phase) VALUES ($1, 'invalid_phase')`,
        [initId]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('initiative_runs accepts all five phases', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const phase of ['A_contract', 'B_task_loop', 'C_final_e2e', 'done', 'failed']) {
        const initId = randomUUID();
        await client.query(
          `INSERT INTO initiative_runs(initiative_id, phase) VALUES ($1, $2)`,
          [initId, phase]
        );
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('task_dependencies rejects self-loop', async () => {
    const taskId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO task_dependencies(from_task_id, to_task_id) VALUES ($1, $1)`,
        [taskId]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('task_dependencies rejects invalid edge_type', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO task_dependencies(from_task_id, to_task_id, edge_type) VALUES ($1, $2, 'maybe')`,
        [a, b]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('task_dependencies accepts hard/soft', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const edge of ['hard', 'soft']) {
        await client.query(
          `INSERT INTO task_dependencies(from_task_id, to_task_id, edge_type) VALUES ($1, $2, $3)`,
          [randomUUID(), randomUUID(), edge]
        );
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('Harness v2 M1 schema: tasks.task_type extension', () => {
  const newTypes = ['harness_initiative', 'harness_task', 'harness_final_e2e'];

  for (const t of newTypes) {
    it(`tasks accepts new task_type: ${t}`, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'test-' || $1, $1, 'queued', 'P2')`,
          [t]
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  }

  it('tasks still accepts legacy harness_planner (backward compat)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'legacy', 'harness_planner', 'queued', 'P2')`
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('tasks still accepts legacy dev (backward compat)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'legacy-dev', 'dev', 'queued', 'P2')`
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('tasks rejects bogus task_type', async () => {
    await expect(
      pool.query(
        `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'bogus', 'this_does_not_exist', 'queued', 'P2')`
      )
    ).rejects.toThrow(/check constraint/i);
  });
});
```

- [ ] **Step 2: 运行测试，确认全部 PASS**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-m1-schema/packages/brain
npx vitest run src/__tests__/harness-v2-schema.integration.test.js 2>&1 | tail -30
```
Expected: `Tests  N passed` 且 `Test Files  1 passed`

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/harness-v2-schema.integration.test.js
git commit -m "test(brain): Harness v2 M1 schema integration tests (tables + constraints + task_type)"
```

---

### Task 8: Learning 文件 + DoD 勾选

**Files:**
- Create: `docs/learnings/cp-0419220818-harness-v2-m1-schema.md`
- Modify: `docs/superpowers/specs/2026-04-19-harness-v2-m1-schema-design.md`（DoD 勾选）

- [ ] **Step 1: 写 Learning 文件**

```markdown
# Harness v2 M1 数据模型迁移 — Learning

Branch: cp-0419220818-harness-v2-m1-schema
Task: Harness v2 M1 schema 迁移

## 做了什么
- 4 个 migration (236-239) 建表 + 扩展 task_type CHECK
- task-router.js / pre-flight-check.js 常量同步
- 9 组 integration test 覆盖 schema 生效

### 根本原因
Harness v1 在一个 task 里内联 Workstream 循环，违反 "1 Task = 1 PR"。v2 把 Initiative 级拆分上浮到 Planner 层，需要新数据表承载：合同 SSOT（initiative_contracts）+ DAG 边表（task_dependencies）+ 阶段运行态（initiative_runs）。M1 只先铺数据层，业务逻辑在 M2-M5。

### 下次预防
- [ ] Migration 顺序：FK 引用的目标表必须在更早编号的 migration 里创建（migrate.js 按文件名排序应用）
- [ ] task_type CHECK 约束扩展必须严格复制上一版清单再 append，忘带老类型会让历史数据 INSERT 失败
- [ ] Integration test 所有 INSERT 都包 BEGIN/ROLLBACK，避免污染共享 DB
- [ ] 新 task_type 三处必须同步：migration CHECK + task-router 四处常量 + pre-flight-check SYSTEM_TASK_TYPES，漏一处都会在 dispatch 时拒绝或路由失败
```

- [ ] **Step 2: 勾选 DoD 条目**

把 design spec `docs/superpowers/specs/2026-04-19-harness-v2-m1-schema-design.md` 第 8 节（## 8. DoD）里 5 个 `- [ARTIFACT]` / `- [BEHAVIOR]` 前的框改成 `- [x] [ARTIFACT]` / `- [x] [BEHAVIOR]`（全部验证通过后）。

- [ ] **Step 3: Commit learning**

```bash
git add docs/learnings/cp-0419220818-harness-v2-m1-schema.md docs/superpowers/specs/2026-04-19-harness-v2-m1-schema-design.md
git commit -m "docs: Harness v2 M1 learning + DoD verified"
```

---

## Self-Review Notes

- Spec coverage: 4 migrations + 2 constant files + 1 test + learning = 全部覆盖
- No placeholders: 每步给了完整 SQL / JS / 命令 / 预期输出
- Type consistency: task_type 三个新值在 migration/router/preflight 三处字符串完全一致
- Each task independently committable（便于 bisect 回溯）

## 非 Subagent 的部分（Ship 阶段由主会话处理）

所有 8 个 task 跑完后：
- 主会话负责 `git push -u origin cp-0419220818-harness-v2-m1-schema`
- `gh pr create` 用 title `feat(brain): Harness v2 M1 — initiative_contracts + task_dependencies + initiative_runs schema`
- 等 CI + auto-merge 由 Stop Hook 接管
- 通过 `engine-ship` 写入 Brain fire-learnings-event
