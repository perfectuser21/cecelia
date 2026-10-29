import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockProbe = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));
vi.mock('../executor-contracts.js', () => ({ assessTaskLiveness: (...args) => mockProbe(...args) }));

describe('drain waits for real execution and callbacks', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockProbe.mockReset();
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM tasks')) return { rows: [] };
      if (sql.includes('FROM callback_queue')) return { rows: [{ pending: 0 }] };
      return { rows: [] };
    });
    mod = await import('../drain.js');
  });

  it('does not count long-lived headed sessions as worker callbacks', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM tasks')) return { rows: [{ id: 'headed', title: 'research', executor_kind: 'headed-session' }] };
      if (sql.includes('FROM callback_queue')) return { rows: [{ pending: 0 }] };
      return { rows: [] };
    });
    await mod.drainTick();
    expect((await mod.getDrainStatus()).remaining).toBe(0);
  });

  it('blocks swap for an alive worker and for unknown liveness', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM tasks')) return { rows: [{ id: 'worker', title: 'running', executor_kind: 'script', payload: {} }] };
      if (sql.includes('FROM callback_queue')) return { rows: [{ pending: 0 }] };
      return { rows: [] };
    });
    mockProbe.mockResolvedValueOnce({ verdict: 'alive' })
      .mockResolvedValueOnce({ verdict: 'alive' })
      .mockResolvedValueOnce({ verdict: 'unknown' });
    await mod.drainTick();
    expect((await mod.getDrainStatus()).remaining).toBe(1);
    expect((await mod.getDrainStatus()).remaining).toBe(1);
  });

  it('does not drop pending callbacks when worker probe is dead', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM tasks')) return { rows: [{ id: 'worker', title: 'finished', executor_kind: 'script', payload: {} }] };
      if (sql.includes('FROM callback_queue')) return { rows: [{ pending: 1 }] };
      return { rows: [] };
    });
    mockProbe.mockResolvedValue({ verdict: 'dead' });
    await mod.drainTick();
    const status = await mod.getDrainStatus();
    expect(status.remaining).toBe(1);
    expect(status.pending_callbacks).toBe(1);
  });

  it('holds dispatch after drain completion until the deployment explicitly cancels', async () => {
    await mod.drainTick({ holdForSwap: true });
    const status = await mod.getDrainStatus();
    expect(status).toMatchObject({ drain_completed: true, draining: true, remaining: 0 });
    expect(mod.isDraining()).toBe(true);
    expect((await mod.getDrainStatus()).draining).toBe(true);
    await mod.cancelDrain();
    expect(mod.isDraining()).toBe(false);
  });
});
