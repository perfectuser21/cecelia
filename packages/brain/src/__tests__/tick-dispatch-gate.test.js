import { describe, expect, it, vi } from 'vitest';
import { readTickDispatchEnabled, tickDispatchEnabled } from '../tick-dispatch-gate.js';

describe('shared actual Brain dispatch switch', () => {
  it('uses the persistent tick_enabled record instead of a similarly named environment toggle', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ value_json: { enabled: false } }] })) };
    expect(await readTickDispatchEnabled(pool, { BRAIN_TICK_ENABLED: 'true' })).toBe(false);
    expect(pool.query).toHaveBeenCalledWith('SELECT value_json FROM working_memory WHERE key=$1', ['tick_enabled']);
  });
  it('retains the existing hard-off and missing-record semantics', () => {
    expect(tickDispatchEnabled({ enabled: true }, { CECELIA_TICK_HARD_OFF: '1' })).toBe(false);
    expect(tickDispatchEnabled(undefined, {})).toBe(true);
    expect(tickDispatchEnabled({ enabled: true }, { BRAIN_TICK_ENABLED: 'false' })).toBe(true);
  });
  it('does not treat an unreadable switch as enabled', async () => {
    await expect(readTickDispatchEnabled({ query: async () => { throw Error('database down'); } }, {})).rejects.toThrow('database down');
  });
});
