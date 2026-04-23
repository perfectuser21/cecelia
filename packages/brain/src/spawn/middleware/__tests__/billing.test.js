import { describe, it, expect } from 'vitest';
import { recordBilling } from '../billing.js';

function makeUpdates() {
  const calls = [];
  return {
    calls,
    deps: { updateTaskPayload: async (id, payload) => calls.push({ id, payload }) },
  };
}

describe('recordBilling()', () => {
  it('records dispatched_account + model when task + account present', async () => {
    const m = makeUpdates();
    const r = await recordBilling(
      { exit_code: 0, duration_ms: 100, cost_usd: 0.01 },
      { task: { id: 't1' }, env: { CECELIA_CREDENTIALS: 'a1', CECELIA_MODEL: 'sonnet-4' } },
      { deps: m.deps },
    );
    expect(r.recorded).toBe(true);
    expect(r.account).toBe('a1');
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].id).toBe('t1');
    expect(m.calls[0].payload.dispatched_account).toBe('a1');
    expect(m.calls[0].payload.dispatched_model).toBe('sonnet-4');
    expect(m.calls[0].payload.exit_code).toBe(0);
  });

  it('skips when task.id missing', async () => {
    const m = makeUpdates();
    const r = await recordBilling({}, { task: {}, env: { CECELIA_CREDENTIALS: 'a1' } }, { deps: m.deps });
    expect(r.recorded).toBe(false);
    expect(m.calls).toHaveLength(0);
  });

  it('skips when account missing', async () => {
    const m = makeUpdates();
    const r = await recordBilling({}, { task: { id: 't2' }, env: {} }, { deps: m.deps });
    expect(r.recorded).toBe(false);
    expect(r.account).toBeNull();
  });

  it('no-op when updateTaskPayload not injected', async () => {
    const r = await recordBilling({}, { task: { id: 't3' }, env: { CECELIA_CREDENTIALS: 'a3' } }, {});
    expect(r.recorded).toBe(false);
    expect(r.account).toBe('a3');
  });

  it('recovers gracefully when updateTaskPayload throws', async () => {
    const deps = { updateTaskPayload: async () => { throw new Error('db down'); } };
    const r = await recordBilling({}, { task: { id: 't4' }, env: { CECELIA_CREDENTIALS: 'a4' } }, { deps });
    expect(r.recorded).toBe(false);
  });
});
