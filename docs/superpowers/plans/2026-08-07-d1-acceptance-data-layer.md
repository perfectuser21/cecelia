# D1 · 验收一体两面数据层地基与状态机 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给「一张表两列背靠背」建好数据层地基——AI 四列真实落库、格号从流水号改成规程格号、run 生命周期从 4 值扩到 7 值、格级判定与 run 级状态彻底分离、并交付一台把规程 yaml 变成 36 行验收单的生成器。

**Architecture:** 一支 migration（392）同批完成结构改动（AI 四列 + `acceptance_runs.detail` + 7 值 CHECK + `UNIQUE (run_id, check_key)`），并与 `routes/acceptance.js:86` 的三元式替换放在**同一个 commit**；纯计算下沉到两个零 IO 模块——`src/acceptance-state.js`（格级 `computeCellState` / run 级 `computeGateVerdict` / 状态机 `computeRunStatus` / 哑火 `computeAiStatus`）与 `src/acceptance-spec.js`（yaml 解析与静态属性派生），路由只做入参校验、事务与落库。所有涉及「AI 可判格数」的数字一律从 yaml 解析取数，代码里不出现 36/19/17/5 这些常量。

**Tech Stack:** Node.js ESM、Express、PostgreSQL（pg）、vitest（单测 + 真 PG 集成测试）、js-yaml。

**开工前置（每个 Task 的实现步之前都适用）：** 改 `packages/brain` 必过 DevGate 三件套 —
`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`。
**本地跑任何测试一律 `DB_NAME=cecelia_scratch`，禁止连生产 `cecelia` 库。**

**依赖顺序（据 spec「关键依赖」节）：**

```
Task 1 (migration 392 + 状态机，同 commit)
   ├─→ Task 2 (格级 final_state) ─→ Task 3 (gate_verdict + 哑火)
   ├─→ Task 4 (check_key 格号化 + run_id 作用域)
   ├─→ Task 9/10/11/12 (生命周期)
   └─→ Task 13 (版本戳与冻结锁)
Task 5 (zenithjoy yaml) ─→ Task 6 (生成器) ─┬─→ Task 7 (reason 校验)
                                            └─→ Task 8 (推进闸)
Task 14 (版本 bump + DevGate) → Task 15 (DoD)
```

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/brain/migrations/392_acceptance_two_column.sql`（新建） | up：AI 四列 + `runs.detail` + 7 值 CHECK + UNIQUE 换绑 |
| `packages/brain/migrations/rollback/392_acceptance_two_column.down.sql`（新建） | down：逆序回滚 + 跨 run 重复 `check_key` 时 fail-fast。**放 `rollback/` 子目录**——`src/migrate.js:47` 只 `readdirSync` 顶层且按文件名排序，同目录下 `…down.sql` 会排在 `…sql` 前面被当成 392 抢先执行，且 `facts-check.mjs` 的重复编号检查会当场报错 |
| `packages/brain/src/acceptance-state.js`（新建） | 纯函数：`computeCellState` / `computeGateVerdict` / `computeRunStatus` / `computeAiStatus`，零 DB 依赖 |
| `packages/brain/src/acceptance-spec.js`（新建） | yaml 解析：`loadSpec` / `buildCells` / `deriveSets` / `computeSpecSha`。路由与生成器共用，避免生成器落在 `scripts/` 导致路由反向 import |
| `packages/brain/scripts/acceptance/build-checks-from-spec.mjs`（新建） | 生成器 CLI + `buildChecksFromSpec()` 纯函数导出，内部调 `acceptance-spec.js` |
| `packages/brain/src/routes/acceptance.js`（改） | 建单/收单/生命周期端点，只做校验、事务、落库 |
| `packages/brain/src/acceptance-aging.js`（改） | 既有 48h 哨兵**加厚**成状态转移（→`expired`），不新建平行 job |
| `packages/brain/src/selfcheck.js:28`（改） | `EXPECTED_SCHEMA_VERSION` 391 → 392 |
| `packages/brain/src/__tests__/fixtures/acceptance/line02-android.yaml`（新建） | Task 5 合并后的 yaml 副本，供单测使用（CI 里没有 zenithjoy repo） |

---

### Task 1: migration 392 + run 状态机替换（**必须同一个实现 commit**）

spec「关键依赖」节写死：`acceptance.js:86` 的三元式与 CHECK 扩容拆开会造出「CHECK 已扩、代码还写 `failed`」的中间态——员工判出不通过的那一轮永远达不到 `human_complete`，而合看页/裁决/回显全部以它为开门条件。所以本 Task 的实现步是一个 commit。

**Files:**
- Create: `packages/brain/migrations/392_acceptance_two_column.sql`
- Create: `packages/brain/migrations/rollback/392_acceptance_two_column.down.sql`
- Create: `packages/brain/src/acceptance-state.js`
- Modify: `packages/brain/src/routes/acceptance.js:84-99`
- Modify: `packages/brain/src/selfcheck.js:28`
- Modify: `packages/brain/vitest.config.js`（把两个新集成测试加进 `POSTGRES_INTEGRATION_TESTS`）
- Test: `packages/brain/src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js`
- Test: `packages/brain/src/__tests__/integration/acceptance-state-machine.integration.test.js`
- Test: `packages/brain/src/__tests__/acceptance-run-status.test.js`

- [x] **Step 1: 写 failing 单测（run 状态机，A10⑤ 的纯函数层）**

新建 `packages/brain/src/__tests__/acceptance-run-status.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { computeRunStatus, RUN_STATUSES, ACTIVE_RUN_STATUSES } from '../acceptance-state.js';

describe('computeRunStatus — 7 值状态机（只看人列填写进度）', () => {
  it('人列一格未填 → pending', () => {
    expect(computeRunStatus('pending', { total: 36, humanFilled: 0 })).toBe('pending');
  });

  it('人列填了一部分 → in_review', () => {
    expect(computeRunStatus('pending', { total: 36, humanFilled: 12 })).toBe('in_review');
  });

  it('A10⑤-a 人列填满且含「不通过」→ human_complete，绝不能是 failed', () => {
    // humanFilled 只数「非 NULL」，与取值无关：这正是旧三元式判错的地方
    expect(computeRunStatus('in_review', { total: 36, humanFilled: 36 })).toBe('human_complete');
  });

  it('A10⑤-b 人列全通过 → 同样是 human_complete，不是 passed', () => {
    expect(computeRunStatus('in_review', { total: 36, humanFilled: 36 })).toBe('human_complete');
  });

  it('非活跃前态不被提交路径改回去', () => {
    for (const prev of ['human_complete', 'adjudicated', 'stale', 'expired', 'abandoned']) {
      expect(computeRunStatus(prev, { total: 36, humanFilled: 36 })).toBe(prev);
      expect(computeRunStatus(prev, { total: 36, humanFilled: 0 })).toBe(prev);
    }
  });

  it('computeRunStatus 在任何输入下都不产生 passed/failed（历史兼容值只读）', () => {
    for (let filled = 0; filled <= 36; filled++) {
      for (const prev of ACTIVE_RUN_STATUSES) {
        expect(['passed', 'failed']).not.toContain(computeRunStatus(prev, { total: 36, humanFilled: filled }));
      }
    }
  });

  it('RUN_STATUSES 恰为 7 个活跃/终态值，passed/failed 不在其中', () => {
    expect(RUN_STATUSES).toEqual([
      'pending', 'in_review', 'human_complete', 'adjudicated', 'stale', 'expired', 'abandoned',
    ]);
    expect(ACTIVE_RUN_STATUSES).toEqual(['pending', 'in_review']);
  });
});
```

- [x] **Step 2: 写 failing 集成测试（migration 结构 + down 可逆性）**

新建 `packages/brain/src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js`：

```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, afterAll } from 'vitest';
import pool from '../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWN_SQL = fs.readFileSync(
  path.join(__dirname, '../../../migrations/rollback/392_acceptance_two_column.down.sql'),
  'utf-8'
);

async function columnsOf(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
    [table]
  );
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

describe('migration 392 结构断言', () => {
  afterAll(async () => { await pool.end(); });

  it('acceptance_checks 有 AI 四列且全部 nullable', async () => {
    const cols = await columnsOf('acceptance_checks');
    expect(cols.get('ai_verdict')).toBe('text');
    expect(cols.get('ai_evidence')).toBe('jsonb');
    expect(cols.get('ai_run_at')).toBe('timestamp with time zone');
    expect(cols.get('adjudication')).toBe('jsonb');

    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='acceptance_checks'
         AND column_name IN ('ai_verdict','ai_evidence','ai_run_at','adjudication')
         AND is_nullable='NO'`
    );
    expect(rows).toHaveLength(0); // ai_verdict IS NULL 是 Q0′ 的机械载体，不能有 NOT NULL/默认值
  });

  it('acceptance_runs 有 detail jsonb 列（补 v7-final 断言 A9/A10/A12/A15/A16 的读取路径）', async () => {
    const cols = await columnsOf('acceptance_runs');
    expect(cols.get('detail')).toBe('jsonb');
  });

  it('A10① status CHECK 含全部 7 值 + 2 个历史兼容值', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'acceptance_runs_status_check'`
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].def;
    for (const v of ['pending','in_review','human_complete','adjudicated','stale','expired','abandoned','passed','failed']) {
      expect(def).toContain(`'${v}'`);
    }
  });

  it('ai_verdict CHECK 是中文三值枚举', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'acceptance_checks_ai_verdict_check'`
    );
    expect(rows).toHaveLength(1);
    for (const v of ['通过', '不通过', '无法验证']) expect(rows[0].def).toContain(v);
  });

  it('J5-A UNIQUE 从全局 check_key 换绑到 (run_id, check_key)', async () => {
    const { rows } = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'acceptance_checks'::regclass AND contype = 'u'`
    );
    const names = rows.map((r) => r.conname);
    expect(names).toContain('uq_acceptance_checks_run_key');
    expect(names).not.toContain('acceptance_checks_check_key_key');
    const def = rows.find((r) => r.conname === 'uq_acceptance_checks_run_key').def;
    expect(def).toMatch(/UNIQUE \(run_id, check_key\)/);
  });

  it('down 在无跨 run 重复格号时完全可逆（事务内跑完即回滚，不动测试库）', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM acceptance_checks WHERE check_key IN (
        SELECT check_key FROM acceptance_checks GROUP BY check_key HAVING count(*) > 1)`);
      await client.query(DOWN_SQL);
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='acceptance_checks' AND column_name='ai_verdict'`
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('down 在已有新格号跨 run 重复时 fail-fast 报错，不静默丢数据', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mk = async (key) => {
        const { rows } = await client.query(
          `INSERT INTO acceptance_runs (run_key, title) VALUES ($1, 'down-guard') RETURNING id`, [key]
        );
        await client.query(
          `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1, 'S3-c1', 'FR', 'x')`,
          [rows[0].id]
        );
      };
      await mk(`down-guard-a-${process.pid}`);
      await mk(`down-guard-b-${process.pid}`);
      await expect(client.query(DOWN_SQL)).rejects.toThrow(/不可回滚/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
```

- [x] **Step 3: 写 failing 集成测试（A10⑤ 端到端走真库）**

新建 `packages/brain/src/__tests__/integration/acceptance-state-machine.integration.test.js`：

```js
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import pool from '../../db.js';
import { submitAcceptanceResults } from '../../routes/acceptance.js';

const RUN_KEY = `sm-itest-${process.pid}`;
const MIGRATION_AT = '2026-08-07T00:00:00Z';

async function seedRun(total) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, gp_id) VALUES ($1, '状态机回归', '7790f728') RETURNING id`,
    [RUN_KEY]
  );
  const runId = rows[0].id;
  for (let i = 1; i <= total; i++) {
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1, $2, 'FR', $3)`,
      [runId, `S${i}-c1`, `格 ${i}`]
    );
  }
  return runId;
}

describe('A10⑤ 人列填满即 human_complete（本刀最重要的回归测试，永不删除）', () => {
  beforeEach(async () => { await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]); });
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('⑤-a 人列填满且含「不通过」→ human_complete，不是 failed', async () => {
    await seedRun(3);
    await submitAcceptanceResults(pool, [
      { check_key: 'S1-c1', result: '通过' },
      { check_key: 'S2-c1', result: '不通过', note: '挂了' },
      { check_key: 'S3-c1', result: '通过' },
    ], { run_key: RUN_KEY });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('human_complete');
  });

  it('⑤-b 人列全「通过」→ 同样是 human_complete，不是 passed', async () => {
    await seedRun(2);
    await submitAcceptanceResults(pool, [
      { check_key: 'S1-c1', result: '通过' },
      { check_key: 'S2-c1', result: '通过' },
    ], { run_key: RUN_KEY });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('human_complete');
  });

  it('人列部分填写 → in_review', async () => {
    await seedRun(3);
    await submitAcceptanceResults(pool, [{ check_key: 'S1-c1', result: '通过' }], { run_key: RUN_KEY });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('in_review');
  });

  it('⑤-c migration 之后新建的 run 全表不存在 passed/failed', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM acceptance_runs
       WHERE status IN ('passed','failed') AND created_at > $1`, [MIGRATION_AT]
    );
    expect(rows[0].n).toBe(0);
  });
});
```

- [x] **Step 4: 跑测试确认全红**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-run-status.test.js
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js \
  src/__tests__/integration/acceptance-state-machine.integration.test.js
```

预期：单测报 `Failed to load url ../acceptance-state.js`；集成测试报 rollback 文件不存在 / 列不存在。

- [x] **Step 5: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/acceptance-run-status.test.js \
        packages/brain/src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js \
        packages/brain/src/__tests__/integration/acceptance-state-machine.integration.test.js
git commit -m "test(acceptance): D1 migration 392 结构与 7 值状态机 failing test [task b35bfa0c]"
```

- [x] **Step 6: 写 migration 392 up**

新建 `packages/brain/migrations/392_acceptance_two_column.sql`：

```sql
-- Migration 392: 验收一体两面数据层地基（D1，GP 7790f728，决策 fdeb48aa/8640ef58）
-- 四件结构改动合成一支：CHECK 扩容与 routes/acceptance.js 的 run 状态计算必须同批上线，
-- 拆开会制造「CHECK 已扩、代码仍写 failed」的中间态窗口。
-- 回滚脚本在 migrations/rollback/392_acceptance_two_column.down.sql（不放本目录：
-- migrate.js 按文件名排序会让 *.down.sql 抢在 *.sql 之前执行）。

-- 1. AI 四列（J6-A）。全部 nullable：ai_verdict IS NULL 是 Q0′「AI 列缺格」的机械载体，
--    也是哑火判据条件③ 的取数口径，给默认值会让「没跑」和「跑了没结论」不可区分。
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS ai_verdict TEXT;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS ai_evidence JSONB;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS ai_run_at TIMESTAMPTZ;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS adjudication JSONB;

ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS acceptance_checks_ai_verdict_check;
ALTER TABLE acceptance_checks ADD CONSTRAINT acceptance_checks_ai_verdict_check
  CHECK (ai_verdict IS NULL OR ai_verdict IN ('通过','不通过','无法验证'));

-- 2. acceptance_runs.detail：承载单头全部可变附属信息（backend_sha/frontend_sha/spec_sha、
--    tenant_account/device_model/scenarios_observed[]、ai_status/ai_incomplete、
--    abandoned_*、review_closed_*/review_acks[]、force_*、bypass_used、unverifiable_adjudicated[]）。
--    不给子键建独立列——它们不是查询主键；A2 的读侧裁剪按列白名单做，detail 整列默认不出现。
ALTER TABLE acceptance_runs ADD COLUMN IF NOT EXISTS detail JSONB;

-- 3. 状态机 4 值 → 7 值 + 2 个只读历史兼容值。
--    三个非活跃终态（stale/expired/abandoned）是 status 取值，不是 detail 旗标（A10④）。
--    passed/failed 保留在 CHECK 里仅为兼容存量行，新 run 永不产生（A10⑤-c 断言）。
ALTER TABLE acceptance_runs DROP CONSTRAINT IF EXISTS acceptance_runs_status_check;
ALTER TABLE acceptance_runs ADD CONSTRAINT acceptance_runs_status_check
  CHECK (status IN ('pending','in_review','human_complete','adjudicated',
                    'stale','expired','abandoned',
                    'passed','failed'));

-- 4. UNIQUE 换绑（J5-A）：全局 check_key 唯一 → run 内唯一，让同 gp 第二轮 run 的 S3-c1
--    不再撞 23505。存量 21 行（旧 {run_key}:{NNN} 流水号格式）在新约束下天然成立，
--    无需回填/改写/删除——强行映射成 S{n}-c{m} 等于伪造历史判定记录。
--    也不给 check_key 加格式 CHECK：会当场挡死这 21 行；格号规范由建单生成器在写入侧保证。
ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS acceptance_checks_check_key_key;
ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS uq_acceptance_checks_run_key;
ALTER TABLE acceptance_checks ADD CONSTRAINT uq_acceptance_checks_run_key
  UNIQUE (run_id, check_key);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('392', 'acceptance two-column data layer: AI columns + runs.detail + 7-value status + per-run check_key unique', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [x] **Step 7: 写 migration 392 down**

新建 `packages/brain/migrations/rollback/392_acceptance_two_column.down.sql`：

```sql
-- Rollback for migration 392（手动执行：psql -f，不被 migrate.js 自动发现）
-- 可逆性边界：尚未建过任何新格号 run 时完全可逆；建过之后 fail-fast 报错并说明清理路径，
-- 不静默丢数据。恢复全局 UNIQUE (check_key) 在新格号数据存在时物理不可能——
-- 第二轮 run 的 S3-c1 与第一轮的 S3-c1 必然重复，这正是 J5-A 要解决的原问题。

DO $$
DECLARE dup int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT check_key FROM acceptance_checks GROUP BY check_key HAVING count(*) > 1
  ) t;
  IF dup > 0 THEN
    RAISE EXCEPTION '不可回滚：已存在 % 个跨 run 重复的 check_key（新格号数据）。回滚前须先清理这些 run，否则全局 UNIQUE 无法重建', dup;
  END IF;
