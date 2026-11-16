import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { privateFixtureDatabase } from '../fixtures/private-fixture-db.js';

const bridge = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => bridge.query(...args) } }));
vi.mock('../../actions.js', () => ({ updateTask: vi.fn(), createTask: vi.fn() }));
vi.mock('../../quarantine.js', () => ({ handleTaskFailure: vi.fn() }));
vi.mock('../../slot-allocator.js', () => ({ shouldBypassBackpressure: () => false }));
import { selectNextDispatchableTask } from '../../dispatch-helpers.js';
import { PUSH_TASKS_QUERY } from '../../notion-push-sync.js';

let fixture;
const migration = readFileSync(new URL('../../../migrations/457_device_job_task_type_and_row_version.sql', import.meta.url), 'utf8');
beforeEach(async () => {
  fixture = await privateFixtureDatabase('devicefoundation', async db => {
    await db.query(`CREATE TABLE tasks(
      id uuid PRIMARY KEY, title text, description text, prd_content text, status text DEFAULT 'queued', priority text DEFAULT 'P2',
      started_at timestamptz, updated_at timestamptz DEFAULT now(), queued_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
      payload jsonb DEFAULT '{}', task_type text, metadata jsonb DEFAULT '{}', project_id uuid, goal_id uuid, claimed_by text,
      kind text, notion_id text, notion_props jsonb DEFAULT '{}', result jsonb DEFAULT '{}', parent_task_id uuid);
      CREATE TABLE projects(id uuid PRIMARY KEY, notion_props jsonb DEFAULT '{}');
      CREATE TABLE task_dependencies(from_task_id uuid, to_task_id uuid, edge_type text, gap_id uuid);
      CREATE TABLE harness_gap_dependencies(source_task_id uuid, status text);`);
    await db.query(migration);
  });
  bridge.query.mockImplementation((...args) => fixture.client.query(...args));
});
afterEach(async () => {
  bridge.query.mockReset();
  if (fixture) await fixture.close();
  fixture = null;
});
async function add(task_type, payload = {}) {
  const id = randomUUID();
  await fixture.client.query('INSERT INTO tasks(id,title,task_type,payload) VALUES($1,$2,$3,$4)', [id, 'fixture任务', task_type, payload]);
  return id;
}

describe('device_job地基的真实数据库行为', () => {
  it('独立阻断设备与有头单，普通单仍可派发和投影', async () => {
    const device = await add('device_job');
    const headed = await add('research', { headed_manual: true });
    const ordinary = await add('research');
    expect((await selectNextDispatchableTask(null, [])).id).toBe(ordinary);
    const projected = (await fixture.client.query(PUSH_TASKS_QUERY, [true])).rows.map(row => row.id);
    expect(projected).toEqual(expect.arrayContaining([ordinary, headed]));
    expect(projected).not.toContain(device);
    await fixture.client.query('DELETE FROM tasks WHERE id=$1', [ordinary]);
    expect(await selectNextDispatchableTask(null, [])).toBeNull();
    // 每个负例单独留场，避免另一个排除条件掩盖失效。
    await fixture.client.query('DELETE FROM tasks WHERE id=$1', [headed]);
    expect(await selectNextDispatchableTask(null, [])).toBeNull();
  });

  it('真实迁移接纳device_job，row_version默认0且非空，非法类型仍拒绝', async () => {
    const id = await add('device_job');
    expect((await fixture.client.query('SELECT row_version FROM tasks WHERE id=$1', [id])).rows[0].row_version).toBe(0);
    await expect(fixture.client.query('UPDATE tasks SET row_version=NULL WHERE id=$1', [id])).rejects.toMatchObject({ code: '23502' });
    await expect(add('fixture_invalid_type')).rejects.toMatchObject({ code: '23514' });
    await fixture.client.query(migration);
    expect((await fixture.client.query('SELECT row_version FROM tasks WHERE id=$1', [id])).rows[0].row_version).toBe(0);
  });
});
