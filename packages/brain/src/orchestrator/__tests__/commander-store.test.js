import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createCommanderStore } from '../commander-store.js';

describe('Commander state store', () => {
  it('creates isolated state with explicit budgets', async () => {
    const runId = randomUUID();
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          run_id: runId,
          event_cursor: '0',
          message_count: 0,
          message_token_count: 0,
          message_budget: 64,
          message_token_budget: 20_000,
        }],
      }),
    };
    const store = createCommanderStore(pool);

    await expect(store.ensureRun({
      runId,
      messageBudget: 64,
      messageTokenBudget: 20_000,
    })).resolves.toMatchObject({ run_id: runId, event_cursor: 0 });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('ON CONFLICT (run_id) DO NOTHING');
  });

  it('advances the cursor with compare-and-swap semantics', async () => {
    const runId = randomUUID();
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ run_id: runId, event_cursor: '9' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const store = createCommanderStore(pool);

    await expect(store.advanceCursor(runId, {
      expectedCursor: 7,
      nextCursor: 9,
    })).resolves.toMatchObject({ event_cursor: 9 });
    await expect(store.advanceCursor(runId, {
      expectedCursor: 7,
      nextCursor: 10,
    })).resolves.toBeNull();
    expect(pool.query.mock.calls[0][0]).toMatch(/WHERE run_id=\$1\s+AND event_cursor=\$2/);
  });

  it('rejects cursor regression and secret-bearing memory before querying PostgreSQL', async () => {
    const pool = { query: vi.fn() };
    const store = createCommanderStore(pool);

    await expect(store.advanceCursor(randomUUID(), {
      expectedCursor: 7,
      nextCursor: 6,
    })).rejects.toThrow('commander_cursor_regression');
    await expect(store.updateMemory(randomUUID(), {
      expectedCursor: 0,
      strategySummary: { api_key: 'secret' },
    })).rejects.toThrow('secret_material_forbidden');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