END $$;

ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS uq_acceptance_checks_run_key;
ALTER TABLE acceptance_checks ADD CONSTRAINT acceptance_checks_check_key_key UNIQUE (check_key);

ALTER TABLE acceptance_runs DROP CONSTRAINT IF EXISTS acceptance_runs_status_check;
ALTER TABLE acceptance_runs ADD CONSTRAINT acceptance_runs_status_check
  CHECK (status IN ('pending','in_review','passed','failed'));

ALTER TABLE acceptance_runs DROP COLUMN IF EXISTS detail;

ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS acceptance_checks_ai_verdict_check;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS adjudication;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS ai_run_at;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS ai_evidence;
ALTER TABLE acceptance_checks DROP COLUMN IF EXISTS ai_verdict;

DELETE FROM schema_version WHERE version = '392';
```

- [x] **Step 8: 写 `acceptance-state.js` 的状态机段**

新建 `packages/brain/src/acceptance-state.js`：

```js
/**
 * acceptance-state.js — 验收一体两面的纯计算层（D1，零 DB 依赖）
 *
 * 三段互不推导的计算，v7-final 明写「两者不得共用同一个动词或同一段计算」：
 *   1. 格级 final_state（作用域 = 单个格，九组合矩阵）      → computeCellState
 *   2. run 级 gate_verdict（作用域 = 整个 run，但不是 status）→ computeGateVerdict
 *   3. run 级 status（7 值状态机，只看人列填写进度）         → computeRunStatus
 */

/** 7 值状态机的全集；passed/failed 是只读历史兼容值，不在其中 */
export const RUN_STATUSES = [
  'pending', 'in_review', 'human_complete', 'adjudicated', 'stale', 'expired', 'abandoned',
];

/** 只有这两个状态会被「提交人列结果」这条路径改写 */
export const ACTIVE_RUN_STATUSES = ['pending', 'in_review'];

/**
 * run 级 status：只看人列填写进度，不看 AI 列、不看 final_state。
 * human_complete 的判据是人列全部非 NULL，与「其中有几格不通过」无关——
 * 旧三元式只要有一格不通过就写 failed，而合看页/裁决/员工回显都以 human_complete
 * 为开门条件，于是「员工判出不通过的那一轮」永远打不开后续流程（A10⑤ 堵的就是这个洞）。
 */
export function computeRunStatus(prevStatus, { total, humanFilled }) {
  // 非活跃终态由各自的显式转移路径设置（human_complete→adjudicated 走裁决；*→stale 走冻结锁；
  // pending→expired 走 48h 扫描；*→abandoned 走作废端点），提交人列这条路径不得把它们改回去
  if (!ACTIVE_RUN_STATUSES.includes(prevStatus)) return prevStatus;
  if (humanFilled === 0) return 'pending';
  if (humanFilled < total) return 'in_review';
  return 'human_complete';
}
```

- [x] **Step 9: 替换 `routes/acceptance.js:84-99` 的三元式**

把 `packages/brain/src/routes/acceptance.js` 第 84-99 行整段：

```js
      const { total, pass, fail, pending } = counts[0];
      const passRate = total > 0 ? pass / total : 0;
      const status = pending > 0 ? 'in_review' : fail > 0 ? 'failed' : pass === total ? 'passed' : 'in_review';
      const { rows: prevRows } = await client.query(
        'SELECT status, title, gp_id, run_key FROM acceptance_runs WHERE id = $1',
        [runId]
      );
      const prev = prevRows[0];
```

替换为：

```js
      const { total, pass, pending } = counts[0];
      const passRate = total > 0 ? pass / total : 0;
      const { rows: prevRows } = await client.query(
        'SELECT status, title, gp_id, run_key FROM acceptance_runs WHERE id = $1',
        [runId]
      );
      const prev = prevRows[0];
      // run 级 status 独立走 7 值状态机，不由格级判定推导（格级判定见 computeCellState）
      const status = computeRunStatus(prev?.status, { total, humanFilled: total - pending });
