# MJ5 刀1 账本落库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 承诺地图 schema 落库（4 表加列 + 格子化）+ blast-radius API + 智能客服/首次成功两域打样数据，全部为 migration 自动副作用。

**Architecture:** 一条 GP=一条 journeys 行（home/domain/trigger/endpoint）；步骤承诺在 journey_steps.promise；格子=journey_step_links 扩展行（cell_kind/cell_key/cell_status/feature_id）；底座引用格是 blast-radius 的数据源。两个 partial unique 区分旧连接行与新格子行。

**Tech Stack:** PostgreSQL migration（packages/brain/migrations，migrate.js 按文件名序执行）、Express 路由（routes/journeys.js）、vitest（unit=mock pool / integration=真 pg，CI brain-integration job 空库全量跑 migrate）。

**上游文档：** spec `docs/superpowers/specs/2026-07-17-mj5-knife1-ledger-design.md`（数据 inventory SSOT）；PRD `docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md` §三。

**固定 UUID 表（seed 专用，全文一致使用）：**

| 实体 | UUID |
|---|---|
| journey GP-B 被动接待 | `ac2e35bc-849a-48cd-917f-79d15c5ac886` |
| journey GP-C 朋友圈发布 | `016459f9-98e0-40a2-a89e-92f8d34bb661` |
| journey GP-D 经营汇报 | `3ae2414e-3e92-4471-9908-892245b4e37a` |
| journey GP-E 朋友圈互动 | `b6a73832-b42b-4678-87ca-3ce00a6d70dd` |
| journey GP-F 社群运营 | `8fe9ed6b-999a-4041-8126-8567f68d3dea` |
| journey 绑定/安装（家②） | `6df5b884-2ae1-4801-95e8-bb7a11f308d2` |
| feature 绑定/安装（共享前置） | `24a98312-1941-4a0b-91c9-8bf79ef47311` |
| feature 消息/动态采集通道 | `6691d09a-3525-4610-87d2-2d8261d68111` |
| feature Agent 运行时底座 | `0d4922c9-0a5e-4aa6-93ff-6e1911342622` |
| feature 后台静默发送通道 | `2dde3bb5-2cb9-4c33-b592-224b1f4ffe41` |
| feature 接管开关 | `7f680eb3-0866-4429-a600-b396e980fc59` |
| feature 客户画像卡 | `d831dd0f-893c-49b6-8857-07756f5a7030` |
| feature CRM 表底座 | `0b70f2ff-1a16-4029-a71a-e6cb5a523ea2` |
| feature 记忆库租户隔离 | `39130340-16f0-47f1-9779-fc0b57218dd0` |
| 存量 journey 客户私域 AI 接管 | `bfeed805-deed-46c3-8624-87f0028101d4` |
| 存量 journey 客户首次成功路径 | `6e63f204-e9fd-4a3b-b338-6b3616bfcc61` |

**本地集成测试跑法（每个 integration task 通用）：**

> ⚠️ **死规矩：必须用 `DB_NAME=cecelia_scratch`，严禁 `DATABASE_URL`。** db-config.js 不解析 DATABASE_URL，漏设 DB_NAME 会静默回落到本机 `cecelia` 库＝**生产库**（07-17 实弹事故：审查代理照旧 runbook 跑 migrate 把 347 打进了生产，已补偿回滚）。任何 `node src/migrate.js` 前先确认命令行里有 `DB_NAME=cecelia_scratch`。

```bash
# 一次性建 scratch 库（已存在则先 dropdb cecelia_scratch）
createdb -U cecelia cecelia_scratch 2>/dev/null || true
cd packages/brain
DB_NAME=cecelia_scratch node src/migrate.js
DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/<file>
```

---

### Task 1: Migration 347（schema）+ 集成测试

**Files:**
- Create: `packages/brain/migrations/347_promise_map_schema.sql`
- Test: `packages/brain/src/__tests__/integration/migration-347.integration.test.js`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/integration/migration-347.integration.test.js
import { describe, it, expect, beforeAll } from 'vitest';
let pool;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

