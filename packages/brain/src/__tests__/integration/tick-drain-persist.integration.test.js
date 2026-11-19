import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';
const state = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => state.pool.query(...args) } }));
vi.mock('../../executor.js', () => ({ getActiveProcesses: () => [] }));
let fixture;
beforeAll(async () => {
  fixture = await createIntakeTestDatabase();
  await fixture.pool.query(`CREATE TABLE ${fixture.schema}.working_memory (LIKE public.working_memory INCLUDING ALL)`);
});
beforeEach(async () => { state.pool = await fixture.pool.connect(); await state.pool.query('BEGIN'); });
afterEach(async () => {
  try { await state.pool.query('ROLLBACK'); } finally { state.pool.release(); vi.resetModules(); }
});
afterAll(async () => { await fixture?.close(); });
async function freshDrainModule() {
  vi.resetModules(); return import('../../drain.js');
}

describe('Tick Drain 持久化跨重启存活', () => {
  it('drainTick() 激活后，模拟进程重启（resetModules）再 restoreDrainState() 应恢复 draining=true', async () => {
    const drain1 = await freshDrainModule();
    const activateResult = await drain1.drainTick();
    expect(activateResult.draining).toBe(true);

    // 模拟重启：resetModules 后重新 import，内存态清零
    const drain2 = await freshDrainModule();
    expect(drain2.isDraining()).toBe(false);

    // Brain 启动时应调用的恢复函数
    await drain2.restoreDrainState();
    expect(drain2.isDraining()).toBe(true);
  });

  it('未激活过 drain 时，restoreDrainState() 不应把 draining 设为 true（无脏恢复）', async () => {
    const drain = await freshDrainModule();
    await drain.restoreDrainState();
    expect(drain.isDraining()).toBe(false);
  });

  it('读零保持暂停，重启后仍恢复相同排空ID', async () => {
    const drain1 = await freshDrainModule();
    await drain1.drainTick();
    const status = await drain1.getDrainStatus();
    expect(status).toMatchObject({ draining: true, safe_to_swap: true, remaining: 0 });
    const drain2 = await freshDrainModule();
    await drain2.restoreDrainState();
    expect(drain2.isDraining()).toBe(true);
    expect((await drain2.getDrainStatus()).drain_id).toBe(status.drain_id);
  });

  it('cancelDrain() 后，重启不应再恢复出 draining=true', async () => {
    const drain1 = await freshDrainModule();
    await drain1.drainTick();
    await drain1.cancelDrain();

    const drain2 = await freshDrainModule();
    await drain2.restoreDrainState();
    expect(drain2.isDraining()).toBe(false);
  });
});