```

并在 `packages/brain/src/routes/acceptance.js:8` 的 import 段后加：

```js
import { computeRunStatus } from '../acceptance-state.js';
```

- [x] **Step 10: 把驳回建任务段显式标注为历史路径**

把 `routes/acceptance.js:99` 的条件行：

```js
      if (prev && prev.status !== 'failed' && status === 'failed') {
```

替换为：

```js
      // 新状态机永不产生 failed（computeRunStatus 的全集是 RUN_STATUSES），这段只对
      // migration 392 之前落库的历史 failed run 生效。分流建任务由 D4 的聚合式分流接管，
      // 届时整段删除。此处显式命名而不是留一个恒不触发的裸条件——「看起来在工作、实际
      // 恒不触发」的代码就是 P2-8 记的棘轮静默击穿。
      if (prev && isLegacyRejectionTransition(prev.status, status)) {
```

并在 `routes/acceptance.js` 的 `submitAcceptanceResults` 之前（第 24 行 `}` 之后）加入：

```js
/** 仅覆盖 migration 392 之前的历史 failed run；新状态机不产生 failed，D4 接管后删除 */
function isLegacyRejectionTransition(prevStatus, nextStatus) {
  return prevStatus !== 'failed' && nextStatus === 'failed';
}
```

- [x] **Step 11: bump `EXPECTED_SCHEMA_VERSION`**

`packages/brain/src/selfcheck.js:28`：

```js
export const EXPECTED_SCHEMA_VERSION = '392';
```

理由：`scripts/facts-check.mjs:284-297` 强校验它等于 `migrations/` 的最高编号，不同批 bump 会当场卡住 DevGate。

- [x] **Step 12: 把两个新集成测试登记进 `POSTGRES_INTEGRATION_TESTS`**

`packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 数组里，`'src/__tests__/integration/acceptance.integration.test.js',` 这一行后面插入：

```js
  'src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js',
  'src/__tests__/integration/acceptance-state-machine.integration.test.js',
```

不登记的后果：brain-unit job 会加载它们并因无 DB 连接报红。

- [x] **Step 13: 跑 migration 并验证全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch node src/migrate.js
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-run-status.test.js
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js \
  src/__tests__/integration/acceptance-state-machine.integration.test.js
```

预期：`[APPLY] 392_acceptance_two_column.sql` → `[DONE]`；三个测试文件全 PASS。

- [x] **Step 14: 在带 21 行存量数据的库上验 migration（档 1 E2E）**

上面跑的 scratch 库是空表，证不了「存量 21 行不冲突」。把生产库的结构+数据 dump 进 scratch 再跑一次：

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
pg_dump -d cecelia -t acceptance_runs -t acceptance_checks --data-only \
  > /private/tmp/claude-501/acceptance-prod-data.sql
psql -d cecelia_scratch -c "DELETE FROM schema_version WHERE version='392'"
psql -d cecelia_scratch -c "TRUNCATE acceptance_checks, acceptance_runs CASCADE"
psql -d cecelia_scratch -f /private/tmp/claude-501/acceptance-prod-data.sql
psql -d cecelia_scratch -c "SELECT count(*) AS checks FROM acceptance_checks;
                            SELECT count(*) AS runs FROM acceptance_runs;"
cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js
psql -d cecelia_scratch -c "\d acceptance_runs"
psql -d cecelia_scratch -c "\d acceptance_checks"
```

预期：`checks = 21`、`runs = 2`；migrate 成功（`ADD CONSTRAINT UNIQUE (run_id, check_key)` 对旧 `{run_key}:{NNN}` 流水号天然成立，不需要任何数据清洗）；`\d` 输出里能看到 AI 四列、`detail`、`uq_acceptance_checks_run_key`、7 值 CHECK。dump 只读生产库，**全程不对 `cecelia` 跑 migrate**。

- [x] **Step 15: 跑 DevGate 并提交 Green commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
node scripts/facts-check.mjs
node --check packages/brain/src/routes/acceptance.js
node --check packages/brain/src/acceptance-state.js
git add packages/brain/migrations/392_acceptance_two_column.sql \
        packages/brain/migrations/rollback/392_acceptance_two_column.down.sql \
        packages/brain/src/acceptance-state.js \
        packages/brain/src/routes/acceptance.js \
        packages/brain/src/selfcheck.js \
        packages/brain/vitest.config.js
git commit -m "feat(acceptance): migration 392 + run 7 值状态机同批替换 [task b35bfa0c]"
```

---

### Task 2: 格级判定 `computeCellState`（九组合矩阵）

**Files:**
- Modify: `packages/brain/src/acceptance-state.js`（追加格级段）
- Test: `packages/brain/src/__tests__/acceptance-cell-state.test.js`

- [x] **Step 1: 写 failing 单测（A5 九组合矩阵逐行对表）**

新建 `packages/brain/src/__tests__/acceptance-cell-state.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { computeCellState } from '../acceptance-state.js';

/** 默认是一个合法可人判的普通格（S12-c1 那种） */
const base = { verifiable_by: 'human_only', scenario_class: null, adjudication: null };
const st = (o) => computeCellState({ ...base, ...o }).final_state;

describe('A5 九组合矩阵', () => {
  it('Q1 双绿 → 绿', () => {
    expect(st({ result: '通过', ai_verdict: '通过' })).toBe('绿');
  });

  it('Q2 人绿 AI 红 → 未定', () => {
    expect(st({ result: '通过', ai_verdict: '不通过' })).toBe('未定');
  });

  it('Q3 合法无法验证（human_only 格）+ 人列通过 → 绿', () => {
    expect(st({ result: '通过', ai_verdict: '无法验证', verifiable_by: 'human_only' })).toBe('绿');
  });

  it('Q3′ 故障无法验证（machine_db 格）+ 人列通过 → 未定', () => {
    expect(st({ result: '通过', ai_verdict: '无法验证', verifiable_by: 'machine_db' })).toBe('未定');
  });

  it('Q4 人红 AI 绿 → 未定', () => {
    expect(st({ result: '不通过', ai_verdict: '通过' })).toBe('未定');
  });

  it('Q5 双红 → 红', () => {
    expect(st({ result: '不通过', ai_verdict: '不通过' })).toBe('红');
  });

  it('Q6 人红 + AI 无法验证 → 红（人红独判）', () => {
    expect(st({ result: '不通过', ai_verdict: '无法验证' })).toBe('红');
    expect(st({ result: '不通过', ai_verdict: '无法验证', verifiable_by: 'machine_db' })).toBe('红');
  });

  it('Q7 人无法验证 + AI 通过 → 未定', () => {
    expect(st({ result: '无法验证', ai_verdict: '通过' })).toBe('未定');
  });

  it('Q8 人无法验证 + AI 不通过 → 红', () => {
    expect(st({ result: '无法验证', ai_verdict: '不通过' })).toBe('红');
  });

  it('Q9 双盲 → 未定', () => {
    expect(st({ result: '无法验证', ai_verdict: '无法验证' })).toBe('未定');
  });

  it('Q0 人列未填 + AI 有结论 → 未定', () => {
    expect(st({ result: null, ai_verdict: '通过' })).toBe('未定');
  });
});

describe('Q0′ AI 缺格恒判未定（优先级最高，读人列之前就短路）', () => {
  for (const result of ['通过', '不通过', '无法验证']) {
    it(`人列「${result}」+ AI 列 NULL → 未定`, () => {
      expect(st({ result, ai_verdict: null })).toBe('未定');
    });
  }
});

describe('unverifiable_this_version（本版 = S13-c4）绿只能来自裁决', () => {
  const cell = { verifiable_by: 'human_only', scenario_class: 'unverifiable_this_version' };

  it('A17⑤ 无裁决时双绿也不判绿', () => {
    expect(st({ ...cell, result: '通过', ai_verdict: '通过' })).toBe('未定');
  });

  it('A17⑤ 无裁决时不走 Q3 绿通道', () => {
    expect(st({ ...cell, result: '通过', ai_verdict: '无法验证' })).toBe('未定');
  });

  it('红判定不受影响（双红仍是红）', () => {
    expect(st({ ...cell, result: '不通过', ai_verdict: '不通过' })).toBe('红');
  });

  it('A17⑤ 有裁决 verdict=绿 且 by/reason/at 齐全 → 绿', () => {
    expect(st({
      ...cell, result: '无法验证', ai_verdict: null,
      adjudication: { verdict: '绿', by: 'alex', reason: '频控红线本版不自动验，人判放行', at: '2026-08-07T10:00:00Z' },
    })).toBe('绿');
  });

  it('裁决字段不全（缺 reason）不生效', () => {
    expect(st({
      ...cell, result: '通过', ai_verdict: '通过',
      adjudication: { verdict: '绿', by: 'alex', at: '2026-08-07T10:00:00Z' },
    })).toBe('未定');
  });
});

describe('A17④ Q3 合法通道没被 fail-closed 误伤', () => {
  it('S12-c1（human_only，恒需安卓真机）AI reason=human_only 无法验证 + 人列通过 → 绿', () => {
    expect(computeCellState({
      result: '通过', ai_verdict: '无法验证', adjudication: null,
      verifiable_by: 'human_only', scenario_class: null,
    }).final_state).toBe('绿');
  });
});

describe('裁决判红也生效', () => {
  it('adjudication.verdict=红 → 红', () => {
    expect(st({
      result: '通过', ai_verdict: '通过',
      adjudication: { verdict: '红', by: 'alex', reason: '证据不足', at: '2026-08-07T10:00:00Z' },
    })).toBe('红');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-cell-state.test.js
```

预期：FAIL，`computeCellState is not a function`。

- [x] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/acceptance-cell-state.test.js
git commit -m "test(acceptance): 格级九组合矩阵 failing test [task b35bfa0c]"
```

- [x] **Step 4: 实现 `computeCellState`**

在 `packages/brain/src/acceptance-state.js` 的 `computeRunStatus` 之前插入：

```js
export const CELL_STATES = ['绿', '红', '未定'];

/** 裁决四字段齐全才算数（A6 断言 verdict/by/reason/at 全非空） */
function validAdjudication(adj) {
  return Boolean(adj && adj.verdict && adj.by && adj.reason && adj.at);
}

/**
 * 格级判定（作用域 = 单个格），严格照 v7-final §九组合表，无自由发挥空间。
 *
 * @param {object}  cell
 * @param {string?} cell.result         人列：'通过'|'不通过'|'无法验证'|null（未填）
 * @param {string?} cell.ai_verdict     AI 列：同枚举；null = 未跑（Q0′）
 * @param {object?} cell.adjudication   裁决 {verdict,by,reason,at}
 * @param {string}  cell.verifiable_by  该格 yaml 静态属性：'human_only'|'machine_db'|'machine_visual'
 * @param {string?} cell.scenario_class 'mandatory'|'opportunistic'|'unverifiable_this_version'|null
 * @returns {{ final_state: '绿'|'红'|'未定' }}
 */
export function computeCellState({ result, ai_verdict, adjudication, verifiable_by, scenario_class }) {
  // 裁决是人对该格的最终覆盖，AI 是否跑过与之无关，因此排在 Q0′ 之前。
  // hard 格的唯一逃生阀，也是 unverifiable_this_version 格判绿的唯一来源（A12 棘轮计数它）。
  if (validAdjudication(adjudication)) {
    return { final_state: adjudication.verdict === '绿' ? '绿' : '红' };
  }

  // Q0′ 优先级最高：ai_verdict IS NULL 时在读人列之前就短路。
  // 写成「先算人列再看 AI 是否为空」很容易在「人列通过」分支上漏掉这个短路（A5 三例专测）。
  if (ai_verdict == null) return { final_state: '未定' };

  // Q0：人列未填
  if (result == null) return { final_state: '未定' };

  let state = '未定';
  if (result === '通过') {
    if (ai_verdict === '通过') state = '绿';                                  // Q1
    else if (ai_verdict === '无法验证' && verifiable_by === 'human_only') state = '绿'; // Q3 合法
    // Q2（AI 不通过）与 Q3′（machine_db 格的无法验证 = 故障）留在「未定」
  } else if (result === '不通过') {
    if (ai_verdict === '不通过' || ai_verdict === '无法验证') state = '红';    // Q5 / Q6
    // Q4 留在「未定」
  } else if (result === '无法验证') {
    if (ai_verdict === '不通过') state = '红';                                // Q8
    // Q7 / Q9 留在「未定」
  }

  // 本版判定为「这一版验不了」的格（= S13-c4，频控红线）不走任何绿通道，绿只能来自裁决。
  // 红仍然判红——「验不了」不等于「不许判坏」。
  if (state === '绿' && scenario_class === 'unverifiable_this_version') state = '未定';

  return { final_state: state };
}
```

- [x] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-cell-state.test.js
```

预期：PASS（22 例）。

- [x] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/acceptance-state.js
git commit -m "feat(acceptance): 格级 final_state 九组合矩阵计算 [task b35bfa0c]"
```

---

### Task 3: run 级 `computeGateVerdict` 与哑火判据 `computeAiStatus`

**Files:**
- Modify: `packages/brain/src/acceptance-state.js`（追加 run 级判定段）
- Test: `packages/brain/src/__tests__/acceptance-gate-verdict.test.js`

- [x] **Step 1: 写 failing 单测**

新建 `packages/brain/src/__tests__/acceptance-gate-verdict.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { computeGateVerdict, computeAiStatus } from '../acceptance-state.js';

/** 造 n 个全绿格，其中 hardKeys 里的标 hard */
function cells(n, { hardKeys = [], overrides = {} } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const check_key = `S${i + 1}-c1`;
    return {
      check_key,
      hard: hardKeys.includes(check_key),
      final_state: overrides[check_key] || '绿',
    };
  });
}

describe('computeGateVerdict — 绿当且仅当全格绿', () => {
  it('36 格全绿 → 绿，red_cells 为空', () => {
    const r = computeGateVerdict(cells(36), {});
    expect(r.gate_verdict).toBe('绿');
    expect(r.red_cells).toEqual([]);
    expect(r.blocked_reason).toBeNull();
  });

  it('任一格「未定」→ 红（不是绿）', () => {
    const r = computeGateVerdict(cells(36, { overrides: { 'S9-c1': '未定' } }), {});
    expect(r.gate_verdict).toBe('红');
  });

  it('hard 格非绿 → 红且 red_cells 含该格号', () => {
    const r = computeGateVerdict(
      cells(36, { hardKeys: ['S13-c1'], overrides: { 'S13-c1': '红' } }), {}
    );
    expect(r.gate_verdict).toBe('红');
    expect(r.red_cells).toContain('S13-c1');
  });

  it('hard 格为 Q3′（未定）时不得判绿', () => {
    const r = computeGateVerdict(
      cells(36, { hardKeys: ['S8-c1'], overrides: { 'S8-c1': '未定' } }), {}
    );
    expect(r.gate_verdict).toBe('红');
    expect(r.red_cells).toContain('S8-c1');
  });

  it('run 标 ai_incomplete 时闸一律拦，且与「格红」机械可区分', () => {
    const r = computeGateVerdict(cells(36), { ai_incomplete: true });
    expect(r.gate_verdict).toBe('红');
    expect(r.blocked_reason).toBe('ai_run_infra_error');
    expect(r.red_cells).toEqual([]);
  });
});

describe('computeAiStatus — 哑火三条件（分母与阈值从 yaml 派生，不硬编码）', () => {
  /** machineDbTotal=19 时阈值 = ceil(19/2) = 10；=18 时 = 9（Gate B 回落后的位移） */
  const ok = Array.from({ length: 36 }, (_, i) => ({
    check_key: `S${i + 1}-c1`, ai_verdict: '通过', ai_reason: null, verifiable_by: 'machine_db',
  }));

  it('全部有确定判定 → 不哑火', () => {
    const r = computeAiStatus(ok, { machineDbTotal: 19 });
    expect(r.ai_status).toBe('ok');
    expect(r.ai_incomplete).toBe(false);
  });

  it('条件① 确定判定格数 == 0 → 哑火', () => {
    const cs = ok.map((c) => ({ ...c, ai_verdict: '无法验证', ai_reason: 'timeout' }));
    expect(computeAiStatus(cs, { machineDbTotal: 19 }).ai_status).toBe('dumb');
  });

  it('条件② machine_db 格故障类无法验证达到阈值（19 → 10）→ 哑火', () => {
    const cs = ok.map((c, i) => (i < 10
      ? { ...c, ai_verdict: '无法验证', ai_reason: 'page_unreachable' } : c));
    const r = computeAiStatus(cs, { machineDbTotal: 19 });
    expect(r.ai_status).toBe('dumb');
    expect(r.reasons).toContain('machine_db_failures');
  });

  it('条件② 差一格不到阈值 → 不哑火', () => {
    const cs = ok.map((c, i) => (i < 9
      ? { ...c, ai_verdict: '无法验证', ai_reason: 'page_unreachable' } : c));
    expect(computeAiStatus(cs, { machineDbTotal: 19 }).ai_status).toBe('ok');
  });

  it('分母位移到 18 时阈值随之降到 9（不硬编码 10）', () => {
    const cs = ok.map((c, i) => (i < 9
      ? { ...c, ai_verdict: '无法验证', ai_reason: 'timeout' } : c));
    expect(computeAiStatus(cs, { machineDbTotal: 18 }).ai_status).toBe('dumb');
  });

  it('条件③ 缺格数 > 0 → 哑火', () => {
    const cs = ok.map((c, i) => (i === 5 ? { ...c, ai_verdict: null } : c));
    const r = computeAiStatus(cs, { machineDbTotal: 19 });
    expect(r.ai_status).toBe('dumb');
    expect(r.reasons).toContain('missing_cells');
    expect(r.missing_cells).toEqual(['S6-c1']);
  });

  it('合法 human_only 无法验证不计入条件②（那不是故障）', () => {
    const cs = ok.map((c, i) => (i < 12
      ? { ...c, verifiable_by: 'human_only', ai_verdict: '无法验证', ai_reason: 'human_only' } : c));
    expect(computeAiStatus(cs, { machineDbTotal: 19 }).ai_status).toBe('ok');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-gate-verdict.test.js
```

预期：FAIL，`computeGateVerdict is not a function`。

- [x] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/acceptance-gate-verdict.test.js
git commit -m "test(acceptance): gate_verdict 与哑火判据 failing test [task b35bfa0c]"
```

- [x] **Step 4: 实现两个函数**

在 `packages/brain/src/acceptance-state.js` 的 `computeRunStatus` 之前追加：

```js
/** 故障类 reason：AI 自己没跑成，不是这格本来就机器验不了 */
export const AI_FAILURE_REASONS = ['page_unreachable', 'login_failed', 'timeout'];

/**
 * run 级闸判定（作用域 = 整个 run，但不是 status —— status 只看人列进度）。
 * @param {Array<{check_key:string, hard:boolean, final_state:string}>} cells
 * @param {{ai_incomplete?:boolean}} runDetail
 */
export function computeGateVerdict(cells, runDetail = {}) {
  // AI 跑挂了要和「格判红」机械可区分：前者是基础设施故障，后者是产品缺陷，
  // 混在一起会让一次采证器崩溃看起来像一次真实的验收失败。
  if (runDetail.ai_incomplete) {
    return { gate_verdict: '红', red_cells: [], blocked_reason: 'ai_run_infra_error' };
  }
  const notGreen = cells.filter((c) => c.final_state !== '绿');
  const redCells = notGreen.filter((c) => c.hard || c.final_state === '红').map((c) => c.check_key);
  return {
    gate_verdict: notGreen.length === 0 ? '绿' : '红',
    red_cells: redCells,
    blocked_reason: null,
  };
}

/**
 * 哑火判据三条件（任一成立即 dumb）：
 *   ① 确定判定格数 == 0
 *   ② machine_db 格中故障类无法验证 ≥ ceil(machineDbTotal / 2)
 *      （19 格 → 10，Gate B 第 4 条落档 3 后 18 格 → 9；阈值从分母算，不硬编码）
 *   ③ 缺格数 > 0（ai_verdict IS NULL）
 * @param {Array<{check_key:string, ai_verdict:string?, ai_reason:string?, verifiable_by:string}>} cells
 * @param {{machineDbTotal:number}} opts
 */
export function computeAiStatus(cells, { machineDbTotal }) {
  const decided = cells.filter((c) => c.ai_verdict === '通过' || c.ai_verdict === '不通过').length;
  const missingCells = cells.filter((c) => c.ai_verdict == null).map((c) => c.check_key);
  const machineDbFailures = cells.filter(
    (c) => c.verifiable_by === 'machine_db'
      && c.ai_verdict === '无法验证'
      && AI_FAILURE_REASONS.includes(c.ai_reason)
  ).length;
  const failureThreshold = Math.ceil(machineDbTotal / 2);

  const reasons = [];
  if (decided === 0) reasons.push('no_decided_cells');
  if (machineDbFailures >= failureThreshold) reasons.push('machine_db_failures');
  if (missingCells.length > 0) reasons.push('missing_cells');

  return {
    ai_status: reasons.length > 0 ? 'dumb' : 'ok',
    ai_incomplete: reasons.length > 0,
    reasons,
    missing_cells: missingCells,
    machine_db_failures: machineDbFailures,
    failure_threshold: failureThreshold,
  };
}
```

- [x] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-gate-verdict.test.js
```

预期：PASS（13 例）。

- [x] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/acceptance-state.js
git commit -m "feat(acceptance): run 级 gate_verdict 与哑火判据 [task b35bfa0c]"
```

---

### Task 4: `check_key` 格号化 + `run_id` 作用域全链路

现状核验第 5/6 条：`acceptance.js:52-55` 的 SELECT 与 `:62-67` 的 UPDATE 都只按 `check_key` 匹配，不带 `run_id`；`:215` 用 `${run_key}:${NNN}` 流水号造格号。UNIQUE 换绑成 `(run_id, check_key)` 之后，这两处会跨 run 误写——A3 就是堵这个洞的。

**本 Task 让 `check_key` 成为 `POST /runs` 的必填字段**（格式 `^S\d+-c[1-4]$`），删掉流水号生成。不做「没传就回落到流水号」的静默降级——那正是 spec 反复点名的病。既有 `acceptance.integration.test.js` 依赖旧行为且断言 `status='failed'`，同批改写。

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js:51-68`（run_id 作用域）、`:183-224`（建单 check_key）、`:292-301` 与 `:342-351`（两个 results 端点透传 run_key）
- Modify: `packages/brain/src/__tests__/integration/acceptance.integration.test.js`
- Test: `packages/brain/src/__tests__/integration/acceptance-run-scope.integration.test.js`

- [x] **Step 1: 写 failing 集成测试（A1 + A3）**

新建 `packages/brain/src/__tests__/integration/acceptance-run-scope.integration.test.js`：

```js
import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_A = `scope-a-${process.pid}`;
const RUN_B = `scope-b-${process.pid}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

const CHECKS = [
  { check_key: 'S3-c1', kind: 'FR', name: '权限三项已开启' },
  { check_key: 'S8-c4', kind: 'Invariant', name: '红线4：禁止假编号' },
];

async function cleanup() {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = ANY($1)', [[RUN_A, RUN_B]]);
}

describe('A1/A3 格号作用域', () => {
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('A1 同 gp 两轮 run 用同一批格号建单，第二轮不再 23505', async () => {
    const app = makeApp();
    for (const run_key of [RUN_A, RUN_B]) {
      const res = await request(app).post('/api/brain/acceptance/runs')
        .send({ run_key, title: `两轮 ${run_key}`, gp_id: '7790f728', checks: CHECKS });
      expect(res.status).toBe(201);
      expect(res.body.checks.map((c) => c.check_key)).toEqual(['S3-c1', 'S8-c4']);
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM acceptance_checks c
       JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1 AND c.check_key = 'S3-c1'`, [RUN_A]
    );
    expect(rows[0].n).toBe(1);
  });

  it('A1 格号必须匹配 ^S\\d+-c[1-4]$，旧流水号格式被拒', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/runs')
      .send({ run_key: `${RUN_A}-bad`, title: 'bad', checks: [{ check_key: 'foo:001', kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check_key/);
  });

  it('A1 缺 check_key 直接 400，不回落到流水号', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/runs')
      .send({ run_key: `${RUN_A}-nokey`, title: 'nokey', checks: [{ kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(400);
  });

  it('A3 向 run A 提交 S3-c1 后，run B 的 S3-c1 仍为 NULL（psql 直查不经 API）', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/results')
      .send({ run_key: RUN_A, results: [{ check_key: 'S3-c1', result: '通过' }] });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT r.run_key, c.result FROM acceptance_checks c
       JOIN acceptance_runs r ON r.id = c.run_id
       WHERE c.check_key = 'S3-c1' AND r.run_key = ANY($1) ORDER BY r.run_key`,
      [[RUN_A, RUN_B]]
    );
    expect(rows.find((r) => r.run_key === RUN_A).result).toBe('通过');
    expect(rows.find((r) => r.run_key === RUN_B).result).toBeNull();
  });

  it('缺 run_key 的提交直接 400（不允许无作用域写）', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/results')
      .send({ results: [{ check_key: 'S3-c1', result: '通过' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/run_key/);
  });
});
```

- [x] **Step 2: 登记进 `POSTGRES_INTEGRATION_TESTS` 并跑红**

`packages/brain/vitest.config.js` 的数组里，Task 1 加的两行后面再插入：

```js
  'src/__tests__/integration/acceptance-run-scope.integration.test.js',
```

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-run-scope.integration.test.js
```

预期：FAIL —— 建单返 201 但格号被改写成 `scope-a-NNNN:001`。

- [x] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/integration/acceptance-run-scope.integration.test.js packages/brain/vitest.config.js
git commit -m "test(acceptance): 格号化与 run_id 作用域 failing test [task b35bfa0c]"
```

- [x] **Step 4: 给 `submitAcceptanceResults` 加 `run_key` 作用域**

`packages/brain/src/routes/acceptance.js` 第 25 行签名改为：

```js
export const CHECK_KEY_PATTERN = /^S\d+-c[1-4]$/;

export async function submitAcceptanceResults(pool, results, { run_key } = {}) {
  if (!run_key) {
    throw new AcceptanceResultsError(400, { error: 'run_key is required（写入必须限定在单个 run 作用域内）' });
  }
```

第 51-55 行（`const keys = …` 到 SELECT）替换为：

```js
    const keys = results.map((r) => r.check_key);
    const { rows: runRows } = await client.query(
      'SELECT id FROM acceptance_runs WHERE run_key = $1', [run_key]
    );
    if (runRows.length === 0) {
      await safeRollback(client);
      throw new AcceptanceResultsError(404, { error: 'run not found', run_key });
    }
    const scopedRunId = runRows[0].id;
    const { rows: found } = await client.query(
      'SELECT check_key, run_id FROM acceptance_checks WHERE run_id = $1 AND check_key = ANY($2)',
      [scopedRunId, keys]
    );
```

第 62-68 行的 UPDATE 循环替换为：

```js
    for (const r of results) {
      await client.query(
        `UPDATE acceptance_checks SET result = $1, note = $2, submitted_by = $3, decided_at = NOW(), updated_at = NOW()
         WHERE run_id = $4 AND check_key = $5`,
        [r.result, r.note || null, r.submitted_by || null, scopedRunId, r.check_key]
      );
    }
```

- [x] **Step 5: 两个 results 端点透传 `run_key`**

`routes/acceptance.js:294`（内网）与 `:344`（公网）两处的调用同样改：

```js
      const result = await submitAcceptanceResults(pool, req.body?.results, { run_key: req.body?.run_key });
```

- [x] **Step 6: 建单改用调用方给的格号**

`routes/acceptance.js:189-194` 的 checks 校验循环追加格号校验：

```js
    for (const [i, c] of checks.entries()) {
      if (!c || !c.name) return res.status(400).json({ error: `checks[${i}].name is required` });
      if (!c.check_key || !CHECK_KEY_PATTERN.test(c.check_key)) {
        return res.status(400).json({ error: `checks[${i}].check_key must match ^S\\d+-c[1-4]$（规程格号，由建单生成器产出）` });
      }
      if (!ACCEPTANCE_KINDS.includes(c.kind)) {
        return res.status(400).json({ error: `checks[${i}].kind must be one of: ${ACCEPTANCE_KINDS.join(',')}` });
      }
    }
```

`:213-215` 的插入循环改为（删掉流水号生成那一行）：

```js
      for (const c of checks) {
        const { rows } = await client.query(
          `INSERT INTO acceptance_checks (run_id, check_key, kind, name, device, detail)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [run.id, c.check_key, c.kind, c.name, c.device || null, c.detail ? JSON.stringify(c.detail) : null]
        );
        createdChecks.push(rows[0]);
      }
```

- [x] **Step 7: 同批改写既有集成测试**

`packages/brain/src/__tests__/integration/acceptance.integration.test.js` 第一个用例整体替换（它建单不带 `check_key`、断言 `status='failed'`，两条在新语义下都不再成立）：

```js
  it('建单 → pending 可见 → 回写 results → pass_rate/status 更新', async () => {
    const app = makeApp();

    const create = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY,
      title: 'integration 测试单',
      gp_id: 'customer_smart_acquisition',
      checks: [
        { check_key: 'S1-c1', kind: 'FR', name: 'step1' },
        { check_key: 'S1-c3', kind: 'FR', name: 'step2' },
        { check_key: 'S11-c4', kind: 'Invariant', name: '不向未授权账号发消息' },
      ],
    });
    expect(create.status).toBe(201);
    expect(create.body.checks).toHaveLength(3);

    const again = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY, title: '重复', checks: [{ check_key: 'S1-c1', kind: 'FR', name: 'x' }],
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);

    const pending = await request(app).get('/acceptance/pending');
    expect(pending.status).toBe(200);
    const mine = pending.body.runs.find((r) => r.run_key === RUN_KEY);
    expect(mine.checks).toHaveLength(3);

    const results = await request(app).post('/acceptance/results').send({
      run_key: RUN_KEY,
      results: [
        { check_key: 'S1-c1', result: '通过' },
        { check_key: 'S1-c3', result: '不通过', note: '挂了' },
        { check_key: 'S11-c4', result: '通过' },
      ],
    });
    expect(results.status).toBe(200);
    const updated = results.body.runs.find((r) => r.run_key === RUN_KEY);
    // 人列填满即 human_complete —— 含「不通过」也不落 failed（A10⑤）
    expect(updated.status).toBe('human_complete');
    expect(Number(updated.pass_rate)).toBeCloseTo(2 / 3, 2);

    const { rows } = await pool.query('SELECT status, pass_rate FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('human_complete');
  });
```

同文件第二个用例（驳回任务去重）里所有 `submitAcceptanceResults(pool, …)` 与 `POST /acceptance/results` 调用补 `run_key`，其 `check_key` 同样换成格号；该用例断言的是唯一索引竞态，语义不变。

- [x] **Step 8: 跑全套确认绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-run-scope.integration.test.js \
  src/__tests__/integration/acceptance.integration.test.js \
  src/__tests__/integration/acceptance-state-machine.integration.test.js
```

预期：三个文件全 PASS。

- [x] **Step 9: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/routes/acceptance.js packages/brain/src/__tests__/integration/acceptance.integration.test.js
git commit -m "feat(acceptance): check_key 规程格号化 + run_id 写入作用域 [task b35bfa0c]"
```

---

### Task 5: zenithjoy 侧独立 PR（yaml `kind` / `scenario_class` / `op` 加厚 / S13-c4 改判 / schema）

**这个 Task 在另一个 repo 操作：`/Users/administrator/perfect21/zenithjoy-workspace`，独立分支 `cp-08071100-d1-acceptance-spec-fields`，独立 PR，与 cecelia 侧 PR 同批合并。**

同批的理由（spec「回滚策略」节）：先合 yaml → `spec_sha` 变但 cecelia 侧冻结锁还没上线；先合 cecelia → 生成器读到没有 `kind` 的 yaml，建单被 `acceptance.js` 与 DB CHECK 双重拒绝直接 400。

`kind` 是本设计核验出的 prep-prd 漏项（缺口 2）：yaml 里现在 `kind` 出现次数为 **0**。

**Files（全在 zenithjoy-workspace）：**
- Modify: `acceptance-spec/line02-android.yaml`
- Modify: `acceptance-spec/line02-android.schema.json`
- Modify: `scripts/acceptance-spec/ai-run/cells-map.mjs`
- Test: `scripts/acceptance-spec/__tests__/spec-fields.test.mjs`（新建）

- [x] **Step 1: 开分支**

```bash
cd /Users/administrator/perfect21/zenithjoy-workspace
git checkout main && git pull
git checkout -b cp-08071100-d1-acceptance-spec-fields
```

- [x] **Step 2: 写 failing 测试（口径定案表逐项断言）**

新建 `scripts/acceptance-spec/__tests__/spec-fields.test.mjs`：

```js
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';

const SPEC = path.join(process.cwd(), 'acceptance-spec/line02-android.yaml');
const doc = yaml.load(fs.readFileSync(SPEC, 'utf-8'));

/** 建行格 = 排除 na:true 的格 ∪ 排除 fixedNa 步骤下的全部四格 */
function buildCells() {
  const out = [];
  for (const step of doc.steps) {
    if (step.fixedNa === true) continue;
    for (const [ck, cell] of Object.entries(step.cells)) {
      if (cell.na === true) continue;
      out.push({ id: `S${step.n}-${ck}`, ...cell });
    }
  }
  return out;
}

const cells = buildCells();

describe('口径定案表', () => {
  it('建行格恰 36', () => expect(cells).toHaveLength(36));

  it('J14-A 每个建行格都有合法 kind', () => {
    const bad = cells.filter((c) => !['FR', 'NFR', 'Invariant', 'SOP'].includes(c.kind));
    expect(bad.map((c) => c.id)).toEqual([]);
  });

  it('S13-c4 改判后 human_only 17 / machine_db 19', () => {
    const by = (v) => cells.filter((c) => c.verifiable_by === v).length;
    expect(by('human_only')).toBe(17);
    expect(by('machine_db')).toBe(19);
  });

  it('S13-c4 的 verifiable_by 是 human_only（只改这一格）', () => {
    expect(cells.find((c) => c.id === 'S13-c4').verifiable_by).toBe('human_only');
  });

  it('时限三格仍留在 machine_db（拍板 ① 后 AI 自持计时）', () => {
    for (const id of ['S7-c2', 'S9-c2', 'S4-c2']) {
      expect(cells.find((c) => c.id === id).verifiable_by).toBe('machine_db');
    }
  });

  it('hard 恰 8 格', () => {
    expect(cells.filter((c) => c.hard === true).map((c) => c.id)).toEqual(
      ['S2-c4', 'S5-c4', 'S6-c4', 'S8-c4', 'S10-c4', 'S11-c4', 'S12-c4', 'S13-c4']
    );
  });

  it('A17① scenario_class 三集合与台账逐格相等', () => {
    const of = (v) => cells.filter((c) => c.scenario_class === v).map((c) => c.id).sort();
    expect(of('mandatory')).toEqual(['S10-c4', 'S4-c2', 'S4-c3', 'S5-c3', 'S5-c4'].sort());
    expect(of('unverifiable_this_version')).toEqual(['S13-c4']);
  });

  it('A17① opportunistic 恰为空集（失败即说明有人重新引入了 opportunistic 格，必须同批补回闸②/Q3″/scenario_falsified 整套机制）', () => {
    expect(cells.filter((c) => c.scenario_class === 'opportunistic')).toHaveLength(0);
  });

  it('A17⑥ mandatory ∩ machine_db 基数为 5', () => {
    expect(cells.filter((c) => c.scenario_class === 'mandatory' && c.verifiable_by === 'machine_db')).toHaveLength(5);
  });

  it('拍板② op 加厚：S5 含掉线场景、S10 含二次采集对照', () => {
    const op = (n) => doc.steps.find((s) => s.n === n).op;
    expect(op(5)).toContain('掉线');
    expect(op(10)).toContain('再发起一次采集');
  });

  it('scenario_required 已从 cells-map 迁走（静态属性单一 SSOT 在 yaml）', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'scripts/acceptance-spec/ai-run/cells-map.mjs'), 'utf-8');
    expect(src).not.toContain('scenario_required');
  });
});
```

- [x] **Step 3: 跑测试确认失败**

```bash
cd /Users/administrator/perfect21/zenithjoy-workspace
npx vitest run scripts/acceptance-spec/__tests__/spec-fields.test.mjs
```

预期：`kind` / `scenario_class` / `op` / `scenario_required` 四组断言全红，行数与 hard 两条已绿。

- [x] **Step 4: 提交 Red commit**

```bash
cd /Users/administrator/perfect21/zenithjoy-workspace
git add scripts/acceptance-spec/__tests__/spec-fields.test.mjs
git commit -m "test(acceptance-spec): 口径定案表 failing test（kind/scenario_class/op）"
```

- [x] **Step 5: 给 36 个建行格补 `kind`**

编辑 `acceptance-spec/line02-android.yaml`。**规则：在每个建行格的 `verifiable_by:` 行的下一行，插入缩进 8 空格的 `kind: <值>`。** 例如 S1-c1：

```yaml
      c1:
        t: 注册成功有提示；失败时页面写清具体原因，不能只说「没绑定成功」
        verifiable_by: human_only
        kind: FR
        fails:
```

逐格取值（判据：红线格 → `Invariant`；时限/频控格 → `NFR`；员工操作规程格 → `SOP`；其余功能格 → `FR`）：

| 格 | kind | 格 | kind | 格 | kind |
|---|---|---|---|---|---|
| S1-c1 | FR | S6-c1 | FR | S10-c3 | FR |
| S1-c3 | SOP | S6-c3 | Invariant | S10-c4 | Invariant |
| S2-c1 | FR | S6-c4 | Invariant | S11-c1 | FR |
| S2-c3 | FR | S7-c1 | FR | S11-c3 | Invariant |
| S2-c4 | SOP | S7-c2 | NFR | S11-c4 | Invariant |
| S3-c1 | FR | S8-c1 | FR | S12-c1 | FR |
| S4-c1 | FR | S8-c3 | FR | S12-c2 | NFR |
| S4-c2 | NFR | S8-c4 | Invariant | S12-c3 | SOP |
| S4-c3 | FR | S9-c1 | FR | S12-c4 | Invariant |
| S5-c1 | FR | S9-c2 | NFR | S13-c1 | FR |
| S5-c3 | FR | S9-c3 | FR | S13-c3 | FR |
| S5-c4 | Invariant | S10-c1 | FR | S13-c4 | Invariant |

合计 FR 20 / NFR 4 / Invariant 9 / SOP 3 = 36。

**外加 S14-c1 也必须补 `kind: SOP`**（红线13「员工手工回评也不能把这步改判通过」是员工规程）。它在 `fixedNa: true` 步骤下不建行，但它有 `t` 与 `verifiable_by` 而无 `na`，会走 schema 的 `else` 分支——Step 8 把 `kind` 加进 `else.required` 之后，不补它会让整份 yaml 校验失败。yaml 里带 `kind` 的格因此是 **37** 个，建行的是 36 个。

- [x] **Step 6: 给 6 个格补 `scenario_class`**

同样在 `kind:` 行下一行插入，缩进 8 空格：

```yaml
        scenario_class: mandatory                    # S4-c2 / S4-c3 / S5-c3 / S5-c4 / S10-c4
        scenario_class: unverifiable_this_version    # S13-c4
```

其余 30 格不带该字段（缺省 = 无场景约束）。

- [x] **Step 7: 改 S13-c4 的 `verifiable_by`、加厚两条 `op`**

`acceptance-spec/line02-android.yaml` 中 S13-c4：

```yaml
      c4:
        t: 红线8：「被频控限制」不能显示成「已私信」
        hard: true
        verifiable_by: human_only
        kind: Invariant
        scenario_class: unverifiable_this_version
```

（拍板 ③：频控红线本版不自动验、绿必经主理人裁决。**只改这一格**——S7-c2/S9-c2 由 AI 自持计时、S4-c2 按 Gate B 第 4 条取数，时限三格全部留在 `machine_db`。）

S5 的 `op` 行：

```yaml
    op: 手机登录2到3个测试小号，触发一次账号扫描；手动让其中一个小号退出登录或断网，制造一次掉线
```

S10 的 `op` 行：

```yaml
    op: 看命中视频评论区抓到的内容；用同一关键词再发起一次采集，对照同一视频评论是否被覆盖
```

- [x] **Step 8: 同步 schema**

`acceptance-spec/line02-android.schema.json` 的 `$defs.cell` 段替换为（`additionalProperties: false` 已开，不加 schema 则新字段直接校验失败）：

```json
    "cell": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "t": { "type": "string", "minLength": 1 },
        "na": { "type": "boolean" },
        "hard": { "type": "boolean" },
        "verifiable_by": { "enum": ["machine_db", "machine_visual", "human_only"] },
        "kind": { "enum": ["FR", "NFR", "Invariant", "SOP"] },
        "scenario_class": { "enum": ["mandatory", "opportunistic", "unverifiable_this_version"] },
        "fails": { "type": "array", "items": { "type": "string", "minLength": 1 } }
      },
      "anyOf": [
        { "required": ["na"] },
        { "required": ["t"] }
      ],
      "if": {
        "properties": { "na": { "const": true } },
        "required": ["na"]
      },
      "then": {},
      "else": {
        "required": ["t", "verifiable_by", "kind"]
      }
    }
```

- [x] **Step 9: 从 `cells-map.mjs` 删除 `scenario_required`**

`scripts/acceptance-spec/ai-run/cells-map.mjs`：删掉文件头注释里的这一段——

```
 * scenario_required: true 的格子需要特定现场（真机重启/小号掉线/数据覆盖等），
 * 采证器仍截图存证，但判官在场景未出现时应判「无法验证」并写明原因——不许假绿。
 *
```

以及 6 个数据项里的 `scenario_required: true,`（S4-c2 / S4-c3 / S5-c3 / S5-c4 / S10-c4 / S13-c4 各一处）。静态属性的单一 SSOT 从此在 yaml。

- [x] **Step 10: 跑测试与 schema 校验确认全绿**

```bash
cd /Users/administrator/perfect21/zenithjoy-workspace
npx vitest run scripts/acceptance-spec/__tests__/spec-fields.test.mjs
node scripts/acceptance-spec/cli.mjs generate
```

预期：12 例全 PASS；`generate` 正常产出不报 schema 错。

- [ ] **Step 11: 提交并开 PR（先不合，等 cecelia 侧 PR 一起）**（分支已 commit，push/开 PR 由 controller 统一执行）

```bash
cd /Users/administrator/perfect21/zenithjoy-workspace
git add acceptance-spec/line02-android.yaml acceptance-spec/line02-android.schema.json \
        scripts/acceptance-spec/ai-run/cells-map.mjs
git commit -m "feat(acceptance-spec): 补 kind/scenario_class + S13-c4 改判 human_only + S5/S10 op 加厚"
git push -u origin cp-08071100-d1-acceptance-spec-fields
gh pr create --title "feat(acceptance-spec): D1 规程 yaml 静态属性收口（kind/scenario_class/op）" \
  --body "配合 cecelia D1 数据层地基（task b35bfa0c）。改 op 会变 spec_sha，必须与 cecelia 侧 PR 同批合并：先合本 PR 会让 cecelia 尚未上线的冻结锁把 run 打成 stale；先合 cecelia 会让生成器读到没有 kind 的 yaml 建单 400。"
```

---

### Task 6: 规程 yaml → 36 行建单生成器

**落点拆两处**（对 spec 单元 ② 的一处细化，理由写进代码注释）：解析与静态属性派生放 `src/acceptance-spec.js`，因为单元 ④/⑥ 的服务端校验也要读同一批静态属性；`scripts/acceptance/build-checks-from-spec.mjs` 只是它的 CLI 外壳。路由 import `src/` 是正常方向，反过来 import `scripts/` 不是。

**Files:**
- Create: `packages/brain/src/acceptance-spec.js`
- Create: `packages/brain/scripts/acceptance/build-checks-from-spec.mjs`
- Create: `packages/brain/src/__tests__/fixtures/acceptance/line02-android.yaml`（Task 5 产出的副本）
- Test: `packages/brain/src/__tests__/acceptance-spec.test.js`

- [x] **Step 1: 落 fixture（CI 里没有 zenithjoy repo，单测必须自带一份规程）**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
mkdir -p packages/brain/src/__tests__/fixtures/acceptance
cp /Users/administrator/perfect21/zenithjoy-workspace/acceptance-spec/line02-android.yaml \
   packages/brain/src/__tests__/fixtures/acceptance/line02-android.yaml
```

**前置：Task 5 的 Step 5-9 必须已完成**，否则拷进来的 yaml 没有 `kind`。

- [x] **Step 2: 写 failing 单测**

新建 `packages/brain/src/__tests__/acceptance-spec.test.js`：

```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { loadSpec, buildCells, deriveSets, computeSpecSha } from '../acceptance-spec.js';
import { buildChecksFromSpec } from '../../scripts/acceptance/build-checks-from-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures/acceptance/line02-android.yaml');

describe('生成器对真规程产出恰 36 行', () => {
  const { checks, spec_sha, version, stats } = buildChecksFromSpec(FIXTURE);

  it('恰 36 行', () => expect(checks).toHaveLength(36));

  it('格号全部匹配 ^S\\d+-c[1-4]$', () => {
    expect(checks.filter((c) => !/^S\d+-c[1-4]$/.test(c.check_key))).toEqual([]);
  });

  it('零个 S14-*（fixedNa 步骤全部四格排除，含有 t 的 c1）', () => {
    expect(checks.filter((c) => c.check_key.startsWith('S14-'))).toEqual([]);
  });

  it('每行 kind/verifiable_by 齐全，detail 带静态属性', () => {
    for (const c of checks) {
      expect(['FR', 'NFR', 'Invariant', 'SOP']).toContain(c.kind);
      expect(['human_only', 'machine_db', 'machine_visual']).toContain(c.detail.verifiable_by);
      expect(typeof c.detail.hard).toBe('boolean');
      expect(typeof c.detail.step_n).toBe('number');
      expect(typeof c.detail.step_name).toBe('string');
      expect(Array.isArray(c.detail.fails)).toBe(true);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.device).toBeNull();
    }
  });

  it('S1-c4 有 t 但 na:true → 不建行', () => {
    expect(checks.find((c) => c.check_key === 'S1-c4')).toBeUndefined();
  });

  it('version 直取 yaml.version', () => expect(version).toBe('2.1.19'));

  it('spec_sha 是 yaml 文件原始字节的 sha256（不是重序列化）', () => {
    const raw = fs.readFileSync(FIXTURE);
    expect(spec_sha).toBe(createHash('sha256').update(raw).digest('hex'));
    // 重序列化会随 js-yaml 版本漂移，让冻结锁在无人改规程时误报 stale
    expect(spec_sha).not.toBe(
      createHash('sha256').update(yaml.dump(yaml.load(raw.toString()))).digest('hex')
    );
  });

  it('stats 汇总与口径定案表相等', () => {
    expect(stats).toMatchObject({
      total: 36, human_only: 17, machine_db: 19, hard: 8, mandatory: 5, unverifiable: 1,
    });
  });
});

describe('A14 生成器排除集回归（构造 yaml：S7 也标 fixedNa）', () => {
  it('建行数从 36 降到 34，且结果不含任何 S7-*', () => {
    const doc = yaml.load(fs.readFileSync(FIXTURE, 'utf-8'));
    doc.steps.find((s) => s.n === 7).fixedNa = true;   // S7 有效格 = c1/c2 共 2 格
    const cells = buildCells(doc);
    expect(cells).toHaveLength(34);
    expect(cells.filter((c) => c.check_key.startsWith('S7-'))).toEqual([]);
  });
});

describe('deriveSets — 四个占位符共用同一套解析（禁硬编码 19/17/5）', () => {
  const sets = deriveSets(buildCells(loadSpec(FIXTURE).doc));

  it(':human_only_list 恰 17 格', () => expect(sets.humanOnlyList).toHaveLength(17));
  it(':machine_db_list 恰 19 格', () => expect(sets.machineDbList).toHaveLength(19));
  it(':unverifiable_list = {S13-c4}', () => expect(sets.unverifiableList).toEqual(['S13-c4']));
  it(':mandatory_scenario_codes 恰 5 且逐格相等', () => {
    expect([...sets.mandatoryScenarioCodes].sort())
      .toEqual(['S10-c4', 'S4-c2', 'S4-c3', 'S5-c3', 'S5-c4'].sort());
  });
  it('A17⑥ mandatory ∩ machine_db 基数 5', () => {
    expect(sets.mandatoryMachineDbList).toHaveLength(5);
  });
  it('hard 恰 8 格', () => expect(sets.hardList).toHaveLength(8));
});

describe('spec_sha 对真实 zenithjoy 规程（本机有 repo 时才跑）', () => {
  const REAL = process.env.ACCEPTANCE_SPEC_PATH
    || '/Users/administrator/perfect21/zenithjoy-workspace/acceptance-spec/line02-android.yaml';
  const has = fs.existsSync(REAL);

  it.skipIf(!has)('真规程与 fixture 的建行结果逐格相等（fixture 未漂移）', () => {
    const real = buildChecksFromSpec(REAL);
    const fx = buildChecksFromSpec(FIXTURE);
    expect(real.checks.map((c) => c.check_key)).toEqual(fx.checks.map((c) => c.check_key));
    expect(real.stats).toEqual(fx.stats);
  });
});
```

- [x] **Step 3: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-spec.test.js
```

预期：FAIL，`Failed to load url ../acceptance-spec.js`。

- [x] **Step 4: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/acceptance-spec.test.js packages/brain/src/__tests__/fixtures/acceptance/line02-android.yaml
git commit -m "test(acceptance): 建单生成器 36 行与排除集 failing test [task b35bfa0c]"
```

- [x] **Step 5: 实现 `src/acceptance-spec.js`**

```js
/**
 * acceptance-spec.js — 规程 yaml 解析与静态属性派生（D1）
 *
 * 一条全局取数纪律：所有涉及「AI 可判格数」的数字一律从这里解析取数，
 * 代码里不出现 36/19/17/5/{S13-c4} 这些常量。Gate B 第 4 条落档 3 时 S4-c2 转
 * human_only，全表数字整体位移（human_only 18 / machine_db 18 / 阈值 ≥9 /
 * mandatory ∩ machine_db 缩为 4）；硬编码等于在回落发生时静默算错。
 */
import fs from 'fs';
import { createHash } from 'crypto';
import yaml from 'js-yaml';

/** 规程文件路径：env 覆盖 > zenithjoy-workspace 默认位置 */
export const DEFAULT_SPEC_PATH = process.env.ACCEPTANCE_SPEC_PATH
  || '/Users/administrator/perfect21/zenithjoy-workspace/acceptance-spec/line02-android.yaml';

/** 对 yaml 文件的原始字节取 sha256——不是解析后重序列化（那会随 js-yaml 版本漂移） */
export function computeSpecSha(rawBuffer) {
  return createHash('sha256').update(rawBuffer).digest('hex');
}

export function loadSpec(filePath = DEFAULT_SPEC_PATH) {
  const raw = fs.readFileSync(filePath);
  const doc = yaml.load(raw.toString('utf-8'));
  return { raw, doc, spec_sha: computeSpecSha(raw), version: doc.version };
}

/**
 * 排除集（J10-B，逐条机械）：
 *   - 排除 cells[cX].na === true 的格；
 *   - 排除 step.fixedNa === true 步骤下的全部四格（含该步 c1 那个有 t 和 verifiable_by
 *     的格——fixedNa 优先级高于单格属性）。
 * 对 line02-android.yaml 恰得 36 行。
 */
export function buildCells(doc) {
  const cells = [];
  for (const step of doc.steps) {
    if (step.fixedNa === true) continue;
    for (const ck of ['c1', 'c2', 'c3', 'c4']) {
      const cell = step.cells?.[ck];
      if (!cell || cell.na === true) continue;
      cells.push({
        check_key: `S${step.n}-${ck}`,
        kind: cell.kind,
        name: cell.t,
        verifiable_by: cell.verifiable_by,
        scenario_class: cell.scenario_class || null,
        hard: cell.hard === true,
        step_n: step.n,
        step_name: step.name,
        fails: cell.fails || [],
      });
    }
  }
  return cells;
}

/** v7-final 四个占位符（:human_only_list / :unverifiable_list / :mandatory_scenario_codes / :mandatory_machine_db_list）共用这一处派生 */
export function deriveSets(cells) {
  const pick = (fn) => cells.filter(fn).map((c) => c.check_key);
  return {
    humanOnlyList: pick((c) => c.verifiable_by === 'human_only'),
    machineDbList: pick((c) => c.verifiable_by === 'machine_db'),
    hardList: pick((c) => c.hard),
    unverifiableList: pick((c) => c.scenario_class === 'unverifiable_this_version'),
    mandatoryScenarioCodes: pick((c) => c.scenario_class === 'mandatory'),
    mandatoryMachineDbList: pick((c) => c.scenario_class === 'mandatory' && c.verifiable_by === 'machine_db'),
    byKey: new Map(cells.map((c) => [c.check_key, c])),
  };
}
```

- [x] **Step 6: 实现 `scripts/acceptance/build-checks-from-spec.mjs`**

```js
#!/usr/bin/env node
/**
 * build-checks-from-spec.mjs — 规程 yaml → 可直接喂给 POST /api/brain/acceptance/runs 的 checks 数组
 *
 * 用法：node packages/brain/scripts/acceptance/build-checks-from-spec.mjs [spec.yaml]
 * 输出：JSON { checks, spec_sha, version, stats }
 */
import { loadSpec, buildCells, deriveSets, DEFAULT_SPEC_PATH } from '../../src/acceptance-spec.js';

export function buildChecksFromSpec(filePath = DEFAULT_SPEC_PATH) {
  const { doc, spec_sha, version } = loadSpec(filePath);
  const cells = buildCells(doc);
  const sets = deriveSets(cells);
  const checks = cells.map((c) => ({
    check_key: c.check_key,
    kind: c.kind,
    name: c.name,
    device: null,
    detail: {
      verifiable_by: c.verifiable_by,
      scenario_class: c.scenario_class,
      hard: c.hard,
      step_n: c.step_n,
      step_name: c.step_name,
      fails: c.fails,
    },
  }));
  return {
    checks,
    spec_sha,
    version,
    stats: {
      total: checks.length,
      human_only: sets.humanOnlyList.length,
      machine_db: sets.machineDbList.length,
      hard: sets.hardList.length,
      mandatory: sets.mandatoryScenarioCodes.length,
      unverifiable: sets.unverifiableList.length,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = buildChecksFromSpec(process.argv[2] || DEFAULT_SPEC_PATH);
  console.log(JSON.stringify(out, null, 2));
}
```

- [x] **Step 7: 跑单测与 CLI 确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-spec.test.js
node scripts/acceptance/build-checks-from-spec.mjs \
  /Users/administrator/perfect21/zenithjoy-workspace/acceptance-spec/line02-android.yaml \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.stats)})"
```

预期：单测 PASS；CLI 打印 `{ total: 36, human_only: 17, machine_db: 19, hard: 8, mandatory: 5, unverifiable: 1 }`。

- [x] **Step 8: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/acceptance-spec.js packages/brain/scripts/acceptance/build-checks-from-spec.mjs
git commit -m "feat(acceptance): 规程 yaml → 36 行建单生成器 [task b35bfa0c]"
```

---

### Task 7: 服务端 reason 校验 + `POST /acceptance/ai-results` 落库

**D1 只做该端点的服务端校验与落库语义，不做采证器**（采证侧属 D2）。

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`（新增 `validateAiReason` 纯函数与 `ai-results` 端点）
- Test: `packages/brain/src/__tests__/acceptance-ai-reason.test.js`
- Test: `packages/brain/src/__tests__/integration/acceptance-ai-results.integration.test.js`

- [x] **Step 1: 写 failing 单测（A4③⑥⑦）**

新建 `packages/brain/src/__tests__/acceptance-ai-reason.test.js`：

```js
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { validateAiReason } from '../routes/acceptance.js';
import { loadSpec, buildCells, deriveSets } from '../acceptance-spec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cells = buildCells(loadSpec(path.join(__dirname, 'fixtures/acceptance/line02-android.yaml')).doc);
const sets = deriveSets(cells);

describe('A4③ reason=human_only 绑格的静态属性，不是 AI 说了算', () => {
  it('machine_db 格自报 human_only → 400', () => {
    const err = validateAiReason({ check_key: 'S7-c1', reason: 'human_only' }, sets);
    expect(err).toMatchObject({ status: 400 });
    expect(err.body.error).toBe('reason_not_allowed_for_cell');
  });

  it('human_only 格自报 human_only → 放行', () => {
    expect(validateAiReason({ check_key: 'S12-c1', reason: 'human_only' }, sets)).toBeNull();
  });
});

describe('A4⑥⑦ scenario_not_triggered 合法域为空集（拍板②后 opportunistic = ∅）', () => {
  it('对 36 个建行格逐格提交 → 36 次全部 400，无一例外', () => {
    const rejected = cells
      .map((c) => validateAiReason({ check_key: c.check_key, reason: 'scenario_not_triggered' }, sets))
      .filter((e) => e && e.status === 400);
    expect(rejected).toHaveLength(36);
    // 无条件 reject：不查上下文、不看单头是否勾了场景码——合法域为空与上下文无关
    expect(new Set(rejected.map((e) => e.body.error))).toEqual(new Set(['reason_domain_empty']));
  });
});

describe('故障类 reason 允许落库（由 Q3′ 承载，不进绿通道）', () => {
  for (const reason of ['page_unreachable', 'login_failed', 'timeout']) {
    it(`${reason} 放行`, () => {
      expect(validateAiReason({ check_key: 'S7-c1', reason }, sets)).toBeNull();
    });
  }
});

describe('未知格号与未知 reason', () => {
  it('不在建行集合里的格号 → 400', () => {
    expect(validateAiReason({ check_key: 'S14-c1', reason: 'timeout' }, sets)).toMatchObject({ status: 400 });
  });

  it('无 reason（AI 给了确定判定）→ 放行', () => {
    expect(validateAiReason({ check_key: 'S7-c1', reason: null }, sets)).toBeNull();
  });
});
```

- [x] **Step 2: 写 failing 集成测试（落库语义）**

新建 `packages/brain/src/__tests__/integration/acceptance-ai-results.integration.test.js`：

```js
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `ai-itest-${process.pid}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

async function seed(detail) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, gp_id, detail)
     VALUES ($1, 'AI 回写测试', '7790f728', $2::jsonb) RETURNING id`,
    [RUN_KEY, JSON.stringify(detail)]
  );
  for (const key of ['S7-c1', 'S12-c1']) {
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1,$2,'FR',$3)`,
      [rows[0].id, key, key]
    );
  }
}

const FULL_SCENARIOS = { scenarios_observed: ['S4-c2', 'S4-c3', 'S5-c3', 'S5-c4', 'S10-c4'] };

describe('POST /ai-results 落库语义', () => {
  beforeEach(() => seed(FULL_SCENARIOS));
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('AI 四列落库：ai_verdict / ai_evidence.reason / ai_run_at', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [
        { check_key: 'S7-c1', ai_verdict: '通过', evidence: { screenshot: 's3://x.png' } },
        { check_key: 'S12-c1', ai_verdict: '无法验证', reason: 'human_only' },
      ],
    });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT check_key, ai_verdict, ai_evidence, ai_run_at FROM acceptance_checks c
       JOIN acceptance_runs r ON r.id = c.run_id WHERE r.run_key = $1 ORDER BY check_key`, [RUN_KEY]
    );
    const s12 = rows.find((r) => r.check_key === 'S12-c1');
    expect(s12.ai_verdict).toBe('无法验证');
    expect(s12.ai_evidence.reason).toBe('human_only');
    expect(s12.ai_run_at).toBeInstanceOf(Date);
    expect(rows.find((r) => r.check_key === 'S7-c1').ai_evidence.screenshot).toBe('s3://x.png');
  });

  it('A4⑦ 任一格 scenario_not_triggered → 400，且该批不落库', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [{ check_key: 'S7-c1', ai_verdict: '无法验证', reason: 'scenario_not_triggered' }],
    });
    expect(res.status).toBe(400);
    const { rows } = await pool.query(
      `SELECT ai_verdict FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1 AND c.check_key = 'S7-c1'`, [RUN_KEY]
    );
    expect(rows[0].ai_verdict).toBeNull();
  });

  it('AI 回写不改 run.status（status 只看人列进度）', async () => {
    await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }],
    });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('pending');
  });

  it('哑火判据写进 detail.ai_status / ai_incomplete', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }],
    });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    // S12-c1 没回写 → 缺格数 > 0 → 条件③ 成立
    expect(rows[0].detail.ai_status).toBe('dumb');
    expect(rows[0].detail.ai_incomplete).toBe(true);
  });
});
```

- [x] **Step 3: 登记集成测试 + 给测试环境固定规程路径**

`packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 追加：

```js
  'src/__tests__/integration/acceptance-ai-results.integration.test.js',
```

同文件顶部 import 段追加：

```js
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

`test:` 段里 `globals: true,` 之后插入：

```js
    env: {
      // CI runner 上没有 zenithjoy-workspace，DEFAULT_SPEC_PATH 会 ENOENT 让所有走
      // getSpecSets() 的端点 500。测试一律读仓内 fixture（Task 6 从 zenithjoy 拷入）。
      ACCEPTANCE_SPEC_PATH: path.join(__dirname, 'src/__tests__/fixtures/acceptance/line02-android.yaml'),
    },
```

`vitest.integration.config.js` 靠 `...brainConfig.test` 展开自动继承这一段，无需重复。

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-ai-reason.test.js
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-ai-results.integration.test.js
```

预期：`validateAiReason is not a function`；端点 404。

- [x] **Step 4: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/acceptance-ai-reason.test.js \
        packages/brain/src/__tests__/integration/acceptance-ai-results.integration.test.js \
        packages/brain/vitest.config.js
git commit -m "test(acceptance): AI reason 校验与 ai-results 落库 failing test [task b35bfa0c]"
```

- [x] **Step 5: 实现 `validateAiReason`**

在 `packages/brain/src/routes/acceptance.js` 顶部 import 段追加：

```js
import { computeAiStatus, AI_FAILURE_REASONS } from '../acceptance-state.js';
import { loadSpec, buildCells, deriveSets } from '../acceptance-spec.js';
```

并在 `ACCEPTANCE_RESULTS` 常量之后加入：

```js
export const AI_VERDICTS = ['通过', '不通过', '无法验证'];

/** 规程静态属性缓存：进程内只解析一次；改规程要重启 Brain（与 skill 缓存同一约定） */
let _specSets = null;
export function getSpecSets() {
  if (!_specSets) {
    const { doc, spec_sha, version } = loadSpec();
    const cells = buildCells(doc);
    _specSets = { ...deriveSets(cells), spec_sha, version, cells };
  }
  return _specSets;
}
export function _resetSpecSetsForTest() { _specSets = null; }

/**
 * A4③⑥⑦ 服务端 reason 校验。返回 null = 放行，否则返回 {status, body}。
 * @param {{check_key:string, reason:string?}} item
 * @param {ReturnType<typeof deriveSets>} sets
 */
export function validateAiReason({ check_key, reason }, sets) {
  const cell = sets.byKey.get(check_key);
  if (!cell) {
    return { status: 400, body: { error: 'unknown_check_key', check_key } };
  }
  // A4⑥⑦：拍板 ② 后 opportunistic = ∅，该 reason 的合法域为空集。无条件 reject——
  // 不查上下文、不看单头是否勾了场景码，合法域为空与上下文无关。
  if (reason === 'scenario_not_triggered') {
    return { status: 400, body: { error: 'reason_domain_empty', check_key,
      hint: '本版无 opportunistic 格，scenario_not_triggered 合法域为空集' } };
  }
  // A4③：reason 绑格的静态属性，不是 AI 说了算
  if (reason === 'human_only' && cell.verifiable_by !== 'human_only') {
    return { status: 400, body: { error: 'reason_not_allowed_for_cell', check_key,
      verifiable_by: cell.verifiable_by } };
  }
  if (reason && reason !== 'human_only' && !AI_FAILURE_REASONS.includes(reason)) {
    return { status: 400, body: { error: 'unknown_reason', check_key, reason } };
  }
  return null;
}
```

- [x] **Step 6: 实现 `POST /ai-results` 端点**

在 `createAcceptanceInternalRouter` 里 `router.post('/results', …)` 之后插入：

```js
  router.post('/ai-results', async (req, res) => {
    const { run_key, results } = req.body || {};
    if (!run_key) return res.status(400).json({ error: 'run_key is required' });
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results must be a non-empty array' });
    }
    const sets = getSpecSets();

    for (const item of results) {
      if (!AI_VERDICTS.includes(item?.ai_verdict)) {
        return res.status(400).json({ error: `ai_verdict must be one of: ${AI_VERDICTS.join(',')}`, check_key: item?.check_key });
      }
      const err = validateAiReason(item, sets);
      if (err) return res.status(err.status).json(err.body);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: runRows } = await client.query(
        'SELECT id, detail FROM acceptance_runs WHERE run_key = $1 FOR UPDATE', [run_key]
      );
      if (runRows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found', run_key });
      }
      const runId = runRows[0].id;

      for (const item of results) {
        await client.query(
          `UPDATE acceptance_checks
              SET ai_verdict = $1, ai_evidence = $2::jsonb, ai_run_at = NOW(), updated_at = NOW()
            WHERE run_id = $3 AND check_key = $4`,
          [item.ai_verdict, JSON.stringify({ ...(item.evidence || {}), reason: item.reason || null }),
           runId, item.check_key]
        );
      }

      // 哑火判据：分母与阈值从 yaml 派生，不硬编码
      const { rows: allCells } = await client.query(
        'SELECT check_key, ai_verdict, ai_evidence FROM acceptance_checks WHERE run_id = $1', [runId]
      );
      const enriched = allCells.map((c) => ({
        check_key: c.check_key,
        ai_verdict: c.ai_verdict,
        ai_reason: c.ai_evidence?.reason || null,
        verifiable_by: sets.byKey.get(c.check_key)?.verifiable_by || 'human_only',
      }));
      const ai = computeAiStatus(enriched, { machineDbTotal: sets.machineDbList.length });
      await client.query(
        `UPDATE acceptance_runs
            SET detail = COALESCE(detail, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ ai_status: ai.ai_status, ai_incomplete: ai.ai_incomplete,
                          ai_dumb_reasons: ai.reasons, ai_missing_cells: ai.missing_cells }), runId]
      );
      await client.query('COMMIT');
      return res.json({ updated: results.length, ai_status: ai.ai_status, ai_incomplete: ai.ai_incomplete });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] POST /ai-results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });
```

- [x] **Step 7: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_SPEC_PATH=$PWD/src/__tests__/fixtures/acceptance/line02-android.yaml \
  npx vitest run src/__tests__/acceptance-ai-reason.test.js
DB_NAME=cecelia_scratch ACCEPTANCE_SPEC_PATH=$PWD/src/__tests__/fixtures/acceptance/line02-android.yaml \
  npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-ai-results.integration.test.js
```

预期：两个文件全 PASS。

- [x] **Step 8: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/routes/acceptance.js
git commit -m "feat(acceptance): 服务端 AI reason 校验 + ai-results 落库与哑火判据 [task b35bfa0c]"
```

---

### Task 8: 收单期推进闸（`scenarios_observed` 未勾齐 → 409）

拍板 ② 的承重墙：规定动作没做完，AI 采证的前提就不成立，此时收 AI 回写等于把「场景没发生」洗成「AI 判定通过」。**整 run 拒收，不是逐格拒。**

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`（`ai-results` 前置）
- Test: `packages/brain/src/__tests__/integration/acceptance-scenario-gate.integration.test.js`

- [ ] **Step 1: 写 failing 集成测试（A4⑧ / A16①-b）**

新建 `packages/brain/src/__tests__/integration/acceptance-scenario-gate.integration.test.js`：

```js
import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `gate-itest-${process.pid}`;
const ALL = ['S4-c2', 'S4-c3', 'S5-c3', 'S5-c4', 'S10-c4'];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

async function seed(scenarios_observed) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, detail) VALUES ($1,'推进闸',$2::jsonb) RETURNING id`,
    [RUN_KEY, JSON.stringify({ scenarios_observed })]
  );
  await pool.query(
    `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1,'S7-c1','FR','x')`,
    [rows[0].id]
  );
}

