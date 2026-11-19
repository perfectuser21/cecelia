/** 旧无ID部署残留保留15分钟恢复自愈；新协议暂停必须等显式cancel。 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';
const state = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => state.pool.query(...args) } }));
import { restoreDrainState, isDraining, _resetDrainState } from '../../drain.js';
const pool = { query: (...args) => state.pool.query(...args) };
let fixture;
beforeAll(async () => {
  fixture = await createIntakeTestDatabase();
  await fixture.pool.query(`CREATE TABLE ${fixture.schema}.working_memory (LIKE public.working_memory INCLUDING ALL)`);
});
afterEach(async () => {
  try { await state.pool.query('ROLLBACK'); } finally { state.pool.release(); _resetDrainState(); }
});

const KEY = 'tick_draining';

async function seedDrainRow(startedAtIso, drainId) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [KEY, { draining: true, drain_started_at: startedAtIso, ...(drainId ? { drain_id: drainId } : {}) }]
  );
}

async function readDrainRow() {
  const { rows } = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1`, [KEY]
  );
  return rows[0]?.value_json ?? null;
}

beforeEach(async () => {
  _resetDrainState();
  state.pool = await fixture.pool.connect(); await state.pool.query('BEGIN');
});

afterAll(async () => { await fixture?.close(); });

describe('restoreDrainState — 仅旧协议残留自愈', () => {
  it('过期残留（20 分钟前）→ 不恢复 draining 且持久化行被清掉', async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await seedDrainRow(stale);

    await restoreDrainState();

    expect(isDraining()).toBe(false);
    expect(await readDrainRow()).toBeNull();
  });

  it('新鲜 drain（2 分钟前）→ 正常恢复（部署中重启的合法场景不受影响）', async () => {
    const fresh = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await seedDrainRow(fresh);

    await restoreDrainState();

    expect(isDraining()).toBe(true);
    expect(await readDrainRow()).not.toBeNull();
  });

  it('drain_started_at 缺失/不可解析 → 视为过期残留清掉（fail-safe 不瘫痪派发）', async () => {
    await seedDrainRow(null);

    await restoreDrainState();

    expect(isDraining()).toBe(false);
    expect(await readDrainRow()).toBeNull();
  });
  it('新协议带ID暂停超过15分钟，重启仍保持暂停和原ID', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    await seedDrainRow(new Date(Date.now() - 60 * 60 * 1000).toISOString(), id);
    await restoreDrainState();
    expect(isDraining()).toBe(true);
    expect((await readDrainRow()).drain_id).toBe(id);
  });

});