async function cols(table) {
  const { rows } = await pool.query(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name=$1`, [table]
  );
  return Object.fromEntries(rows.map(r => [r.column_name, r.is_nullable]));
}

describe('migration 347: promise map schema', () => {
  it('journeys 新列 home/domain/trigger/endpoint', async () => {
    const c = await cols('journeys');
    for (const k of ['home', 'domain', 'trigger', 'endpoint']) expect(c[k], k).toBeDefined();
  });

  it('journey_steps 新列 promise/backbone_version', async () => {
    const c = await cols('journey_steps');
    expect(c.promise).toBeDefined();
    expect(c.backbone_version).toBe('NO'); // NOT NULL DEFAULT 1
  });

  it('journey_features 新列 softness', async () => {
    const c = await cols('journey_features');
    expect(c.softness).toBe('NO');
  });

  it('journey_step_links 格子列全齐且 step_order 可空', async () => {
    const c = await cols('journey_step_links');
    for (const k of ['feature_id', 'cell_kind', 'cell_key', 'cell_status', 'assertion_ref', 'na_reason'])
      expect(c[k], k).toBeDefined();
    expect(c.step_order).toBe('YES');
  });

  it('旧 UNIQUE(journey_id,step_id) 已删，两个 partial unique + feature 索引已建', async () => {
    const { rows: cons } = await pool.query(`
      SELECT conname FROM pg_constraint WHERE conname='journey_step_links_journey_id_step_id_key'`);
    expect(cons).toHaveLength(0);
    const { rows: idx } = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename='journey_step_links'`);
    const names = idx.map(r => r.indexname);
    expect(names).toContain('uq_jsl_membership');
    expect(names).toContain('uq_jsl_cell');
    expect(names).toContain('idx_jsl_feature');
  });

  it('cell_kind 有 CHECK 且 cell 行必须带 cell_key', async () => {
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
      WHERE t.relname='journey_step_links' AND c.contype='c'`);
    const names = rows.map(r => r.conname);
    expect(names).toContain('jsl_cell_key_required');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `createdb -U cecelia cecelia_scratch 2>/dev/null || true && cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js && DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/migration-347.integration.test.js`
Expected: FAIL（home 列不存在）

- [ ] **Step 3: 写 migration 347**

```sql
-- packages/brain/migrations/347_promise_map_schema.sql
-- MJ5 刀1：承诺地图 schema（PRD docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md §三）
-- journeys=路（GP），journey_steps=承诺步，journey_step_links 扩展为格子表（判定点③：禁平行表）

ALTER TABLE journeys ADD COLUMN IF NOT EXISTS home varchar(10);
ALTER TABLE journeys DROP CONSTRAINT IF EXISTS journeys_home_check;
ALTER TABLE journeys ADD CONSTRAINT journeys_home_check CHECK (home IS NULL OR home IN ('biz','pre','xcut','factory'));
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS domain varchar(100);
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS trigger text;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS endpoint text;

ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS promise text;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS backbone_version integer NOT NULL DEFAULT 1;

ALTER TABLE journey_features ADD COLUMN IF NOT EXISTS softness varchar(10) NOT NULL DEFAULT 'hard';
ALTER TABLE journey_features DROP CONSTRAINT IF EXISTS journey_features_softness_check;
ALTER TABLE journey_features ADD CONSTRAINT journey_features_softness_check CHECK (softness IN ('hard','soft'));

ALTER TABLE journey_step_links ALTER COLUMN step_order DROP NOT NULL;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS feature_id uuid REFERENCES journey_features(id) ON DELETE SET NULL;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_kind varchar(20);
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_key varchar(200);
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_status varchar(10);
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS assertion_ref text;
ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS na_reason text;
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_kind_check;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_kind_check
  CHECK (cell_kind IS NULL OR cell_kind IN ('capability','element','scenario','base_ref'));
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_status_check;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_status_check
  CHECK (cell_status IS NULL OR cell_status IN ('gray','red','pending','green'));
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS jsl_cell_key_required;
ALTER TABLE journey_step_links ADD CONSTRAINT jsl_cell_key_required
  CHECK (cell_kind IS NULL OR cell_key IS NOT NULL);

-- 旧的一步一行 UNIQUE 让位给格子多行；旧语义由 partial unique 原样保留
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS journey_step_links_journey_id_step_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jsl_membership ON journey_step_links(journey_id, step_id) WHERE cell_kind IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jsl_cell ON journey_step_links(step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jsl_feature ON journey_step_links(feature_id) WHERE feature_id IS NOT NULL;
```

- [ ] **Step 4: 重建 scratch 库跑 migrate + 测试通过**

Run: `dropdb -U cecelia cecelia_scratch && createdb -U cecelia cecelia_scratch && cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js && DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/migration-347.integration.test.js`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/migrations/347_promise_map_schema.sql packages/brain/src/__tests__/integration/migration-347.integration.test.js
git commit -m "feat(brain/schema): migration 347 承诺地图四表加列+journey_step_links格子化 [c93b3def]"
```

---

### Task 2: 修 POST /journey_step_links 的 ON CONFLICT（blocker 1）+ cell 字段扩展

**Files:**
- Modify: `packages/brain/src/routes/journeys.js:342-362`
- Test: `packages/brain/src/routes/__tests__/journeys.test.js`（追加用例）

- [ ] **Step 1: 写失败测试**（追加到现有 journeys.test.js，沿用该文件的 vi.mock db.js + supertest 模式）

```js
describe('POST /journey_step_links cell 化', () => {
  it('legacy 行 upsert 用 partial index 冲突目标', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'x' }] });
    const res = await request(app).post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', step_order: 1 });
    expect(res.status).toBe(201);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('ON CONFLICT (journey_id, step_id) WHERE cell_kind IS NULL');
  });

  it('cell 行走 cell 冲突目标且必须带 cell_key', async () => {
    const bad = await request(app).post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', cell_kind: 'capability' });
    expect(bad.status).toBe(400);

    pool.query.mockResolvedValueOnce({ rows: [{ id: 'y' }] });
    const res = await request(app).post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', cell_kind: 'base_ref', cell_key: 'CRM 表底座',
              cell_status: 'pending', feature_id: 'f1' });
    expect(res.status).toBe(201);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
Expected: FAIL（旧 SQL 无 WHERE 谓词、无 cell 分支）

- [ ] **Step 3: 改路由**（整体替换 journeys.js 342-362 的 POST handler）

```js
// POST /api/brain/journey_step_links —— legacy 连接行 + 格子行双通道
router.post('/journey_step_links', async (req, res) => {
  try {
    const {
      journey_id, step_id, step_order, status,
      cell_kind, cell_key, cell_status, feature_id, assertion_ref, na_reason,
    } = req.body;
    if (!journey_id || !step_id) {
      return res.status(400).json({ error: 'journey_id, step_id are required' });
    }

    if (cell_kind) {
      const VALID_CELL_KINDS = ['capability', 'element', 'scenario', 'base_ref'];
      const VALID_CELL_STATUS = ['gray', 'red', 'pending', 'green'];
      if (!VALID_CELL_KINDS.includes(cell_kind)) {
        return res.status(400).json({ error: `cell_kind must be one of: ${VALID_CELL_KINDS.join(',')}` });
      }
      if (!cell_key) return res.status(400).json({ error: 'cell_key is required when cell_kind is set' });
      if (cell_status && !VALID_CELL_STATUS.includes(cell_status)) {
        return res.status(400).json({ error: `cell_status must be one of: ${VALID_CELL_STATUS.join(',')}` });
      }
      const { rows } = await pool.query(
        `INSERT INTO journey_step_links
           (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, assertion_ref, na_reason, status, notion_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned',NOW())
         ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO UPDATE SET
           cell_status=EXCLUDED.cell_status, feature_id=EXCLUDED.feature_id,
           assertion_ref=EXCLUDED.assertion_ref, na_reason=EXCLUDED.na_reason
         RETURNING *`,
        [journey_id, step_id, cell_kind, cell_key, cell_status || 'gray',
         feature_id || null, assertion_ref || null, na_reason || null]
      );
      return res.status(201).json(rows[0]);
    }

    if (step_order === undefined) {
      return res.status(400).json({ error: 'step_order is required for non-cell links' });
    }
    const { rows } = await pool.query(
      `INSERT INTO journey_step_links (journey_id, step_id, step_order, status, notion_synced_at)
       VALUES ($1,$2,$3,$4,NULL)
       ON CONFLICT (journey_id, step_id) WHERE cell_kind IS NULL DO UPDATE SET
         step_order=EXCLUDED.step_order, status=EXCLUDED.status
       RETURNING *`,
      [journey_id, step_id, step_order, status || 'planned']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[journeys] POST /journey_step_links error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: 跑测试通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/journeys.js packages/brain/src/routes/__tests__/journeys.test.js
git commit -m "fix(brain/routes): journey_step_links upsert 换 partial 冲突目标+格子行双通道（防 347 删约束后 500） [c93b3def]"
```

---

### Task 3: Notion push 过滤 cell 行（blocker 2）

**Files:**
- Modify: `packages/brain/src/notion-push-sync.js:285`
- Test: `packages/brain/src/__tests__/notion-push-sync.test.js`（追加断言）

- [ ] **Step 1: 写失败测试**（追加）

```js
it('pushJourneyStepLinks 查询排除 cell 行（cell_kind IS NULL）', async () => {
  // 沿用该文件现有 mock 结构：捕获第一次 pool.query 的 SQL 文本
  pool.query.mockResolvedValue({ rows: [] });
  await pushJourneyStepLinks(pool, 'tok');
  const sql = pool.query.mock.calls[0][0];
  expect(sql).toContain('cell_kind IS NULL');
});
```

（若该测试文件未 export pushJourneyStepLinks，按文件现有调用方式驱动——它按 mock 顺序驱动主循环，则改为在现有主流程用例后追加对相应 call 的 SQL 断言。执行者读文件后择其一，断言目标不变：查询文本含 `cell_kind IS NULL`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/notion-push-sync.test.js`
Expected: FAIL

- [ ] **Step 3: 改查询**（notion-push-sync.js 285 行处）

```sql
    WHERE l.notion_synced_at IS NULL
      AND l.cell_kind IS NULL
      AND j.notion_id IS NOT NULL
      AND s.notion_id IS NOT NULL
```

- [ ] **Step 4: 跑测试通过**

Run: `cd packages/brain && npx vitest run src/__tests__/notion-push-sync.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/notion-push-sync.js packages/brain/src/__tests__/notion-push-sync.test.js
git commit -m "fix(brain/notion-sync): step_links push 排除格子行，防 seed 后连接表被刷 [c93b3def]"
```

---

### Task 4: Migration 348（两域 seed）+ 集成测试

**Files:**
- Create: `packages/brain/migrations/348_seed_promise_map_two_domains.sql`
- Test: `packages/brain/src/__tests__/integration/migration-348.integration.test.js`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/integration/migration-348.integration.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
let pool;

const GPB = 'ac2e35bc-849a-48cd-917f-79d15c5ac886';
const CRM = '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2';
const BIND = '24a98312-1941-4a0b-91c9-8bf79ef47311';

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

describe('migration 348: 承诺地图两域 seed', () => {
  it('智能客服域 7 条 journey（5 GP + 家② + 域锚）', async () => {
    const { rows } = await pool.query(`SELECT name, home FROM journeys WHERE domain='智能客服'`);
    expect(rows).toHaveLength(7);
    expect(rows.filter(r => r.home === 'biz')).toHaveLength(5);
    expect(rows.filter(r => r.home === 'pre')).toHaveLength(1);
  });

  it('GP-B 四步承诺逐字与 V4 一致（抽 S1）', async () => {
    const { rows } = await pool.query(
      `SELECT promise FROM journey_steps WHERE journey_id=$1 AND step_number=1`, [GPB]);
    expect(rows[0].promise).toBe('客户发来的任何消息，系统数秒内看到，一条不漏、一条不重');
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_steps WHERE journey_id=$1 AND promise IS NOT NULL`, [GPB]);
    expect(cnt[0].c).toBe(4);
  });

  it('家③ 7 个底座件在账（group=家③横切件池）', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_features WHERE "group"='家③横切件池'`);
    expect(rows[0].c).toBe(7);
  });

  it('CRM 表底座 blast-radius = 4 步（B·S2/B·S4/D·S1/E·S3，全景图口径）', async () => {
    const { rows } = await pool.query(`
      SELECT j.name AS jname, s.step_number
      FROM journey_step_links l
      JOIN journey_steps s ON s.id = l.step_id
      JOIN journeys j ON j.id = s.journey_id
      WHERE l.feature_id = $1 AND l.cell_kind = 'base_ref'
      ORDER BY j.name, s.step_number`, [CRM]);
    expect(rows).toHaveLength(4);
    const keys = rows.map(r => `${r.jname.includes('GP-B') ? 'B' : r.jname.includes('GP-D') ? 'D' : r.jname.includes('GP-E') ? 'E' : '?'}·S${r.step_number}`);
    expect(keys.sort()).toEqual(['B·S2', 'B·S4', 'D·S1', 'E·S3']);
  });

  it('绑定/安装被 B/C/E/F 的 S1 + 首次成功 S2 引用（5 处）', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_step_links WHERE feature_id=$1 AND cell_kind='base_ref'`, [BIND]);
    expect(rows[0].c).toBe(5);
  });

  it('首次成功五步承诺齐 + 存量 S2 名称零丢失', async () => {
    const { rows } = await pool.query(
      `SELECT step_number, name, promise FROM journey_steps
       WHERE journey_id='6e63f204-e9fd-4a3b-b338-6b3616bfcc61' ORDER BY step_number`);
    expect(rows).toHaveLength(5);
    expect(rows.every(r => r.promise)).toBe(true);
  });

  it('全部 cell 行 notion_synced_at 非空（不推 Notion）', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_step_links WHERE cell_kind IS NOT NULL AND notion_synced_at IS NULL`);
    expect(rows[0].c).toBe(0);
  });

  it('幂等：重放 348 文件内容不新增行', async () => {
    const before = (await pool.query(`SELECT COUNT(*)::int AS c FROM journey_step_links`)).rows[0].c;
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(path.resolve(dir, '../../../migrations/348_seed_promise_map_two_domains.sql'), 'utf8');
    await pool.query(sql);
    const after = (await pool.query(`SELECT COUNT(*)::int AS c FROM journey_step_links`)).rows[0].c;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/migration-348.integration.test.js`
Expected: FAIL（0 journey 命中）

- [ ] **Step 3: 写 migration 348**——完整 SQL 按下述结构，数据行照 spec §4.1 inventory 一字不差搬（承诺/触发器/终点/芯片名全部取三张图原文；本 Task 下方已给全量 VALUES）：

```sql
-- packages/brain/migrations/348_seed_promise_map_two_domains.sql
-- MJ5 刀1：两打样域落库（智能客服 Line04 + 公司级首次成功）。幂等 + 空库自足。
-- 数据 SSOT：V4 骨干 artifact c9754f42 / 全景四个家 4e744c89 / GP-B 总表 93a47469

-- ① 存量域锚（生产已存在→仅补列；空库→同 UUID 兜底创建）
INSERT INTO journeys (id, name, journey_type, maturity, status)
VALUES
  ('bfeed805-deed-46c3-8624-87f0028101d4','客户私域 AI 接管','user_facing','skeleton','active'),
  ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61','客户首次成功路径','user_facing','mvp','active')
ON CONFLICT (id) DO NOTHING;

UPDATE journeys SET domain='智能客服', updated_at=NOW()
 WHERE id='bfeed805-deed-46c3-8624-87f0028101d4';
UPDATE journeys SET domain='公司级', home='biz', trigger='客户签约开通',
       endpoint='客户自己会看 Dashboard，了解经营情况', updated_at=NOW()
 WHERE id='6e63f204-e9fd-4a3b-b338-6b3616bfcc61';

-- ② 5 条 GP + 家②（trigger/endpoint 取 V4 原文）
INSERT INTO journeys (id, name, journey_type, maturity, status, home, domain, trigger, endpoint) VALUES
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886','智能客服 · GP-B 被动接待','user_facing','skeleton','active','biz','智能客服','客户发来消息','客户收到得体回复（或真人接手），这笔互动老板可查'),
 ('016459f9-98e0-40a2-a89e-92f8d34bb661','智能客服 · GP-C 朋友圈发布','user_facing','skeleton','active','biz','智能客服','到了该发内容的时候（内容日历/老板指令）','一条像人发的朋友圈，出现在客户能看到的地方'),
 ('3ae2414e-3e92-4471-9908-892245b4e37a','智能客服 · GP-D 经营汇报','user_facing','skeleton','active','biz','智能客服','到汇报时间（日/周/月）','老板按时收到一份真实反映经营情况的报告'),
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd','智能客服 · GP-E 朋友圈互动','user_facing','skeleton','active','biz','智能客服','客户发了朋友圈','客户感到被关注，关系升温且不越界'),
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea','智能客服 · GP-F 社群运营','user_facing','skeleton','active','biz','智能客服','群里出现需要响应的动静','群保持健康有序，客户问题被接住'),
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2','智能客服 · 绑定/安装（共享前置）','user_facing','mvp','active','pre','智能客服','新客户开通后首次进场','Agent 连上中台、账号绑定完成，可进任何业务路')
ON CONFLICT (id) DO NOTHING;

-- ③ steps（promise=V4 原文；ON CONFLICT 只补 promise，存量 name/status 零丢失）
INSERT INTO journey_steps (journey_id, step_number, name, status, promise) VALUES
 -- GP-B
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',1,'消息被感知','in_progress','客户发来的任何消息，系统数秒内看到，一条不漏、一条不重'),
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',2,'决定谁来答','in_progress','AI 能答的 AI 答；该转人的一定转到人，而且人接得住'),
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',3,'回复送达','in_progress','客户收到一条得体、及时、真的送到了的回复'),
 ('ac2e35bc-849a-48cd-917f-79d15c5ac886',4,'留痕与善后','in_progress','每次对话进账本：CRM 已回填、异常（被拉黑/罢工）会有人知道'),
 -- GP-C
 ('016459f9-98e0-40a2-a89e-92f8d34bb661',1,'内容成稿','in_progress','到点就有一条拿得出手的内容稿'),
 ('016459f9-98e0-40a2-a89e-92f8d34bb661',2,'发布上圈','in_progress','稿子真的发出去了，图文完整'),
 ('016459f9-98e0-40a2-a89e-92f8d34bb661',3,'发布确认与留痕','planned','发没发成功、发了什么，老板可查'),
 -- GP-D
 ('3ae2414e-3e92-4471-9908-892245b4e37a',1,'数据齐备','in_progress','报告依据的数据是全的、新的'),
 ('3ae2414e-3e92-4471-9908-892245b4e37a',2,'报告生成','in_progress','到点自动出稿，人话、可决策'),
 ('3ae2414e-3e92-4471-9908-892245b4e37a',3,'送达老板','planned','报告真的到了老板手上（不是躺在数据库里）'),
 -- GP-E
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd',1,'客户动态被感知','planned','重点客户的朋友圈动态不漏看'),
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd',2,'互动决策','in_progress','该点赞的点、该评论的出稿，不该出手的绝不出手'),
 ('b6a73832-b42b-4678-87ca-3ce00a6d70dd',3,'互动执行与留痕','planned','互动真的发生了，并记进客户关系账'),
 -- GP-F
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea',1,'群动静被感知','planned','白名单群里的关键动静不漏看'),
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea',2,'响应与治理','planned','该答的答、该管的管（广告号出局），不吵不越界'),
 ('8fe9ed6b-999a-4041-8126-8567f68d3dea',3,'留痕','planned','群里发生了什么、处理了什么，老板可查'),
 -- 家② 绑定/安装
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2',1,'注册自动登录','done','注册即登录，无需人工开通'),
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2',2,'装客户端 + Agent 连中台','done','装完客户端，Agent 自动连上中台'),
 ('6df5b884-2ae1-4801-95e8-bb7a11f308d2',3,'扫码绑抖音主号','done','扫码即绑定主号，进场完成'),
 -- 首次成功（S2 与存量行冲突→只补 promise）
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',1,'开通','done','客户签约后当天完成开通，进场凭据就绪'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',2,'装好连上','done','装完客户端，Agent 自动连上中台'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',3,'绑资产','done','客户的账号与素材资产绑定完成'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',4,'第一次价值（按线参数化）','in_progress','客户拿到第一次可感知的业务价值（按业务线参数化）'),
 ('6e63f204-e9fd-4a3b-b338-6b3616bfcc61',5,'会看 dashboard','in_progress','客户自己会看 Dashboard 了解经营情况')
ON CONFLICT (journey_id, step_number) DO UPDATE SET promise=EXCLUDED.promise, updated_at=NOW();

-- ④ 家②件 + 家③ 7 底座件（状态映射：已亮→working / 半成→building / 待出生→planned）
INSERT INTO journey_features (id, name, journey_id, kind, thickness, status, "group") VALUES
 ('24a98312-1941-4a0b-91c9-8bf79ef47311','绑定/安装（共享前置）','6df5b884-2ae1-4801-95e8-bb7a11f308d2','feature','thin','working','家②共享前置'),
 ('6691d09a-3525-4610-87d2-2d8261d68111','消息/动态采集通道','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池'),
 ('0d4922c9-0a5e-4aa6-93ff-6e1911342622','Agent 运行时底座（启动状态恢复·开机自检·保活重连）','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','planned','家③横切件池'),
 ('2dde3bb5-2cb9-4c33-b592-224b1f4ffe41','后台静默发送通道','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池'),
 ('7f680eb3-0866-4429-a600-b396e980fc59','接管开关','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池'),
 ('d831dd0f-893c-49b6-8857-07756f5a7030','客户画像卡','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','planned','家③横切件池'),
 ('0b70f2ff-1a16-4029-a71a-e6cb5a523ea2','CRM 表底座','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','building','家③横切件池'),
 ('39130340-16f0-47f1-9779-fc0b57218dd0','记忆库租户隔离（不变量）','bfeed805-deed-46c3-8624-87f0028101d4','feature','thin','working','家③横切件池')
ON CONFLICT (id) DO NOTHING;

-- ⑤ 格子（cells）：cell 行 notion_synced_at=NOW() 不推 Notion；幂等键=(step_id,cell_kind,cell_key)
WITH gp(letter, jid) AS (VALUES
  ('B','ac2e35bc-849a-48cd-917f-79d15c5ac886'::uuid),
  ('C','016459f9-98e0-40a2-a89e-92f8d34bb661'::uuid),
  ('D','3ae2414e-3e92-4471-9908-892245b4e37a'::uuid),
  ('E','b6a73832-b42b-4678-87ca-3ce00a6d70dd'::uuid),
  ('F','8fe9ed6b-999a-4041-8126-8567f68d3dea'::uuid),
  ('FS','6e63f204-e9fd-4a3b-b338-6b3616bfcc61'::uuid)
),
cell_data(letter, step_no, ckind, ckey, cstatus, fid, aref, nar) AS (VALUES
  -- ===== GP-B S1（总表）=====
  ('B',1,'capability','文字','green',NULL::uuid,NULL,NULL),
  ('B',1,'capability','图片','gray',NULL,NULL,NULL),
  ('B',1,'capability','语音','gray',NULL,NULL,NULL),
  ('B',1,'capability','表情','gray',NULL,NULL,NULL),
  ('B',1,'capability','链接','gray',NULL,NULL,NULL),
  ('B',1,'capability','红包','gray',NULL,NULL,NULL),
  ('B',1,'capability','转账','gray',NULL,NULL,NULL),
  ('B',1,'capability','文件','gray',NULL,NULL,NULL),
  ('B',1,'element','FR','pending',NULL,NULL,NULL),
  ('B',1,'element','NFR','green',NULL,NULL,NULL),
  ('B',1,'element','判定点','pending',NULL,NULL,NULL),
  ('B',1,'element','两轴衔接','red',NULL,NULL,NULL),
  ('B',1,'element','不变量','green',NULL,NULL,NULL),
  ('B',1,'element','失败语义','red',NULL,NULL,NULL),
  ('B',1,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',1,'element','效果确认','red',NULL,NULL,NULL),
  ('B',1,'element','对抗面','red',NULL,NULL,NULL),
  ('B',1,'element','保质期','red',NULL,NULL,NULL),
  ('B',1,'scenario','日常','green',NULL,NULL,NULL),
  ('B',1,'scenario','首次','green',NULL,NULL,NULL),
  ('B',1,'scenario','重启','red',NULL,NULL,NULL),
  ('B',1,'scenario','断网','red',NULL,NULL,NULL),
  ('B',1,'scenario','洪峰','red',NULL,NULL,NULL),
  ('B',1,'scenario','平台改版','red',NULL,NULL,NULL),
  ('B',1,'scenario','凭据过期','gray',NULL,NULL,'本步不涉及凭据'),
  ('B',1,'base_ref','消息/动态采集通道','green','6691d09a-3525-4610-87d2-2d8261d68111',NULL,NULL),
  ('B',1,'base_ref','Agent 运行时底座','gray','0d4922c9-0a5e-4aa6-93ff-6e1911342622',NULL,NULL),
  ('B',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  -- ===== GP-B S2 =====
  ('B',2,'capability','怒/诉/退→转人工','green',NULL,NULL,NULL),
  ('B',2,'capability','CRM 分级依据','pending',NULL,NULL,NULL),
  ('B',2,'capability','客户画像卡（体验件）','gray',NULL,NULL,NULL),
  ('B',2,'element','FR','green',NULL,NULL,NULL),
  ('B',2,'element','NFR','red',NULL,NULL,NULL),
  ('B',2,'element','判定点','pending',NULL,'eval:模糊承诺-该不该转LLM判,评测集待建',NULL),
  ('B',2,'element','两轴衔接','gray',NULL,NULL,'本步不跨 lane'),
  ('B',2,'element','不变量','green',NULL,NULL,NULL),
  ('B',2,'element','失败语义','red',NULL,NULL,NULL),
  ('B',2,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',2,'element','效果确认','red',NULL,NULL,NULL),
  ('B',2,'element','对抗面','red',NULL,NULL,NULL),
  ('B',2,'element','保质期','red',NULL,NULL,NULL),
  ('B',2,'scenario','日常','green',NULL,NULL,NULL),
  ('B',2,'scenario','人不在线','red',NULL,NULL,NULL),
  ('B',2,'scenario','对抗输入','red',NULL,NULL,NULL),
  ('B',2,'scenario','重启','gray',NULL,NULL,'本步无状态可恢复'),
  ('B',2,'base_ref','接管开关','green','7f680eb3-0866-4429-a600-b396e980fc59',NULL,NULL),
  ('B',2,'base_ref','客户画像卡','gray','d831dd0f-893c-49b6-8857-07756f5a7030',NULL,NULL),
  ('B',2,'base_ref','CRM 表底座','pending','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  ('B',2,'base_ref','记忆库租户隔离','green','39130340-16f0-47f1-9779-fc0b57218dd0',NULL,NULL),
  -- ===== GP-B S3 =====
  ('B',3,'capability','文字发送','green',NULL,NULL,NULL),
  ('B',3,'capability','图片发送','gray',NULL,NULL,NULL),
  ('B',3,'capability','链接发送','gray',NULL,NULL,NULL),
  ('B',3,'capability','文件/视频发送','gray',NULL,NULL,NULL),
  ('B',3,'element','FR','green',NULL,NULL,NULL),
  ('B',3,'element','NFR','green',NULL,NULL,NULL),
  ('B',3,'element','判定点','red',NULL,'eval:模糊承诺-得体判定,评测集待建',NULL),
  ('B',3,'element','两轴衔接','gray',NULL,NULL,'本步无两轴衔接'),
  ('B',3,'element','不变量','green',NULL,NULL,NULL),
  ('B',3,'element','失败语义','red',NULL,NULL,NULL),
  ('B',3,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',3,'element','效果确认','red',NULL,NULL,NULL),
  ('B',3,'element','保质期','red',NULL,NULL,NULL),
  ('B',3,'scenario','日常','green',NULL,NULL,NULL),
  ('B',3,'scenario','断网排队重发','red',NULL,NULL,NULL),
  ('B',3,'scenario','微信升级后','red',NULL,NULL,NULL),
  ('B',3,'scenario','高峰频控','red',NULL,NULL,NULL),
  ('B',3,'base_ref','后台静默发送通道','green','2dde3bb5-2cb9-4c33-b592-224b1f4ffe41',NULL,NULL),
  ('B',3,'base_ref','记忆库租户隔离','green','39130340-16f0-47f1-9779-fc0b57218dd0',NULL,NULL),
  -- ===== GP-B S4 =====
  ('B',4,'capability','CRM 回填','pending',NULL,NULL,NULL),
  ('B',4,'capability','拉黑检测','gray',NULL,NULL,NULL),
  ('B',4,'capability','对话摘要入档','gray',NULL,NULL,NULL),
  ('B',4,'element','FR','pending',NULL,NULL,NULL),
  ('B',4,'element','NFR','red',NULL,NULL,NULL),
  ('B',4,'element','判定点','red',NULL,NULL,NULL),
  ('B',4,'element','两轴衔接','pending',NULL,NULL,NULL),
  ('B',4,'element','不变量','red',NULL,NULL,NULL),
  ('B',4,'element','失败语义','red',NULL,NULL,NULL),
  ('B',4,'element','死亡告警','red',NULL,NULL,NULL),
  ('B',4,'element','效果确认','red',NULL,NULL,NULL),
  ('B',4,'element','对抗面','red',NULL,NULL,NULL),
  ('B',4,'element','保质期','red',NULL,NULL,NULL),
  ('B',4,'element','账本保鲜','red',NULL,NULL,NULL),
  ('B',4,'scenario','全场景未验','red',NULL,NULL,NULL),
  ('B',4,'base_ref','CRM 表底座','pending','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  -- ===== GP-C =====
  ('C',1,'capability','文案生成','green',NULL,NULL,NULL),
  ('C',1,'capability','配图生成','gray',NULL,NULL,NULL),
  ('C',1,'element','判定点','pending',NULL,NULL,'AI画图 vs 素材库选图，未拍板'),
  ('C',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  ('C',2,'capability','纯文案发布','green',NULL,NULL,NULL),
  ('C',2,'capability','图文发布','gray',NULL,NULL,NULL),
  ('C',3,'capability','发布结果确认','red',NULL,NULL,NULL),
  ('C',3,'capability','发布台账','red',NULL,NULL,NULL),
  -- ===== GP-D =====
  ('D',1,'capability','CRM 表为唯一数据源','pending',NULL,NULL,NULL),
  ('D',1,'base_ref','CRM 表底座','pending','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  ('D',2,'capability','日报','pending',NULL,NULL,NULL),
  ('D',2,'capability','周报','gray',NULL,NULL,NULL),
  ('D',2,'capability','月报','gray',NULL,NULL,NULL),
  ('D',3,'capability','推送通道与送达确认','red',NULL,NULL,NULL),
  -- ===== GP-E =====
  ('E',1,'capability','动态采集','gray',NULL,NULL,NULL),
  ('E',1,'base_ref','消息/动态采集通道','gray','6691d09a-3525-4610-87d2-2d8261d68111',NULL,NULL),
  ('E',1,'base_ref','Agent 运行时底座','gray','0d4922c9-0a5e-4aa6-93ff-6e1911342622',NULL,NULL),
  ('E',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  ('E',2,'element','判定点','green',NULL,NULL,'已拍板：语义判定点赞；评论 AI 出稿不自动发'),
  ('E',3,'capability','点赞执行','gray',NULL,NULL,NULL),
  ('E',3,'capability','评论发布（人审后）','gray',NULL,NULL,NULL),
  ('E',3,'capability','回填 CRM 关系记录','red',NULL,NULL,NULL),
  ('E',3,'base_ref','后台静默发送通道','gray','2dde3bb5-2cb9-4c33-b592-224b1f4ffe41',NULL,NULL),
  ('E',3,'base_ref','CRM 表底座','gray','0b70f2ff-1a16-4029-a71a-e6cb5a523ea2',NULL,NULL),
  -- ===== GP-F =====
  ('F',1,'capability','群消息采集','gray',NULL,NULL,NULL),
  ('F',1,'element','判定点','green',NULL,NULL,'已拍板：默认全静默，只拉白关键群'),
  ('F',1,'base_ref','消息/动态采集通道','gray','6691d09a-3525-4610-87d2-2d8261d68111',NULL,NULL),
  ('F',1,'base_ref','Agent 运行时底座','gray','0d4922c9-0a5e-4aa6-93ff-6e1911342622',NULL,NULL),
  ('F',1,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL),
  ('F',2,'capability','群内 AI 答','gray',NULL,NULL,NULL),
  ('F',2,'capability','群公告','gray',NULL,NULL,NULL),
  ('F',2,'capability','踢广告号','gray',NULL,NULL,NULL),
  ('F',2,'base_ref','后台静默发送通道','gray','2dde3bb5-2cb9-4c33-b592-224b1f4ffe41',NULL,NULL),
  ('F',3,'capability','群运营台账','red',NULL,NULL,NULL),
  -- ===== 首次成功 =====
  ('FS',2,'base_ref','绑定/安装（共享前置）','green','24a98312-1941-4a0b-91c9-8bf79ef47311',NULL,NULL)
)
INSERT INTO journey_step_links
  (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, assertion_ref, na_reason, status, notion_synced_at)
SELECT s.journey_id, s.id, cd.ckind, cd.ckey, cd.cstatus, cd.fid, cd.aref, cd.nar, 'planned', NOW()
FROM cell_data cd
JOIN gp ON gp.letter = cd.letter
JOIN journey_steps s ON s.journey_id = gp.jid AND s.step_number = cd.step_no
ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO UPDATE SET
  cell_status = EXCLUDED.cell_status,
  feature_id  = EXCLUDED.feature_id,
  assertion_ref = EXCLUDED.assertion_ref,
  na_reason   = EXCLUDED.na_reason;
```

注意：E·S2 与 F·S1 的"已拍板"判定点放 na_reason 不合语义——放 `assertion_ref`（改成 `('E',2,'element','判定点','green',NULL,'已拍板：语义判定点赞；评论 AI 出稿不自动发',NULL)` 与 `('F',1,'element','判定点','green',NULL,'已拍板：默认全静默，只拉白关键群',NULL)`；C·S1 判定点同理挪到 assertion_ref='待拍板：AI画图 vs 素材库选图'）。执行时以本注为准。

- [ ] **Step 4: 重建 scratch 库全量 migrate + 测试通过**

Run: `dropdb -U cecelia cecelia_scratch && createdb -U cecelia cecelia_scratch && cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js && DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/migration-348.integration.test.js`
Expected: PASS（8 用例全绿，含幂等重放）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/migrations/348_seed_promise_map_two_domains.sql packages/brain/src/__tests__/integration/migration-348.integration.test.js
git commit -m "feat(brain/seed): migration 348 智能客服+首次成功两域承诺地图落库（幂等/空库自足/cell不推Notion） [c93b3def]"
```

---

### Task 5: blast-radius 端点 + 落账端点白名单扩展

**Files:**
- Modify: `packages/brain/src/routes/journeys.js`（4 处）
- Test: `packages/brain/src/routes/__tests__/journeys.test.js`（追加）
- Test: `packages/brain/src/__tests__/integration/blast-radius.integration.test.js`（新建）

- [ ] **Step 1: 写失败单测**（追加到 journeys.test.js）

```js
describe('GET /journey_features/:id/blast-radius', () => {
  it('返回 feature + 引用步骤清单', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'CRM 表底座', status: 'building', group: '家③横切件池' }] })
      .mockResolvedValueOnce({ rows: [{ journey_id: 'j1', journey_name: 'GP-B', domain: '智能客服', step_id: 's1', step_name: '决定谁来答', step_number: 2, promise: 'x', cell_status: 'pending' }] });
    const res = await request(app).get('/api/brain/journey_features/f1/blast-radius');
    expect(res.status).toBe(200);
    expect(res.body.feature.name).toBe('CRM 表底座');
    expect(res.body.count).toBe(1);
    expect(res.body.blast_radius[0].promise).toBe('x');
  });

  it('feature 不存在 → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/brain/journey_features/nope/blast-radius');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /journeys/:id 承诺地图字段', () => {
  it('白名单更新 home/domain/trigger/endpoint', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'j1', home: 'biz' }] });
    const res = await request(app).patch('/api/brain/journeys/j1')
      .send({ home: 'biz', domain: '智能客服', trigger: 't', endpoint: 'e' });
    expect(res.status).toBe(200);
  });
  it('home 非法值 → 400', async () => {
    const res = await request(app).patch('/api/brain/journeys/j1').send({ home: 'nope' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /journey_features/:id softness/group', () => {
  it('softness 白名单', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'f1', softness: 'soft' }] });
    const res = await request(app).patch('/api/brain/journey_features/f1').send({ softness: 'soft' });
    expect(res.status).toBe(200);
  });
  it('softness 非法值 → 400', async () => {
    const res = await request(app).patch('/api/brain/journey_features/f1').send({ softness: 'fuzzy' });
    expect(res.status).toBe(400);
  });
});

describe('POST /journey_steps promise', () => {
  it('insert+update 都带 promise/backbone_version', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 's1' }] });
    const res = await request(app).post('/api/brain/journey_steps')
      .send({ journey_id: 'j1', name: 'n', step_number: 1, promise: 'p' });
    expect(res.status).toBe(200);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('promise');
    expect(sql).toContain('backbone_version');
  });
});
```

- [ ] **Step 2: 跑单测确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
Expected: FAIL（404 路由不存在等）

- [ ] **Step 3: 实现 4 处路由改动**

3a. blast-radius——插在 `unguarded-count`（:95）之后、`GET /journey_features`（:108）之前：

```js
// GET /api/brain/journey_features/:id/blast-radius — 塌了哪些承诺红（MJ5 S1）
// 注：挂 journey_features 前缀而非 PRD 原文 /features/:id（后者已被 feature-ledger 表占用）
router.get('/journey_features/:id/blast-radius', async (req, res) => {
  try {
    const { rows: frows } = await pool.query(
      `SELECT id, name, status, "group" FROM journey_features WHERE id=$1`, [req.params.id]);
    if (!frows.length) return res.status(404).json({ error: 'feature not found' });
    const { rows } = await pool.query(
      `SELECT j.id AS journey_id, j.name AS journey_name, j.domain,
              s.id AS step_id, s.name AS step_name, s.step_number, s.promise, l.cell_status
       FROM journey_step_links l
       JOIN journey_steps s ON s.id = l.step_id
       JOIN journeys j ON j.id = s.journey_id
       WHERE l.feature_id = $1 AND l.cell_kind = 'base_ref'
       ORDER BY j.name, s.step_number`, [req.params.id]);
    res.json({ feature: frows[0], blast_radius: rows, count: rows.length });
  } catch (err) {
    console.error('[journeys] GET blast-radius error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

3b. PATCH /journeys/:id——插在 `GET /journeys/:id`（:82-92）之后：

```js
// PATCH /api/brain/journeys/:id — 承诺地图字段（mapper 落账用）
const VALID_HOMES = ['biz', 'pre', 'xcut', 'factory'];
router.patch('/journeys/:id', async (req, res) => {
  try {
    const { home, domain, trigger, endpoint, description, maturity } = req.body;
    if (home && !VALID_HOMES.includes(home)) {
      return res.status(400).json({ error: `home must be one of: ${VALID_HOMES.join(',')}` });
    }
    const sets = [];
    const vals = [];
    let idx = 1;
    if (home !== undefined)        { sets.push(`home=$${idx++}`);        vals.push(home); }
    if (domain !== undefined)      { sets.push(`domain=$${idx++}`);      vals.push(domain); }
    if (trigger !== undefined)     { sets.push(`trigger=$${idx++}`);     vals.push(trigger); }
    if (endpoint !== undefined)    { sets.push(`endpoint=$${idx++}`);    vals.push(endpoint); }
    if (description !== undefined) { sets.push(`description=$${idx++}`); vals.push(description); }
    if (maturity !== undefined)    { sets.push(`maturity=$${idx++}`);    vals.push(maturity); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE journeys SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] PATCH /journeys/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

3c. PATCH /journey_features/:id（:181-213）——解构加 `softness, group`，校验 + sets 追加：

```js
    const { thickness, status, unit_test_path, version, guard_ref, softness, group } = req.body;
    // …原 thickness 校验后追加：
    if (softness && !['hard', 'soft'].includes(softness)) {
      return res.status(400).json({ error: 'softness must be hard|soft' });
    }
    // …sets 序列追加：
    if (softness)                       { sets.push(`softness=$${idx++}`);        vals.push(softness); }
    if (group !== undefined)            { sets.push(`"group"=$${idx++}`);         vals.push(group ?? null); }
```

3d. POST /journey_steps（:300-320）——upsert 带 promise/backbone_version：

```js
    const { journey_id, name, step_number, description, status, promise, backbone_version } = req.body;
    if (!journey_id || !name || step_number === undefined) {
      return res.status(400).json({ error: 'journey_id, name, step_number are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO journey_steps (journey_id, name, step_number, description, status, promise, backbone_version, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,1),NULL)
       ON CONFLICT (journey_id, step_number) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description,
         promise=COALESCE(EXCLUDED.promise, journey_steps.promise),
         backbone_version=COALESCE($7, journey_steps.backbone_version),
         updated_at=NOW()
       RETURNING *`,
      [journey_id, name, step_number, description || null, status || 'planned', promise || null, backbone_version || null]
    );
```

- [ ] **Step 4: 跑单测通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
Expected: PASS

- [ ] **Step 5: 写集成测试（真 pg 走路由 SQL）**

```js
// packages/brain/src/__tests__/integration/blast-radius.integration.test.js
import { describe, it, expect, beforeAll } from 'vitest';
let pool;
const CRM = '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2';

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

describe('blast-radius 查询（348 seed 数据上）', () => {
  it('CRM 表底座引用 4 步且 promise 全非空', async () => {
    const { rows } = await pool.query(
      `SELECT s.promise, l.cell_status
       FROM journey_step_links l
       JOIN journey_steps s ON s.id=l.step_id
       WHERE l.feature_id=$1 AND l.cell_kind='base_ref'`, [CRM]);
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.promise && r.cell_status)).toBe(true);
  });

  it('无引用 feature 返回空（count=0 语义）', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM journey_step_links WHERE feature_id='d831dd0f-893c-49b6-8857-07756f5a7030' AND cell_kind='base_ref'`);
    expect(rows.length).toBe(1); // 画像卡恰 1 处引用（B·S2）
  });
});
```

Run: `cd packages/brain && DB_NAME=cecelia_scratch npx vitest run src/__tests__/integration/blast-radius.integration.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/routes/journeys.js packages/brain/src/routes/__tests__/journeys.test.js packages/brain/src/__tests__/integration/blast-radius.integration.test.js
git commit -m "feat(brain/api): blast-radius 端点 + mapper 落账字段白名单（journeys PATCH/steps promise/features softness/links cell） [c93b3def]"
```

---

### Task 6: selfcheck/DEFINITION/版本 bump + DevGate + 全量回归

**Files:**
- Modify: `packages/brain/src/selfcheck.js:28`（'346'→'348'）
- Modify: `DEFINITION.md`（「Brain 版本」行 + 「Schema 版本: 346」行）
- Modify: `packages/brain/package.json` + `packages/brain/package-lock.json`（1.263.3→1.264.0）
- Modify: `.brain-versions`（追加 1.264.0）
- Create: `docs/learnings/cp-07171620-mj5-knife1-ledger.md`

- [ ] **Step 1: 版本四件套**

```bash
cd packages/brain && npm version 1.264.0 --no-git-tag-version && cd ../..
# .brain-versions 追加一行 1.264.0（看文件尾格式照抄）
# DEFINITION.md: 「Brain 版本」1.263.3→1.264.0；「Schema 版本: 346」→348
# selfcheck.js:28: EXPECTED_SCHEMA_VERSION '346'→'348'
```

- [ ] **Step 2: DevGate 三连**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全 PASS（facts-check 会校验 DEFINITION.md schema/版本行与代码一致）

- [ ] **Step 3: Learning 文档**（Engine 规范：含 `### 根本原因`+`### 下次预防`+`- [ ]`）

```markdown
# Learning: MJ5 刀1 账本落库

### 根本原因
承诺地图只存在于 artifact 页面，机器不可读：journeys/journey_steps/journey_step_links 缺 home/promise/格子维度，导致锚点闸（刀2）与联动清单（刀3）无账可查。

### 下次预防
- [ ] 删 UNIQUE 约束前全仓 grep `ON CONFLICT`——本刀 journeys.js:352 若不同步改，生产 POST 必 500（对抗审查抓获）
- [ ] 给 journey_step_links 之类同步表加行为时，先查 notion-push-sync 的 WHERE 是否会放行新行
- [ ] seed migration 必须空库自足+固定 UUID 幂等（CI brain-integration 空库全量跑 migrate）
```

- [ ] **Step 4: 全量单测回归**

```bash
cd packages/brain && npx vitest run --exclude 'src/__tests__/integration/**'
```
Expected: 全 PASS（注意 vitest OOM 历史：如挂用 `--pool=forks --poolOptions.forks.maxForks=2` 重跑）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md packages/brain/src/selfcheck.js docs/learnings/cp-07171620-mj5-knife1-ledger.md
git commit -m "chore(brain): bump 1.264.0 + schema 348 + DEFINITION 同步 + learning [c93b3def]"
```

---

## Self-Review 已做

- Spec 覆盖：§3→Task1；§5.1→Task2；§5.2→Task3；§4→Task4；§5.3/5.4/§6→Task5；§5.5→Task6；§7 测试策略→各 Task 内嵌。spec §4.1 与 Task4 VALUES 一致（画像卡 base_ref、Agent 底座 E/F·S1、记忆库 B·S3 按全景池引用列补齐——比 spec 表述更全，以全景图池"被谁引用"列为准）。
- 占位符：无 TBD；Task3 测试给了两种落点由执行者按现有文件结构择一（断言目标唯一）。
- 类型一致：UUID 表全文统一；cell_kind/cell_status 枚举三处（347 CHECK/路由校验/seed）一致。