const post = () => request(makeApp()).post('/api/brain/acceptance/ai-results')
  .send({ run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }] });

describe('A4⑧ 收单期推进闸', () => {
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('缺一个 mandatory 场景码 → 409，响应体列出缺失清单', async () => {
    await seed(ALL.slice(0, 4));
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('mandatory_scenarios_missing');
    expect(res.body.missing).toEqual(['S10-c4']);
  });

  it('scenarios_observed 完全为空 → 409 且缺失清单为全部 5 个', async () => {
    await seed([]);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.missing.sort()).toEqual([...ALL].sort());
  });

  it('detail 里根本没有 scenarios_observed 字段 → 409（fail-closed，不当作已勾齐）', async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    const { rows } = await pool.query(
      `INSERT INTO acceptance_runs (run_key, title) VALUES ($1,'无字段') RETURNING id`, [RUN_KEY]
    );
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1,'S7-c1','FR','x')`,
      [rows[0].id]
    );
    const res = await post();
    expect(res.status).toBe(409);
  });

  it('5 个 mandatory 码勾齐 → 放行 200', async () => {
    await seed(ALL);
    const res = await post();
    expect(res.status).toBe(200);
  });

  it('闸拦下时该批一格都不落库（整 run 拒收）', async () => {
    await seed(ALL.slice(0, 2));
    await post();
    const { rows } = await pool.query(
      `SELECT ai_verdict FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1`, [RUN_KEY]
    );
    expect(rows.every((r) => r.ai_verdict === null)).toBe(true);
  });
});
```

- [ ] **Step 2: 登记并跑红**

`packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 追加：

```js
  'src/__tests__/integration/acceptance-scenario-gate.integration.test.js',
```

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_SPEC_PATH=$PWD/src/__tests__/fixtures/acceptance/line02-android.yaml \
  npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-scenario-gate.integration.test.js
```

预期：前三例 FAIL（返 200 而非 409）。

- [ ] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/integration/acceptance-scenario-gate.integration.test.js packages/brain/vitest.config.js
git commit -m "test(acceptance): 收单期推进闸 failing test [task b35bfa0c]"
```

- [ ] **Step 4: 实现推进闸**

在 `routes/acceptance.js` 的 `validateAiReason` 之后加入纯函数：

```js
/**
 * A4⑧ / A16①-b 收单期推进闸：mandatory 场景码未勾齐则整 run 拒收 AI 回写。
 * 集合从 yaml 解析取数，不在代码里硬编码格号（r6-P2-2 立的规矩）。
 */
export function missingMandatoryScenarios(runDetail, sets) {
  const observed = new Set(runDetail?.scenarios_observed || []);
  return sets.mandatoryScenarioCodes.filter((code) => !observed.has(code));
}
```

在 `ai-results` 端点里，`const runId = runRows[0].id;` 之后紧接着插入：

```js
      const missing = missingMandatoryScenarios(runRows[0].detail, sets);
      if (missing.length > 0) {
        await safeRollback(client);
        return res.status(409).json({
          error: 'mandatory_scenarios_missing',
          missing,
          hint: '规定动作未做完，AI 采证前提不成立；补做场景后再回写',
        });
      }
```

放在任何 UPDATE 之前——闸拦下时一格都不能落库。

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_SPEC_PATH=$PWD/src/__tests__/fixtures/acceptance/line02-android.yaml \
  npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-scenario-gate.integration.test.js \
  src/__tests__/integration/acceptance-ai-results.integration.test.js
```

预期：两个文件全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/routes/acceptance.js
git commit -m "feat(acceptance): 收单期 mandatory 场景推进闸 [task b35bfa0c]"
```

---

### Task 9: 48h 过期扫描器（**加厚既有 job，不新建平行 job**）

现状核验第 10 条：`acceptance-aging.js` 这个 48h 哨兵**已经存在并已在 `scheduler-jobs.js:70` 注册**，只是它只发 Bark、不改状态。prep-prd 第 11 条若照字面新建一个 job，就会出现两个 48h 扫描器抢同一批 run。

同批必须修的连带失效：`acceptance-aging.js:38` 的 orphan 扫描谓词写死 `r.status = 'failed'`，7 值状态机上线后新 run 永不落 `failed`，这段会静默恒返回空集而无人察觉——和 P2-8 记的棘轮静默 fallback 是同一个形状的病。本刀取「显式标注为只覆盖历史 failed run + 加断言防止它被当成活的防线」（改成按 `final_state='红'` 取数属 D4 范围）。

**Files:**
- Modify: `packages/brain/src/acceptance-aging.js`
- Test: `packages/brain/src/__tests__/integration/acceptance-aging-expire.integration.test.js`

- [ ] **Step 1: 写 failing 集成测试（A10②）**

新建 `packages/brain/src/__tests__/integration/acceptance-aging-expire.integration.test.js`：

```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { runAcceptanceAging, _resetGateForTest, ORPHAN_SCAN_LEGACY_STATUSES } from '../../acceptance-aging.js';

const RUN_KEY = `aging-itest-${process.pid}`;

async function seed(status, ageHours) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, status, created_at)
     VALUES ($1, '过期扫描', $2, now() - ($3 || ' hours')::interval)`,
    [RUN_KEY, status, String(ageHours)]
  );
}

const statusOf = async () => (await pool.query(
  'SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY])).rows[0].status;

describe('A10② pending 48h → expired', () => {
  beforeEach(() => { _resetGateForTest(); });
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('created_at 回拨 49h 的 pending run 被扫成 expired', async () => {
    await seed('pending', 49);
    const r = await runAcceptanceAging(pool);
    expect(r.skipped).toBe(false);
    expect(r.expired_runs).toBeGreaterThanOrEqual(1);
    expect(await statusOf()).toBe('expired');
  });

  it('未满 48h 的 pending run 不动', async () => {
    await seed('pending', 10);
    await runAcceptanceAging(pool);
    expect(await statusOf()).toBe('pending');
  });

  it('in_review 超 48h 只告警不转 expired（有人正在填，转态会丢工作）', async () => {
    await seed('in_review', 60);
    const r = await runAcceptanceAging(pool);
    expect(r.overdue_runs).toBeGreaterThanOrEqual(1);
    expect(await statusOf()).toBe('in_review');
  });

  it('human_complete / adjudicated / stale / abandoned 一律不被扫', async () => {
    for (const st of ['human_complete', 'adjudicated', 'stale', 'abandoned']) {
      await seed(st, 100);
      _resetGateForTest();
      await runAcceptanceAging(pool);
      expect(await statusOf()).toBe(st);
    }
  });

  it('orphan 扫描被显式标注为只覆盖历史 failed run（不是活的防线）', () => {
    // 谓词一旦被人默默改回「活防线」的写法，这条断言会红并逼他去看 D4 的分流口径
    expect(ORPHAN_SCAN_LEGACY_STATUSES).toEqual(['failed']);
  });
});
```

