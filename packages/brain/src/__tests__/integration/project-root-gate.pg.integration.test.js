/**
 * 登记闸 + Tasks 投影取数 —— 真 PostgreSQL 验证（链 bf5088a3 棒5·PR B，任务 3fad28e0，决策 105a5868）。
 *
 * mock 测不到两件事：
 *   1. findProjectRoot 的递归 CTE 真能沿祖先链找到 project 根、深度封顶
 *   2. PUSH_TASKS_QUERY 的 LATERAL + 指纹条件在真 PG 上语法/语义正确：
 *      blocker 只取「已投影且带本系统指纹」的 hard 边；根后建页 / 依赖后加会被重新选出；指纹一致则不选
 *
 * 建库→跑全量 migrate.js→用完即删，照 task-governance-guards.pg.integration.test.js 的手法。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'fake-token' }));

import { DB_DEFAULTS } from '../../db-config.js';
import { createRoutedTask } from '../../work-routing-store.js';
import { findProjectRoot, assertProjectRootForMultiTask, ProjectRootGateError } from '../../lib/project-root-gate.js';
import { PUSH_TASKS_QUERY } from '../../notion-push-sync.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let pool;
let databaseName;

function quoteIdentifier(value) {
  if (!/^rootgate_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

let seq = 0;
const mk = (over = {}) => {
  seq += 1;
  const { task, ...rest } = over;
  return createRoutedTask(pool, {
    source: 'api',
    source_id: `rootgate-${randomUUID()}`,
    title: `rootgate-${seq}-${randomUUID().slice(0, 8)}`,
    description: 'd',
    requested_task_type: 'research',
    mutation_intent: 'none',
    declared_domain: 'research',
    metadata: {},
    task: { priority: 'P2', status: 'queued', ...(task || {}) },
    ...rest,
  });
};

const insertTask = async ({ title, type = 'research', status = 'queued', parent = null, notionId = null, notionProps = null }) => {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, parent_task_id, notion_id, notion_props)
     VALUES ($1, $2, $3, 'P2', $4, $5, $6::jsonb) RETURNING id`,
    [title, type, status, parent, notionId, notionProps ? JSON.stringify(notionProps) : null],
  );
  return rows[0].id;
};

const selectPush = async (blockedByActive = true) => {
  const { rows } = await pool.query(PUSH_TASKS_QUERY, [blockedByActive]);
  return Object.fromEntries(rows.map((r) => [r.title, r]));
};

beforeAll(async () => {
  databaseName = `rootgate_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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

describe.sequential('登记闸：真库祖先链', () => {
  it('findProjectRoot 沿 parent_task_id 找 project 根（含自身、跨多层）；孤儿返回 null', async () => {
    const root = await insertTask({ title: 'rg-root', type: 'project' });
    const mid = await insertTask({ title: 'rg-mid', parent: root });
    const leaf = await insertTask({ title: 'rg-leaf', parent: mid });
    const orphan = await insertTask({ title: 'rg-orphan' });
    expect(await findProjectRoot(pool, leaf)).toEqual({ id: root });
    expect(await findProjectRoot(pool, root)).toEqual({ id: root });
    expect(await findProjectRoot(pool, orphan)).toBeNull();
  });

  it('违规输入被拒：真库建单带 depends_on 却无根 → project_root_required；挂上根 → 放行并写出边', async () => {
    const dep = (await mk({})).task_id;
    const err = await assertProjectRootForMultiTask(pool, { taskType: 'dev', parentTaskId: null, dependsOn: [dep], payload: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectRootGateError);
    const root = await insertTask({ title: 'rg-root2', type: 'project' });
    await expect(assertProjectRootForMultiTask(pool, { taskType: 'dev', parentTaskId: root, dependsOn: [dep], payload: {} })).resolves.toBeUndefined();
    const child = await mk({ task: { priority: 'P2', status: 'queued', parent_task_id: root }, metadata: { depends_on: [dep] } });
    const edge = await pool.query('SELECT edge_type FROM task_dependencies WHERE from_task_id=$1 AND to_task_id=$2', [child.task_id, dep]);
    expect(edge.rows).toEqual([{ edge_type: 'hard' }]);
  });

  it('multi_task + 父下已有兄弟 + 没写 depends_on → depends_on_required；显式 [] 放行', async () => {
    const root = await insertTask({ title: 'rg-root3', type: 'project' });
    await insertTask({ title: 'rg-first', parent: root });
    const err = await assertProjectRootForMultiTask(pool, { taskType: 'dev', parentTaskId: root, dependsOn: null, payload: { multi_task: true } }).catch((e) => e);
    expect(err.code).toBe('depends_on_required');
    await expect(assertProjectRootForMultiTask(pool, { taskType: 'dev', parentTaskId: root, dependsOn: [], payload: { multi_task: true } })).resolves.toBeUndefined();
  });
});

describe.sequential('PUSH_TASKS_QUERY 真库：Project / Blocked by 指纹', () => {
  it('Blocked by 只取已投影且带本系统指纹的 hard 前置；旧时代遗产 notion_id 的前置不进 relation', async () => {
    const managed = await insertTask({ title: 'pq-managed-blocker', notionId: 'notion-blocker-1', notionProps: { pushed_status: 'queued' } });
    const legacy = await insertTask({ title: 'pq-legacy-blocker', notionId: 'legacy-page-x', notionProps: null });
    const unpushed = await insertTask({ title: 'pq-unpushed-blocker' });
    const dependent = await insertTask({ title: 'pq-dependent', notionId: 'notion-dep', notionProps: { pushed_status: 'queued', pushed_project: '' } });
    for (const to of [managed, legacy, unpushed]) {
      await pool.query(`INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type) VALUES ($1, $2, 'hard')`, [dependent, to]);
    }
    const soft = await insertTask({ title: 'pq-soft-blocker', notionId: 'notion-soft', notionProps: { pushed_status: 'queued' } });
    await pool.query(`INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type) VALUES ($1, $2, 'soft')`, [dependent, soft]);

    const rows = await selectPush(true);
    expect(rows['pq-dependent']).toBeTruthy();
    expect(rows['pq-dependent'].blocker_notion_ids).toEqual(['notion-blocker-1']);
  });

  it('依赖指纹一致 → 不再选；投影被 flag-off（$1=false）→ 依赖变化不触发重推（不 livelock）', async () => {
    const blocker = await insertTask({ title: 'pq2-blocker', notionId: 'notion-b2', notionProps: { pushed_status: 'queued' } });
    const dependent = await insertTask({
      title: 'pq2-dependent', notionId: 'notion-d2',
      notionProps: { pushed_status: 'queued', pushed_project: '', pushed_blockers: 'notion-b2' },
    });
    await pool.query(`INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type) VALUES ($1, $2, 'hard')`, [dependent, blocker]);
    expect((await selectPush(true))['pq2-dependent']).toBeUndefined();

    const dependent3 = await insertTask({ title: 'pq3-dependent', notionId: 'notion-d3', notionProps: { pushed_status: 'queued', pushed_project: '' } });
    await pool.query(`INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type) VALUES ($1, $2, 'hard')`, [dependent3, blocker]);
    expect((await selectPush(true))['pq3-dependent']).toBeTruthy(); // 依赖后加 → 重推
    expect((await selectPush(false))['pq3-dependent']).toBeUndefined(); // flag-off 不看依赖指纹
  });

  it('根后建页：project 根已有 notion_id 而子任务指纹缺 pushed_project → 被选出；指纹对上后不再选', async () => {
    const root = await insertTask({ title: 'pq4-root', type: 'project', notionId: 'notion-root-4' });
    await insertTask({ title: 'pq4-child', parent: root, notionId: 'notion-c4', notionProps: { pushed_status: 'queued' } });
    const rows = await selectPush(true);
    expect(rows['pq4-child']).toBeTruthy();
    expect(rows['pq4-child'].project_notion_id).toBe('notion-root-4');
    await pool.query(
      `UPDATE tasks SET notion_props = notion_props || '{"pushed_project":"notion-root-4"}'::jsonb WHERE title = 'pq4-child'`,
    );
    expect((await selectPush(true))['pq4-child']).toBeUndefined();
  });

  it('前置关系被摘掉（指纹里曾有）→ 重新选出，用于发空 relation 清掉', async () => {
    await insertTask({
      title: 'pq5-dependent', notionId: 'notion-d5',
      notionProps: { pushed_status: 'queued', pushed_project: '', pushed_blockers: 'notion-old-blocker' },
    });
    const rows = await selectPush(true);
    expect(rows['pq5-dependent']).toBeTruthy();
    expect(rows['pq5-dependent'].blocker_notion_ids).toEqual([]);
  });
});
