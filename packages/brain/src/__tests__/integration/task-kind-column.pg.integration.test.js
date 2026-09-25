/**
 * tasks.kind 真列 —— 真 PostgreSQL 验证（任务 94465721，决策 df67a9d6 / e073bdc2）。
 *
 * 结构断言（migration-466-tasks-kind-column.test.js）证明不了两件事，只能上真库：
 *   1. 466 的分批回填块真的幂等：第二次跑 0 行被改（用 xmin 证明行没被重写）
 *   2. tasks_kind_check 真的拦非法值（23514），且 467 之后已 validated
 * 顺带用真库跑一次 createRoutedTask，证明建单路径落的 kind 与注册表一致（mock 池
 * 测的是参数位，这里测的是列真的存在、值真的进去了）。
 *
 * 建库→跑全量 migrate.js→用完即删，照 base-sha-reanchor.pg.integration.test.js 的手法。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createRoutedTask } from '../../work-routing-store.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATION_466 = fileURLToPath(new URL('../../../migrations/466_tasks_kind_column.sql', import.meta.url));

let adminPool;
let pool;
let databaseName;

function quoteIdentifier(value) {
  if (!/^taskkind_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

/** 抠出 466 里的回填 DO 块，单独重放。 */
function backfillBlock() {
  const sql = readFileSync(MIGRATION_466, 'utf8');
  const m = sql.match(/DO \$\$[\s\S]*?END\s*\$\$;/);
  if (!m) throw new Error('466 里找不到回填 DO 块');
  return m[0];
}

beforeAll(async () => {
  databaseName = `taskkind_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('tasks.kind against real PostgreSQL', () => {
  it('466/467 之后：kind 列存在、tasks_kind_check 已 validated', async () => {
    const col = await pool.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'kind'`,
    );
    expect(col.rows).toHaveLength(1);
    expect(col.rows[0]).toMatchObject({ data_type: 'text', is_nullable: 'YES', column_default: null });
    const con = await pool.query(
      `SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_kind_check'`,
    );
    expect(con.rows).toHaveLength(1);
    expect(con.rows[0].convalidated).toBe(true);
    expect(con.rows[0].def).toMatch(/'agent'/);
    expect(con.rows[0].def).toMatch(/'workflow'/);
  });

  it('回填块幂等：直插 kind=NULL 的行 → 第一次填齐（按类型分 workflow/agent）→ 第二次 0 行被改', async () => {
    const seeded = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority)
       VALUES ('kind-bf-wf', 'workflow_run', 'completed', 'P2'),
              ('kind-bf-dev', 'dev', 'completed', 'P2'),
              ('kind-bf-qiumi', 'qiumi_task', 'completed', 'P2')
       RETURNING id, task_type, kind`,
    );
    expect(seeded.rows.map((r) => r.kind)).toEqual([null, null, null]);
    const ids = seeded.rows.map((r) => r.id);

    await pool.query(backfillBlock());
    const first = await pool.query(
      'SELECT id, task_type, kind, xmin::text AS xmin FROM tasks WHERE id = ANY($1::uuid[]) ORDER BY task_type',
      [ids],
    );
    expect(first.rows.map((r) => [r.task_type, r.kind])).toEqual([
      ['dev', 'agent'], ['qiumi_task', 'agent'], ['workflow_run', 'workflow'],
    ]);
    const nulls = await pool.query('SELECT count(*)::int AS n FROM tasks WHERE kind IS NULL');
    expect(nulls.rows[0].n).toBe(0);

    await pool.query(backfillBlock());
    const second = await pool.query(
      'SELECT id, kind, xmin::text AS xmin FROM tasks WHERE id = ANY($1::uuid[]) ORDER BY task_type',
      [ids],
    );
    // xmin 不变 = 行没被第二次 UPDATE 重写，这才是「幂等」而不是「结果碰巧一样」
    expect(second.rows.map((r) => r.xmin)).toEqual(first.rows.map((r) => r.xmin));
    expect(second.rows.map((r) => r.kind)).toEqual(first.rows.map((r) => r.kind));
  });

  it('非法 kind 直插被 CHECK 拒绝（23514）；合法两值与 NULL 放行', async () => {
    let err;
    try {
      await pool.query(
        `INSERT INTO tasks (title, task_type, status, priority, kind) VALUES ('kind-bad', 'dev', 'completed', 'P2', 'script')`,
      );
    } catch (e) { err = e; }
    expect(err?.code).toBe('23514');
    expect(err?.constraint).toBe('tasks_kind_check');
    const ok = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, kind)
       VALUES ('kind-ok-a', 'dev', 'completed', 'P2', 'agent'),
              ('kind-ok-w', 'dev', 'completed', 'P2', 'workflow'),
              ('kind-ok-n', 'dev', 'completed', 'P2', NULL)
       RETURNING kind`,
    );
    expect(ok.rows.map((r) => r.kind)).toEqual(['agent', 'workflow', null]);
  });

  it('createRoutedTask 真库建单：workflow_run 落 kind=workflow，research 落 agent，显式 kind 压过缺省', async () => {
    const mk = (over) => createRoutedTask(pool, {
      source: 'api',
      source_id: `taskkind-${randomUUID()}`,
      title: `kind-routed-${randomUUID().slice(0, 8)}`,
      description: 'd',
      mutation_intent: 'none',
      declared_domain: 'operations',
      metadata: {},
      task: { priority: 'P2', status: 'completed' },
      ...over,
    });
    const wf = await mk({ requested_task_type: 'workflow_run' });
    const rs = await mk({ requested_task_type: 'research', declared_domain: 'research' });
    const forced = await mk({ requested_task_type: 'workflow_run', task: { priority: 'P2', status: 'completed', kind: 'agent' } });
    const { rows } = await pool.query(
      'SELECT id, task_type, kind FROM tasks WHERE id = ANY($1::uuid[])',
      [[wf.task_id, rs.task_id, forced.task_id]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[wf.task_id]).toMatchObject({ task_type: 'workflow_run', kind: 'workflow' });
    expect(byId[rs.task_id]).toMatchObject({ task_type: 'research', kind: 'agent' });
    expect(byId[forced.task_id]).toMatchObject({ task_type: 'workflow_run', kind: 'agent' });
  });
});