- [ ] **Step 2: 登记并跑红**

`packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 追加：

```js
  'src/__tests__/integration/acceptance-aging-expire.integration.test.js',
```

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-aging-expire.integration.test.js
```

预期：FAIL，`ORPHAN_SCAN_LEGACY_STATUSES` 未导出、`expired_runs` 为 undefined。

- [ ] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/integration/acceptance-aging-expire.integration.test.js packages/brain/vitest.config.js
git commit -m "test(acceptance): 48h 过期扫描转 expired failing test [task b35bfa0c]"
```

- [ ] **Step 4: 加厚 `acceptance-aging.js`**

在 `packages/brain/src/acceptance-aging.js` 的 `let lastRunAt = 0;` 之前加入：

```js
/**
 * orphan 扫描只覆盖 migration 392 之前落库的历史 failed run —— 7 值状态机上线后
 * 新 run 永不落 failed，这段扫描对新数据恒返回空集。它不是一条活的防线：
 * 「格判红 → 分流建任务」的口径由 D4 的聚合式分流接管，届时整段删除。
 * 常量在这里显式导出并被回归测试断言，防止它被当成还在工作的防护而无人察觉。
 */
export const ORPHAN_SCAN_LEGACY_STATUSES = ['failed'];
```

`runAcceptanceAging` 里，在 `// 1. 超 48h 未验收` 那段查询之后（第 33 行 `);` 之后）插入过期转移：

