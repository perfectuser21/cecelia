/**
 * 迁移 495 真库集成测试（棒1，任务 9e785997，决策 ee4842a6/3feeae3e）——mock 测不到的三件事：
 *   1. okr_projects → projects 原样搬家（同 id）
 *   2. 历史 task_type='project' 根：子任务 payload.project_ref 命中已存在 projects 行则复用，
 *      否则以根任务自身 id 新建一行；tasks.project_id 全部回填
 *   3. 迁移可安全重放（第二次跑不报错、不产生重复行/重复回填）
 *
 * 建库→跑全量 migrate.js 建表（此时无种子数据，495 的搬家分支是空跑）→插种子数据→
 * 直接重放 495 的 SQL 文本两遍，验证"495 真正碰到数据时"的行为与幂等性。
 * 照 project-root-gate.pg.integration.test.js 的建库/删库手法。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATION_495_SQL = readFileSync(
  new URL('../../../migrations/495_projects_table_upgrade.sql', import.meta.url),
  'utf8'
);

let adminPool;
let pool;
let databaseName;
let rootId;
let child1Id;
let child2Id;
const KR_ID = 'a0000000-0000-4000-8000-00000000000c';
const SEED_PROJECT_ID = 'b0000000-0000-4000-8000-00000000000d';

function quoteIdentifier(value) {
  if (!/^projtbl_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `projtbl_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

  // 全量迁移建表（此时 495 也会跑一次，但库里没有任何 okr_projects / task_type=project 数据，
  // 搬家分支是空跑——ADD COLUMN 生效，INSERT...SELECT 与 DO 循环都是 0 行）。
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

  // 种子数据：vision→objective→key_result→okr_projects 一条；历史 project 根 + 两个子任务
  // （其中一个子任务声明 project_ref 指向种子 okr_project，另一个没有）。
  await pool.query(`INSERT INTO visions (id, title) VALUES ('a0000000-0000-4000-8000-00000000000a', 'v')`);
  await pool.query(`INSERT INTO objectives (id, vision_id, title) VALUES ('a0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a', 'o')`);
  await pool.query(`INSERT INTO key_results (id, objective_id, title) VALUES ($1, 'a0000000-0000-4000-8000-00000000000b', 'kr')`, [KR_ID]);
  await pool.query(`INSERT INTO okr_projects (id, kr_id, title, status) VALUES ($1, $2, 'seed 项目', 'active')`, [SEED_PROJECT_ID, KR_ID]);

  rootId = randomUUID();
  child1Id = randomUUID();
  child2Id = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, title, description, task_type, status, priority)
     VALUES ($1, 'legacy-root', '链的目标', 'project', 'in_progress', 'P1')`,
    [rootId]
  );
  await pool.query(
    `INSERT INTO tasks (id, title, task_type, status, priority, parent_task_id, payload)
     VALUES ($1, 'legacy-child-1', 'dev', 'queued', 'P2', $2, jsonb_build_object('project_ref', $3::text))`,
    [child1Id, rootId, SEED_PROJECT_ID]
  );
  await pool.query(
    `INSERT INTO tasks (id, title, task_type, status, priority, parent_task_id)
     VALUES ($1, 'legacy-child-2', 'dev', 'queued', 'P2', $2)`,
    [child2Id, rootId]
  );

  // 直接重放 495 的 SQL 文本（此时数据已就位，模拟"495 真正碰到历史数据"的场景）。
  await pool.query(MIGRATION_495_SQL);
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('迁移 495：projects 真身表升格', () => {
  it('projects 新列都已建好', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'projects'`
    );
    const cols = rows.map((r) => r.column_name);
    for (const c of ['kr_id', 'brief', 'owner_role', 'start_date', 'end_date', 'notion_props', 'custom_props']) {
      expect(cols).toContain(c);
    }
  });

  it('okr_projects 行原样搬进 projects（同 id）', async () => {
    const { rows } = await pool.query(`SELECT id, name, kr_id, status FROM projects WHERE id = $1`, [SEED_PROJECT_ID]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('seed 项目');
    expect(rows[0].kr_id).toBe(KR_ID);
    expect(rows[0].status).toBe('active');
  });

  it('历史 project 根：子任务的 project_ref 命中已存在行 → 复用该 id 建链（不新建）', async () => {
    const { rows: rootRows } = await pool.query(`SELECT payload->>'migrated_to_project' AS pid FROM tasks WHERE id = $1`, [rootId]);
    expect(rootRows[0].pid).toBe(SEED_PROJECT_ID);

    const { rows: childRows } = await pool.query(
      `SELECT id, project_id FROM tasks WHERE id IN ($1, $2) ORDER BY id`,
      [child1Id, child2Id]
    );
    for (const c of childRows) expect(c.project_id).toBe(SEED_PROJECT_ID);

    // 没有多建一条新 projects 行
    const { rows: countRows } = await pool.query(`SELECT count(*)::int AS n FROM projects WHERE id = $1`, [SEED_PROJECT_ID]);
    expect(countRows[0].n).toBe(1);
  });

  it('根任务自身 project_id 也回填为同一 id', async () => {
    const { rows } = await pool.query(`SELECT project_id FROM tasks WHERE id = $1`, [rootId]);
    expect(rows[0].project_id).toBe(SEED_PROJECT_ID);
  });

  it('幂等重放：第二次跑同一份 SQL 不报错、不产生重复行、回填结果不变', async () => {
    await expect(pool.query(MIGRATION_495_SQL)).resolves.toBeDefined();
    const { rows: countRows } = await pool.query(`SELECT count(*)::int AS n FROM projects WHERE id = $1`, [SEED_PROJECT_ID]);
    expect(countRows[0].n).toBe(1);
    const { rows: childRows } = await pool.query(
      `SELECT project_id FROM tasks WHERE id IN ($1, $2)`,
      [child1Id, child2Id]
    );
    for (const c of childRows) expect(c.project_id).toBe(SEED_PROJECT_ID);
  });

  it('没有 project_ref 命中的历史根：以根任务自身 id 新建 projects 行', async () => {
    const bareRootId = randomUUID();
    const bareChildId = randomUUID();
    await pool.query(
      `INSERT INTO tasks (id, title, description, task_type, status, priority)
       VALUES ($1, 'legacy-root-bare', '另一条链', 'project', 'completed', 'P2')`,
      [bareRootId]
    );
    await pool.query(
      `INSERT INTO tasks (id, title, task_type, status, priority, parent_task_id)
       VALUES ($1, 'legacy-child-bare', 'dev', 'completed', 'P2', $2)`,
      [bareChildId, bareRootId]
    );
    await pool.query(MIGRATION_495_SQL);
    const { rows: projRows } = await pool.query(`SELECT id, name, status FROM projects WHERE id = $1`, [bareRootId]);
    expect(projRows).toHaveLength(1);
    expect(projRows[0].name).toBe('legacy-root-bare');
    expect(projRows[0].status).toBe('completed');
    const { rows: childRows } = await pool.query(`SELECT project_id FROM tasks WHERE id = $1`, [bareChildId]);
    expect(childRows[0].project_id).toBe(bareRootId);
  });
});