```js
    // A10② pending 超 48h → expired。只转 pending：in_review 说明有人正在填，
    // 转态会把已填的工作打进非活跃终态。Bark 告警对两者都保留。
    const { rows: expired } = await pool.query(
      `UPDATE acceptance_runs SET status = 'expired', updated_at = now()
        WHERE status = 'pending'
          AND created_at < now() - interval '${OVERDUE_HOURS} hours'
        RETURNING run_key`
    );
```

第 36-38 行的 orphan 查询改为参数化并指向常量：

```js
    // 2. 驳回补偿扫描（历史 failed run 专用，见 ORPHAN_SCAN_LEGACY_STATUSES 注释）
    const { rows: orphanFailed } = await pool.query(
      `SELECT r.run_key, r.title FROM acceptance_runs r
       WHERE r.status = ANY($1)
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
           WHERE t.payload->>'acceptance_run_key' = r.run_key
             AND t.status NOT IN ('completed','failed','cancelled')
         )
         AND r.updated_at > now() - interval '7 days'`,
      [ORPHAN_SCAN_LEGACY_STATUSES]
    );
```

告警文案段（第 47-55 行）追加一行，并把两处 return 补上 `expired_runs`：

```js
      if (expired.length > 0) {
        lines.push(`${expired.length} 单超 ${OVERDUE_HOURS}h 未开始验收，已转 expired`);
      }
```

```js
    return { skipped: false, overdue_runs: overdue.length, orphan_failed: orphanFailed.length, expired_runs: expired.length };
```

第 22 行的早退分支同样补 `expired_runs: 0`，第 73 行的 catch 分支同理。

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-aging-expire.integration.test.js
```

预期：5 例全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/acceptance-aging.js
git commit -m "feat(acceptance): 48h 哨兵加厚为 pending→expired 状态转移 [task b35bfa0c]"
```

---

### Task 10: 显式作废端点（`→ abandoned`）

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`
- Test: `packages/brain/src/__tests__/integration/acceptance-lifecycle.integration.test.js`

- [ ] **Step 1: 写 failing 集成测试（A10③ / A10④）**

新建 `packages/brain/src/__tests__/integration/acceptance-lifecycle.integration.test.js`：

```js
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `life-itest-${process.pid}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

async function seed() {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, status) VALUES ($1,'作废测试','in_review')`,
    [RUN_KEY]
  );
}

describe('A10③ 显式作废端点', () => {
  beforeEach(seed);
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('作废后 status=abandoned 且三项留痕非空', async () => {
    const res = await request(makeApp())
      .patch(`/api/brain/acceptance/runs/${RUN_KEY}/abandon`)
      .send({ reason: '测试机被别的任务占用，本轮作废重开', by: 'alex' });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT status, detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]
    );
    expect(rows[0].status).toBe('abandoned');
    expect(rows[0].detail.abandoned_reason).toBe('测试机被别的任务占用，本轮作废重开');
    expect(rows[0].detail.abandoned_by).toBe('alex');
    expect(rows[0].detail.abandoned_at).toBeTruthy();
  });

  it('缺 reason 或 by → 400，且不改状态', async () => {
    for (const body of [{ by: 'alex' }, { reason: 'x' }, {}]) {
      const res = await request(makeApp())
        .patch(`/api/brain/acceptance/runs/${RUN_KEY}/abandon`).send(body);
      expect(res.status).toBe(400);
    }
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('in_review');
  });

  it('不存在的 run → 404', async () => {
    const res = await request(makeApp())
      .patch('/api/brain/acceptance/runs/no-such-run/abandon')
      .send({ reason: 'x', by: 'alex' });
    expect(res.status).toBe(404);
  });

  it('A10④ 反二义：不存在「status 是活跃态而 detail 标了终态旗标」的行', async () => {
    await request(makeApp()).patch(`/api/brain/acceptance/runs/${RUN_KEY}/abandon`)
      .send({ reason: '反二义检查', by: 'alex' });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM acceptance_runs
        WHERE status IN ('pending','in_review')
          AND (detail ? 'abandoned_at' OR detail ? 'stale_at' OR detail ? 'expired_at')`
    );
    expect(rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: 登记并跑红**

`packages/brain/vitest.config.js` 追加：

```js
  'src/__tests__/integration/acceptance-lifecycle.integration.test.js',
```

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-lifecycle.integration.test.js
```

预期：FAIL 404（端点不存在）。

- [ ] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/integration/acceptance-lifecycle.integration.test.js packages/brain/vitest.config.js
git commit -m "test(acceptance): 显式作废端点 failing test [task b35bfa0c]"
```

- [ ] **Step 4: 实现作废端点**

在 `createAcceptanceInternalRouter` 里 `router.post('/ai-results', …)` 之后插入：

```js
  router.patch('/runs/:run_key/abandon', async (req, res) => {
    const { reason, by } = req.body || {};
    if (!reason || !by) return res.status(400).json({ error: 'reason and by are required' });
    try {
      const { rows } = await pool.query(
        `UPDATE acceptance_runs
            SET status = 'abandoned',
                detail = COALESCE(detail, '{}'::jsonb) || $1::jsonb,
                updated_at = NOW()
          WHERE run_key = $2 RETURNING run_key, status`,
        [JSON.stringify({ abandoned_reason: reason, abandoned_by: by, abandoned_at: new Date().toISOString() }), req.params.run_key]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'run not found' });
      return res.json({ run: rows[0] });
    } catch (err) {
      console.error('[acceptance] PATCH /abandon error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });
```

留痕三项与 `status='abandoned'` 在同一条 UPDATE 里，保证 A10④ 的反二义断言恒成立——终态是 `status` 取值，`detail` 只记原因。

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-lifecycle.integration.test.js
```

预期：4 例全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/routes/acceptance.js
git commit -m "feat(acceptance): 显式作废端点（→abandoned 三项留痕）[task b35bfa0c]"
```

---

### Task 11: `review-ack` / `review-closed` 端点（A15②③⑤⑦）

| 端点 | 主体 | 前置闸 | 结果 |
|---|---|---|---|
| `POST /runs/:run_key/review-ack` | 该 run 的人列提交人（`X-Staff-Identity`） | 无 | 往 `detail.review_acks[]` 追加 |
| `PATCH /runs/:run_key/review-closed` | 发起人或主理人；员工身份 → **403** | 全部人列提交人已 ack **或** 距 `adjudicated_at` 满 24h | 落 `detail.review_closed_at/review_closed_by` |

24h 兜底是防死锁的：员工零 ack 时，一个不配合的员工能把整条发版链锁死。

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`
- Test: `packages/brain/src/__tests__/integration/acceptance-review-closure.integration.test.js`

- [ ] **Step 1: 写 failing 集成测试**

新建 `packages/brain/src/__tests__/integration/acceptance-review-closure.integration.test.js`：

```js
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `review-itest-${process.pid}`;
const OWNER = 'alex';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

/** 两个员工各提交过人列，发起人是 initiator */
async function seed({ adjudicatedHoursAgo = 1 } = {}) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  const detail = {
    created_by: 'initiator',
    adjudicated_at: new Date(Date.now() - adjudicatedHoursAgo * 3600_000).toISOString(),
  };
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, status, detail)
     VALUES ($1,'复盘闭环','adjudicated',$2::jsonb) RETURNING id`,
    [RUN_KEY, JSON.stringify(detail)]
  );
  for (const [key, staff] of [['S3-c1', 'staff-a'], ['S8-c4', 'staff-b']]) {
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name, result, submitted_by)
       VALUES ($1,$2,'FR',$2,'通过',$3)`,
      [rows[0].id, key, staff]
    );
  }
}

const ack = (who) => request(makeApp())
  .post(`/api/brain/acceptance/runs/${RUN_KEY}/review-ack`).set('X-Staff-Identity', who).send({});
const close = (who) => request(makeApp())
  .patch(`/api/brain/acceptance/runs/${RUN_KEY}/review-closed`).set('X-Staff-Identity', who).send({});

describe('A15 复盘闭环', () => {
  beforeEach(() => seed());
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('A15② 员工身份打 review-closed → 403', async () => {
    const res = await close('staff-a');
    expect(res.status).toBe(403);
  });

  it('A15③ 未 ack 且未满 24h → 403', async () => {
    const res = await close('initiator');
    expect(res.status).toBe(403);
    expect(res.body.pending_acks.sort()).toEqual(['staff-a', 'staff-b']);
  });

  it('A15③ 全员 ack 后发起人 → 200 且留痕两项', async () => {
    expect((await ack('staff-a')).status).toBe(200);
    expect((await ack('staff-b')).status).toBe(200);
    const res = await close('initiator');
    expect(res.status).toBe(200);

    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].detail.review_closed_by).toBe('initiator');
    expect(rows[0].detail.review_closed_at).toBeTruthy();
    expect(rows[0].detail.review_acks.map((a) => a.by).sort()).toEqual(['staff-a', 'staff-b']);
  });

  it('A15⑤ 零 ack 但 adjudicated_at 回拨 25h → 发起人打 review-closed 必须 200（防死锁）', async () => {
    await seed({ adjudicatedHoursAgo: 25 });
    const res = await close('initiator');
    expect(res.status).toBe(200);
  });

  it('主理人身份任何时候都能关（发起人不在时不锁死）', async () => {
    const res = await close(OWNER);
    expect(res.status).toBe(200);
  });

  it('review-ack 重复打不产生重复条目', async () => {
    await ack('staff-a');
    await ack('staff-a');
    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].detail.review_acks).toHaveLength(1);
  });

  it('非本 run 人列提交人打 review-ack → 403', async () => {
    const res = await ack('staff-x');
    expect(res.status).toBe(403);
  });

  it('缺 X-Staff-Identity → 401', async () => {
    const res = await request(makeApp())
      .patch(`/api/brain/acceptance/runs/${RUN_KEY}/review-closed`).send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 登记并跑红**

`packages/brain/vitest.config.js` 追加：

```js
  'src/__tests__/integration/acceptance-review-closure.integration.test.js',
```

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_OWNER_IDENTITY=alex npx vitest run \
  --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-review-closure.integration.test.js
```

预期：全 FAIL 404。

- [ ] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/integration/acceptance-review-closure.integration.test.js packages/brain/vitest.config.js
git commit -m "test(acceptance): review-ack/review-closed 六场景 failing test [task b35bfa0c]"
```

- [ ] **Step 4: 实现两个端点**

在 `routes/acceptance.js` 的常量段（`SOURCES` 之后）加入：

```js
/** 主理人身份：任何时候都能关复盘，防止发起人不在把发版链锁死 */
const OWNER_IDENTITY = process.env.ACCEPTANCE_OWNER_IDENTITY || 'alex';
const REVIEW_ACK_FALLBACK_HOURS = 24;

/** 该 run 的人列提交人集合（= 需要 ack 的员工） */
async function loadSubmitters(q, runId) {
  const { rows } = await q.query(
    `SELECT DISTINCT submitted_by FROM acceptance_checks
      WHERE run_id = $1 AND submitted_by IS NOT NULL`, [runId]
  );
  return rows.map((r) => r.submitted_by);
}
```

在作废端点之后插入：

```js
  router.post('/runs/:run_key/review-ack', async (req, res) => {
    const identity = req.get('X-Staff-Identity');
    if (!identity) return res.status(401).json({ error: 'X-Staff-Identity required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, detail FROM acceptance_runs WHERE run_key = $1 FOR UPDATE', [req.params.run_key]
      );
      if (rows.length === 0) { await safeRollback(client); return res.status(404).json({ error: 'run not found' }); }
      const submitters = await loadSubmitters(client, rows[0].id);
      if (!submitters.includes(identity)) {
        await safeRollback(client);
        return res.status(403).json({ error: 'only human-column submitters can ack', identity });
      }
      const acks = rows[0].detail?.review_acks || [];
      if (!acks.some((a) => a.by === identity)) {
        acks.push({ by: identity, at: new Date().toISOString() });
      }
      await client.query(
        `UPDATE acceptance_runs SET detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ review_acks: acks }), rows[0].id]
      );
      await client.query('COMMIT');
      return res.json({ review_acks: acks });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] POST /review-ack error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  router.patch('/runs/:run_key/review-closed', async (req, res) => {
    const identity = req.get('X-Staff-Identity');
    if (!identity) return res.status(401).json({ error: 'X-Staff-Identity required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, detail FROM acceptance_runs WHERE run_key = $1 FOR UPDATE', [req.params.run_key]
      );
      if (rows.length === 0) { await safeRollback(client); return res.status(404).json({ error: 'run not found' }); }
      const detail = rows[0].detail || {};

      // A15②：主体只能是发起人或主理人；员工一律 403
      const isOwner = identity === OWNER_IDENTITY;
      if (!isOwner && identity !== detail.created_by) {
        await safeRollback(client);
        return res.status(403).json({ error: 'only initiator or owner can close review', identity });
      }

      // A15③⑤：全员 ack 或距 adjudicated_at 满 24h（后者是防死锁兜底）
      const submitters = await loadSubmitters(client, rows[0].id);
      const acked = new Set((detail.review_acks || []).map((a) => a.by));
      const pending = submitters.filter((s) => !acked.has(s));
      const adjudicatedAt = detail.adjudicated_at ? new Date(detail.adjudicated_at).getTime() : null;
      const fallbackReached = adjudicatedAt != null
        && Date.now() - adjudicatedAt >= REVIEW_ACK_FALLBACK_HOURS * 3600_000;
      if (!isOwner && pending.length > 0 && !fallbackReached) {
        await safeRollback(client);
        return res.status(403).json({ error: 'review not acknowledged yet', pending_acks: pending });
      }

      await client.query(
        `UPDATE acceptance_runs SET detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ review_closed_at: new Date().toISOString(), review_closed_by: identity }), rows[0].id]
      );
      await client.query('COMMIT');
      return res.json({ review_closed_by: identity });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] PATCH /review-closed error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });
```

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_OWNER_IDENTITY=alex npx vitest run \
  --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-review-closure.integration.test.js
```

预期：8 例全 PASS。

- [ ] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/routes/acceptance.js
git commit -m "feat(acceptance): review-ack/review-closed 端点与 24h 防死锁兜底 [task b35bfa0c]"
```

---

### Task 12: 建单期前置校验与逃生阀（A15①⑥⑦ / A16②）

三条 fail-closed（宁可不建单也不建错单）：上一轮未闭环复盘 → 409；`force_reason` ≥20 字才放行并留痕；`tenant_account` 必须在验收专用租户白名单里，**`ACCEPTANCE_TENANT_ALLOWLIST` env 缺失时拒绝一切建单，不是降级放行**。

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`（`POST /runs` 前置）
- Test: `packages/brain/src/__tests__/integration/acceptance-create-gate.integration.test.js`

- [ ] **Step 1: 写 failing 集成测试**

新建 `packages/brain/src/__tests__/integration/acceptance-create-gate.integration.test.js`：

```js
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const GP = `gp-gate-${process.pid}`;
const PREV = `gate-prev-${process.pid}`;
const NEXT = `gate-next-${process.pid}`;
const CHECKS = [{ check_key: 'S3-c1', kind: 'FR', name: '权限三项已开启' }];
const HEAD = {
  tenant_account: 'acc-verify-01',
  backend_sha: 'a'.repeat(40), backend_sha_src2: 'a'.repeat(40),
  frontend_sha: 'b'.repeat(40), frontend_sha_src2: 'b'.repeat(40),
  spec_sha: 'c'.repeat(64),
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

const create = (body) => request(makeApp()).post('/api/brain/acceptance/runs').send({
  run_key: NEXT, title: '下一轮', gp_id: GP, checks: CHECKS, detail: HEAD, ...body,
});

async function seedPrev({ closed }) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = ANY($1)', [[PREV, NEXT]]);
  await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, gp_id, status, detail)
     VALUES ($1,'上一轮',$2,'adjudicated',$3::jsonb)`,
    [PREV, GP, JSON.stringify(closed ? { review_closed_at: new Date().toISOString() } : {})]
  );
}

describe('A15①⑥⑦ 建单前置与逃生阀', () => {
  beforeEach(() => seedPrev({ closed: false }));
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = ANY($1)', [[PREV, NEXT]]);
    await pool.end();
  });

  it('A15① 上一轮未闭环复盘 → 409 且无新行', async () => {
    const res = await create({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('previous_review_not_closed');
    const { rows } = await pool.query('SELECT 1 FROM acceptance_runs WHERE run_key = $1', [NEXT]);
    expect(rows).toHaveLength(0);
  });

  it('A15⑥ force_reason <20 字 → 仍 409', async () => {
    const res = await create({ force_reason: '急着发版', force_opened_by: 'alex' });
    expect(res.status).toBe(409);
  });

  it('A15⑥⑦ force_reason ≥20 字 → 放行 201 且三项留痕', async () => {
    const reason = '上一轮验收人休假联系不上，本轮为客户演示不可延期，风险由我承担';
    const res = await create({ force_reason: reason, force_opened_by: 'alex' });
    expect(res.status).toBe(201);
    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [NEXT]);
    expect(rows[0].detail.force_reason).toBe(reason);
    expect(rows[0].detail.force_opened_by).toBe('alex');
    expect(rows[0].detail.force_opened_at).toBeTruthy();
  });

  it('上一轮已闭环 → 无需 force 直接 201', async () => {
    await seedPrev({ closed: true });
    expect((await create({})).status).toBe(201);
  });

  it('A16② 非专用租户账号 → 非 200 且无新行', async () => {
    await seedPrev({ closed: true });
    const res = await create({ detail: { ...HEAD, tenant_account: 'prod-customer-9' } });
    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT 1 FROM acceptance_runs WHERE run_key = $1', [NEXT]);
    expect(rows).toHaveLength(0);
  });

  it('ACCEPTANCE_TENANT_ALLOWLIST 缺失 → 拒绝建单（fail-closed，不是降级放行）', async () => {
    await seedPrev({ closed: true });
    const saved = process.env.ACCEPTANCE_TENANT_ALLOWLIST;
    delete process.env.ACCEPTANCE_TENANT_ALLOWLIST;
    try {
      const res = await create({});
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('acceptance_tenant_allowlist_unset');
    } finally {
      process.env.ACCEPTANCE_TENANT_ALLOWLIST = saved;
    }
  });
});
```

- [ ] **Step 2: 登记并跑红**

`packages/brain/vitest.config.js` 追加：

```js
  'src/__tests__/integration/acceptance-create-gate.integration.test.js',
```

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_TENANT_ALLOWLIST=acc-verify-01,acc-verify-02 \
  npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-create-gate.integration.test.js
```

预期：FAIL（建单一律返 201）。

- [ ] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/integration/acceptance-create-gate.integration.test.js packages/brain/vitest.config.js
git commit -m "test(acceptance): 建单前置校验与逃生阀 failing test [task b35bfa0c]"
```

- [ ] **Step 4: 实现前置校验**

在 `routes/acceptance.js` 的常量段追加：

```js
const FORCE_REASON_MIN_CHARS = 20;

/** 验收专用租户白名单（A16②）。env 缺失 = 拒绝一切建单，绝不降级放行 */
export function loadTenantAllowlist() {
  const raw = process.env.ACCEPTANCE_TENANT_ALLOWLIST;
  if (!raw || raw.trim() === '') return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
```

`POST /runs` 里 `const client = await pool.connect();` 之前插入（先读 body 里的 `detail`、`force_reason`、`force_opened_by`）：

```js
    const { detail: head = {}, force_reason, force_opened_by } = req.body || {};

    const allowlist = loadTenantAllowlist();
    if (allowlist === null) {
      return res.status(503).json({
        error: 'acceptance_tenant_allowlist_unset',
        hint: 'ACCEPTANCE_TENANT_ALLOWLIST 未配置；缺白名单时拒绝建单而非放行',
      });
    }
    if (!allowlist.includes(head.tenant_account)) {
      return res.status(400).json({ error: 'tenant_account_not_allowed', tenant_account: head.tenant_account || null });
    }

    if (gp_id) {
      const { rows: prevRuns } = await pool.query(
        `SELECT run_key, detail FROM acceptance_runs
          WHERE gp_id = $1 AND run_key <> $2 ORDER BY created_at DESC LIMIT 1`,
        [gp_id, run_key]
      );
      const prevRun = prevRuns[0];
      if (prevRun && !prevRun.detail?.review_closed_at) {
        // A15⑥ 逃生阀：force_reason ≥20 字（按字符数，中文按字计）才放行，并留痕三项
        const forced = typeof force_reason === 'string' && [...force_reason].length >= FORCE_REASON_MIN_CHARS;
        if (!forced) {
          return res.status(409).json({
            error: 'previous_review_not_closed',
            previous_run_key: prevRun.run_key,
            hint: `上一轮复盘未闭环；如需强开请给 force_reason（≥${FORCE_REASON_MIN_CHARS} 字）`,
          });
        }
        head.force_reason = force_reason;
        head.force_opened_by = force_opened_by || null;
        head.force_opened_at = new Date().toISOString();
      }
    }
```

同时把 `INSERT INTO acceptance_runs` 那条（`:206-210`）加上 `detail` 列：

```js
      const { rows: runRows } = await client.query(
        `INSERT INTO acceptance_runs (run_key, title, gp_id, line, surface, version, source, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [run_key, title, gp_id || null, line || null, surface || null, version || null, source, JSON.stringify(head)]
      );
```

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_TENANT_ALLOWLIST=acc-verify-01,acc-verify-02 \
  npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-create-gate.integration.test.js
```

预期：6 例全 PASS。

- [ ] **Step 6: 把两个 env 加进测试环境（不落 `.env` 文件——`.gitignore` 排除 `.env*`，落文件等于 CI 里没有）**

`packages/brain/vitest.config.js` 里 Task 7 Step 3 建的 `env: {}` 块追加两行：

```js
      // 建单是 fail-closed 的：白名单 env 缺失时一律 503，测试环境必须显式给值
      ACCEPTANCE_TENANT_ALLOWLIST: 'acc-verify-01,acc-verify-02',
      ACCEPTANCE_OWNER_IDENTITY: 'alex',
```

`acceptance.integration.test.js` 与 `acceptance-run-scope.integration.test.js` 的建单调用补上单头：

```js
      detail: { tenant_account: 'acc-verify-01' },
```

- [ ] **Step 7: 跑整个 integration 目录确认无连带破坏**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_SPEC_PATH=$PWD/src/__tests__/fixtures/acceptance/line02-android.yaml \
  npx vitest run --config vitest.integration.config.js src/__tests__/integration/
```

预期：`src/__tests__/integration/` 下全部 PASS。

- [ ] **Step 8: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/routes/acceptance.js packages/brain/vitest.config.js \
        packages/brain/src/__tests__/integration/acceptance.integration.test.js \
        packages/brain/src/__tests__/integration/acceptance-run-scope.integration.test.js
git commit -m "feat(acceptance): 建单期复盘闭环闸/逃生阀/租户白名单 fail-closed [task b35bfa0c]"
```

---

### Task 13: 版本戳落库与冻结锁（A9 / J12-A）

- 落库六项：`detail.backend_sha` / `backend_sha_src2` / `frontend_sha` / `frontend_sha_src2` / `spec_sha` + 表上已有的 `version` 列。
- **建单期双源对账**：任一组两源不等 → 拒绝建单（4xx + 无新行）。两源的**取数实现属 D2**，D1 只做校验与落库——接口按「调用方传入两个 sha」设计，D1 不自己去拉 GitHub API。
- **冻结锁**：staging 重新部署（sha 变）或规程改版（`spec_sha` 变）→ 人列提交返 409 且 run 转 `stale`。
- `stale`/`expired`/`abandoned` 三态永远达不到 `human_complete`，因此不是活跃 run，不持防锚定锁（读侧裁剪属 D3）。

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`（`POST /runs` 落库校验、`submitAcceptanceResults` 冻结锁）
- Test: `packages/brain/src/__tests__/integration/acceptance-version-freeze.integration.test.js`

- [ ] **Step 1: 写 failing 集成测试（A9 + 冻结锁）**

新建 `packages/brain/src/__tests__/integration/acceptance-version-freeze.integration.test.js`：

```js
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `freeze-itest-${process.pid}`;
const BE = 'a'.repeat(40);
const FE = 'b'.repeat(40);
const SPEC = 'c'.repeat(64);
const HEAD = {
  tenant_account: 'acc-verify-01',
  backend_sha: BE, backend_sha_src2: BE,
  frontend_sha: FE, frontend_sha_src2: FE,
  spec_sha: SPEC,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

const create = (detail) => request(makeApp()).post('/api/brain/acceptance/runs').send({
  run_key: RUN_KEY, title: '版本戳', version: '2.1.19',
  checks: [{ check_key: 'S3-c1', kind: 'FR', name: 'x' }],
  detail: { ...HEAD, ...detail },
});

const submit = (shas) => request(makeApp()).post('/api/brain/acceptance/results').send({
  run_key: RUN_KEY, results: [{ check_key: 'S3-c1', result: '通过', submitted_by: 'staff-a' }], ...shas,
});

describe('A9 版本戳落库与冻结锁', () => {
  beforeEach(async () => { await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]); });
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('A9 六项版本标识落库且非空，两组 sha 各自组内相等且为 40 位', async () => {
    expect((await create({})).status).toBe(201);
    const { rows } = await pool.query(
      'SELECT version, detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]
    );
    const d = rows[0].detail;
    expect(rows[0].version).toBe('2.1.19');
    for (const k of ['backend_sha', 'backend_sha_src2', 'frontend_sha', 'frontend_sha_src2', 'spec_sha']) {
      expect(d[k]).toBeTruthy();
    }
    expect(d.backend_sha).toBe(d.backend_sha_src2);
    expect(d.frontend_sha).toBe(d.frontend_sha_src2);
    expect(d.backend_sha).toHaveLength(40);
    expect(d.frontend_sha).toHaveLength(40);
  });

  it('backend 双源不等 → 拒绝建单且无新行', async () => {
    const res = await create({ backend_sha_src2: 'd'.repeat(40) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sha_source_mismatch');
    const { rows } = await pool.query('SELECT 1 FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows).toHaveLength(0);
  });

  it('frontend 双源不等 → 同样拒绝', async () => {
    expect((await create({ frontend_sha_src2: 'e'.repeat(40) })).status).toBe(400);
  });

  it('sha 不是 40 位 → 拒绝建单', async () => {
    expect((await create({ backend_sha: 'abc', backend_sha_src2: 'abc' })).status).toBe(400);
  });

  it('sha 未变 → 人列提交正常 200', async () => {
    await create({});
    expect((await submit({ backend_sha: BE, frontend_sha: FE, spec_sha: SPEC })).status).toBe(200);
  });

  it('staging 重新部署（backend_sha 变）→ 提交 409 且 run 转 stale', async () => {
    await create({});
    const res = await submit({ backend_sha: 'f'.repeat(40), frontend_sha: FE, spec_sha: SPEC });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('run_frozen_version_changed');
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('stale');
  });

  it('规程改版（spec_sha 变）→ 同样 409 且转 stale', async () => {
    await create({});
    const res = await submit({ backend_sha: BE, frontend_sha: FE, spec_sha: 'f'.repeat(64) });
    expect(res.status).toBe(409);
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('stale');
  });

  it('run 有版本戳但提交不带 sha → 400（不静默跳过冻结锁）', async () => {
    await create({});
    const res = await submit({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sha_required_for_freeze_check');
  });

  it('stale run 永远达不到 human_complete（不是活跃 run）', async () => {
    await create({});
    await submit({ backend_sha: 'f'.repeat(40), frontend_sha: FE, spec_sha: SPEC });
    await submit({ backend_sha: BE, frontend_sha: FE, spec_sha: SPEC });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('stale');
  });
});
```

- [ ] **Step 2: 登记并跑红**

`packages/brain/vitest.config.js` 追加：

```js
  'src/__tests__/integration/acceptance-version-freeze.integration.test.js',
```

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/acceptance-version-freeze.integration.test.js
```

预期：双源对账与冻结锁相关的 6 例 FAIL。

- [ ] **Step 3: 提交 Red commit**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/__tests__/integration/acceptance-version-freeze.integration.test.js packages/brain/vitest.config.js
git commit -m "test(acceptance): 版本戳双源对账与冻结锁 failing test [task b35bfa0c]"
```

- [ ] **Step 4: 实现建单期双源对账**

在 `routes/acceptance.js` 的常量段追加：

```js
const SHA40 = /^[0-9a-f]{40}$/;

/**
 * 建单期双源对账（J12-A）。源① 是被测系统自报，源② 是构建侧 GitHub API；
 * 两个源的取数实现属 D2，D1 只校验与落库。返回 null = 放行。
 */
export function validateVersionStamps(head) {
  for (const [a, b] of [['backend_sha', 'backend_sha_src2'], ['frontend_sha', 'frontend_sha_src2']]) {
    if (!SHA40.test(head[a] || '') || !SHA40.test(head[b] || '')) {
      return { error: 'sha_format_invalid', field: a };
    }
    if (head[a] !== head[b]) {
      return { error: 'sha_source_mismatch', field: a, src1: head[a], src2: head[b] };
    }
  }
  if (!head.spec_sha) return { error: 'spec_sha_required' };
  return null;
}
```

`POST /runs` 里，租户白名单校验之后、复盘闭环闸之前插入：

```js
    const stampError = validateVersionStamps(head);
    if (stampError) return res.status(400).json(stampError);
```

- [ ] **Step 5: 实现收单期冻结锁**

`submitAcceptanceResults` 里，取到 `scopedRunId` 的那条查询改为一并取 `status` 与 `detail`：

```js
    const { rows: runRows } = await client.query(
      'SELECT id, status, detail FROM acceptance_runs WHERE run_key = $1', [run_key]
    );
```

紧接着（`const scopedRunId = runRows[0].id;` 之后）插入冻结锁：

```js
    // 冻结锁（J12-A）：run 一旦带了版本戳，人列提交就必须自报当前 sha；
    // 对不上说明 staging 重新部署或规程改版，这一轮的判定不再指向同一个被测对象。
    const runDetail = runRows[0].detail || {};
    if (runDetail.backend_sha) {
      const cur = {
        backend_sha: options.backend_sha,
        frontend_sha: options.frontend_sha,
        spec_sha: options.spec_sha,
      };
      if (!cur.backend_sha || !cur.frontend_sha || !cur.spec_sha) {
        await safeRollback(client);
        throw new AcceptanceResultsError(400, {
          error: 'sha_required_for_freeze_check',
          hint: '该 run 带版本戳，提交须自报 backend_sha/frontend_sha/spec_sha',
        });
      }
      const changed = ['backend_sha', 'frontend_sha', 'spec_sha'].filter((k) => cur[k] !== runDetail[k]);
      if (changed.length > 0) {
        await client.query(
          `UPDATE acceptance_runs
              SET status = 'stale',
                  detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb,
                  updated_at = NOW()
            WHERE id = $2`,
          [JSON.stringify({ stale_reason: changed, stale_at: new Date().toISOString() }), scopedRunId]
        );
        await client.query('COMMIT');
        throw new AcceptanceResultsError(409, { error: 'run_frozen_version_changed', changed });
      }
    }
```

同时把签名的解构改为保留完整 options（冻结锁要读三个 sha）：

```js
export async function submitAcceptanceResults(pool, results, options = {}) {
  const { run_key } = options;
```

两个 results 端点的调用改为整体透传：

```js
      const result = await submitAcceptanceResults(pool, req.body?.results, {
        run_key: req.body?.run_key,
        backend_sha: req.body?.backend_sha,
        frontend_sha: req.body?.frontend_sha,
        spec_sha: req.body?.spec_sha,
      });
```

`stale` 之后再提交也不会回到活跃态——`computeRunStatus` 对非活跃前态原样返回（Task 1 已实现并测过）。

- [ ] **Step 6: 给两个既有集成测试补版本戳（`validateVersionStamps` 现在对所有建单生效）**

`acceptance.integration.test.js` 与 `acceptance-run-scope.integration.test.js` 里 Task 12 加的 `detail` 补全成完整单头：

```js
      detail: {
        tenant_account: 'acc-verify-01',
        backend_sha: 'a'.repeat(40), backend_sha_src2: 'a'.repeat(40),
        frontend_sha: 'b'.repeat(40), frontend_sha_src2: 'b'.repeat(40),
        spec_sha: 'c'.repeat(64),
      },
```

这两个文件里所有 `POST /acceptance/results`、`POST /api/brain/acceptance/results` 与 `submitAcceptanceResults(...)` 调用，同批补上冻结锁要求的三个 sha：

```js
      backend_sha: 'a'.repeat(40), frontend_sha: 'b'.repeat(40), spec_sha: 'c'.repeat(64),
```

（`submitAcceptanceResults` 走 options：`{ run_key: RUN_KEY, backend_sha: 'a'.repeat(40), frontend_sha: 'b'.repeat(40), spec_sha: 'c'.repeat(64) }`。）

- [ ] **Step 7: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch ACCEPTANCE_SPEC_PATH=$PWD/src/__tests__/fixtures/acceptance/line02-android.yaml \
  npx vitest run --config vitest.integration.config.js src/__tests__/integration/
```

预期：整个 integration 目录 PASS（含 9 例冻结锁）。

- [ ] **Step 8: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/src/routes/acceptance.js \
        packages/brain/src/__tests__/integration/acceptance.integration.test.js \
        packages/brain/src/__tests__/integration/acceptance-run-scope.integration.test.js
git commit -m "feat(acceptance): 版本戳双源对账落库 + 冻结锁转 stale [task b35bfa0c]"
```

---

### Task 14: 版本 bump 与 DevGate 三件套

Brain 版本四处同步（`scripts/check-version-sync.sh` 逐处校验），本刀是 feature 级改动，`1.267.247` → `1.268.0`。

**Files:**
- Modify: `packages/brain/package.json:48`
- Modify: `packages/brain/package-lock.json`（第 3 行与第 9 行**两处**）
- Modify: `.brain-versions`（追加一行）
- Modify: `DEFINITION.md:11`

- [ ] **Step 1: 改四处版本号**

`packages/brain/package.json`：

```json
  "version": "1.268.0"
```

`packages/brain/package-lock.json` 第 3 行与第 9 行（两处都要，只改一处是 `version-management` 记过的经典陷阱）：

```json
  "version": "1.268.0",
```

`.brain-versions` 追加最后一行：

```
1.268.0
```

`DEFINITION.md:11`：

```markdown
**Brain 版本**: 1.268.0
```

- [ ] **Step 2: 跑 DevGate 三件套**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs sprints/08070956-d1-acceptance-data-layer/dod.md
```

预期：前两条全绿（`EXPECTED_SCHEMA_VERSION=392` 与 migrations 最高编号一致、四处版本相等）；第三条在 Task 15 写完 dod.md 之前会报文件不存在，**Task 15 之后回来重跑必须绿**。

- [ ] **Step 3: 跑全量 brain 单测确认无连带破坏**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf/packages/brain
DB_NAME=cecelia_scratch npm test
```

预期：无新增失败（`vitest.config.js` 的 exclude 段列的 pre-existing 失败不算）。

- [ ] **Step 4: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): bump 1.267.247 → 1.268.0（D1 数据层地基）[task b35bfa0c]"
```

---

### Task 15: DoD 清单

`packages/quality/scripts/devgate/check-dod-mapping.cjs` 要求每条验收项的**下一行**是 `Test:` 字段，只接受 `tests/…` / `contract:<RCI_ID>` / `manual:<EVIDENCE_ID>` 三种；`manual:` 命令必须 CI 兼容（白名单仅 node/npm/curl/bash/psql）。三要素：至少 1 个 `[BEHAVIOR]`、push 前全 `[x]`、feat PR 含 `*.test.*`。

**Files:**
- Create: `sprints/08070956-d1-acceptance-data-layer/dod.md`

- [ ] **Step 1: 写 dod.md**

新建 `sprints/08070956-d1-acceptance-data-layer/dod.md`：

```markdown
# DoD：D1 · 验收一体两面数据层地基与状态机

> task b35bfa0c-c798-45a5-80dc-16f12e35ca6d｜anchor journey 2fa4d085 / gp 7790f728 / step 817f59f5
> 规格 SSOT = sprints/f2-acceptance-two-column/proposal-v7-final.md 的「D1」节

- [ ] [BEHAVIOR] A10⑤ 人列 36 格填满且含「不通过」时 run 落 human_complete，绝不落 failed
  Test: tests/ packages/brain/src/__tests__/integration/acceptance-state-machine.integration.test.js
- [ ] [BEHAVIOR] A10① status CHECK 含 7 值 + 2 个只读历史兼容值；AI 四列与 runs.detail 落库且全 nullable
  Test: tests/ packages/brain/src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js
- [ ] [BEHAVIOR] migration 392 down 在无新格号数据时可逆、有跨 run 重复格号时 fail-fast 报错
  Test: tests/ packages/brain/src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js
- [ ] [BEHAVIOR] A1/A3 同 gp 第二轮建单不再 23505；向 run A 提交 S3-c1 后 run B 的 S3-c1 仍为 NULL
  Test: tests/ packages/brain/src/__tests__/integration/acceptance-run-scope.integration.test.js
- [ ] [BEHAVIOR] A5 九组合矩阵逐行判定正确；Q0′（AI 缺格）在人列三种取值下恒判「未定」
  Test: tests/ packages/brain/src/__tests__/acceptance-cell-state.test.js
- [ ] [BEHAVIOR] gate_verdict 绿当且仅当全格绿；hard 格非绿列进 red_cells；ai_incomplete 时闸拦且理由为 ai_run_infra_error
  Test: tests/ packages/brain/src/__tests__/acceptance-gate-verdict.test.js
- [ ] [BEHAVIOR] 生成器对 line02-android.yaml 产出恰 36 行、零个 S14-*；S7 加 fixedNa 后降到 34 行
  Test: tests/ packages/brain/src/__tests__/acceptance-spec.test.js
- [ ] [BEHAVIOR] A4③⑥⑦ reason=human_only 用在非 human_only 格 400；36 个建行格逐格提交 scenario_not_triggered 全部 400
  Test: tests/ packages/brain/src/__tests__/acceptance-ai-reason.test.js
- [ ] [BEHAVIOR] A4⑧ mandatory 场景码未勾齐时整 run 拒收 AI 回写（409 + 缺失清单），且一格都不落库
  Test: tests/ packages/brain/src/__tests__/integration/acceptance-scenario-gate.integration.test.js
- [ ] [BEHAVIOR] A10②③④ pending 超 48h 转 expired；作废端点落 abandoned 三项留痕；活跃态行不带终态旗标
  Test: tests/ packages/brain/src/__tests__/integration/acceptance-aging-expire.integration.test.js
- [ ] [BEHAVIOR] A15②③⑤ 员工打 review-closed 403；未 ack 未满 24h 403；全员 ack 或 24h 兜底后 200
  Test: tests/ packages/brain/src/__tests__/integration/acceptance-review-closure.integration.test.js
- [ ] [BEHAVIOR] A15①⑥⑦/A16② 上轮未闭环建单 409；force_reason ≥20 字放行留痕；非白名单租户拒绝；env 缺失 fail-closed
  Test: tests/ packages/brain/src/__tests__/integration/acceptance-create-gate.integration.test.js
- [ ] [BEHAVIOR] A9 六项版本标识落库非空、双源不等拒绝建单；sha/spec_sha 变更时提交 409 且 run 转 stale
  Test: tests/ packages/brain/src/__tests__/integration/acceptance-version-freeze.integration.test.js
- [ ] [BEHAVIOR] A17① yaml 三个 scenario_class 集合与台账逐格相等，opportunistic 恰为空集
  Test: tests/ zenithjoy-workspace scripts/acceptance-spec/__tests__/spec-fields.test.mjs
- [ ] DevGate 三件套通过（facts-check / check-version-sync / check-dod-mapping）
  Test: manual: bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh"
- [ ] migration 392 在 scratch 库上跑通且 schema_version 记到 392
  Test: manual: psql -d cecelia_scratch -c "SELECT version FROM schema_version WHERE version='392'"
- [ ] CI 全绿，cecelia PR 与 zenithjoy PR 同批合并
  Test: manual: bash -c "gh pr checks --watch"
```

- [ ] **Step 2: 跑 DoD 校验**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
node packages/quality/scripts/devgate/check-dod-mapping.cjs sprints/08070956-d1-acceptance-data-layer/dod.md
```

预期：所有验收项都有 Test 映射，退出码 0。

- [ ] **Step 3: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add sprints/08070956-d1-acceptance-data-layer/dod.md
git commit -m "docs(dod): D1 数据层地基验收清单 [task b35bfa0c]"
```

- [ ] **Step 4: 逐项勾 `[x]` 并开 PR**

跑完所有测试、DevGate 全绿后，把 dod.md 里 17 条全部改成 `- [x]`（push 前必须全勾），然后：

```bash
cd /Users/administrator/worktrees/cecelia/session-084aafdf
git add sprints/08070956-d1-acceptance-data-layer/dod.md
git commit -m "docs(dod): D1 验收项全部通过 [task b35bfa0c]"
git push -u origin cp-08070958-d1-acceptance-data-layer
gh pr create --title "feat(acceptance): D1 验收一体两面数据层地基与状态机 [task b35bfa0c]" \
  --body "GP 7790f728 的地基刀，阻塞 D2/D3/D4/D5。migration 392（AI 四列 + runs.detail + 7 值 CHECK + UNIQUE(run_id,check_key)）与 acceptance.js 三元式替换同 commit。**必须与 zenithjoy PR cp-08071100-d1-acceptance-spec-fields 同批合并**：先合任一单边都会自伤。"
```

- [ ] **Step 5: 同批合并两个 PR 并回写 Brain**

两个 repo 的 CI 都全绿后（禁 `gh pr merge --admin` 绕过），先合 zenithjoy 再合 cecelia（间隔越短越好），然后：

```bash
curl -X PATCH localhost:5221/api/brain/tasks/b35bfa0c-c798-45a5-80dc-16f12e35ca6d \
  -H "Content-Type: application/json" \
  -d '{"status":"completed","result":{"pr_url":"<cecelia PR>","zenithjoy_pr":"<zj PR>","merged":true}}'
```

Brain 改动必须走 `brain-deploy.sh` 重建镜像（容器跑的是镜像快照不是 mount），deploy 前 `node --check` 冒烟。

---

## 不做什么（防 scope 蔓延）

以下全部**不在 D1**，即使实现时看起来「顺手就能做」：

| 属于 | 不做的事 |
|---|---|
| **D2** | AI 打表器的任何改动：`cells-map.mjs` 的 `action` 枚举收窄、删 `signup_flow`、二次采集、自持计时、S4-c2 三档取数、打表器 workflow、Playwright allowlist、`ai-results` 的**采证侧**实现、staging `GET /api/version`、前端 build sha 标记 |
| **D3** | `loadChecks:147-153` / `loadRunsWithChecks:155-172` 的 SQL 列白名单裁剪、`view` 参数、gp 级跨轮闸、反代层同步、`createBearerAuth` 下沉与三 token 分权、公网端点下线。**本刀只加列不减列**，Staff Hub 现有三页面的读接口不得破坏 |
| **D4** | 九组合矩阵合看页、裁决 API、员工回显、ack/异议 note 的**页面**、侧边栏角标、建单页表头字段、`lib.mjs` 收编、聚合式分流建任务与熔断 |
| **D5** | 放行闸第三证据项、`two-column-gate.sh`、selftest workflow、`promote-all-prod.yml` 接线、四项棘轮计数 |
| **Phase 2** | 连续多轮双绿的格从员工表摘除、Kernel 融合、其余 GP 的 acceptance-spec yaml、S13-c4 受控注入根治 |

另外三条明确不做：**不删既有 21 行历史数据**、**不给 `check_key` 加格式 CHECK**（会挡死历史行）、**不新建平行的 48h 扫描 job**。

事务边界也不动：`submitAcceptanceResults` 现有的 `SELECT … FOR UPDATE` 行锁与 SAVEPOINT 保护记录的是并发提交覆盖与事务毒化两个已修 bug，改状态机时不得顺手清理。
