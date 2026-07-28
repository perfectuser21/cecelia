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

  it('persists recoverable Commander memory without raw Provider material', async () => {
    const runId = randomUUID();
    const row = {
      run_id: runId,
      event_cursor: '8',
      strategy_summary: { approach: 'Keep Kernel truth authoritative.' },
      active_risks: [{ code: 'provider_capacity' }],
      latest_guidance: { text: 'Use evidence-backed retries.' },
    };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [row] }) };

    await expect(createCommanderStore(pool).updateMemory(runId, {
      expectedCursor: 8,
      provider: 'claude',
      accountId: 'account1',
      model: 'claude-opus',
      providerSessionId: 'session-new',
      strategySummary: row.strategy_summary,
      activeRisks: row.active_risks,
      latestGuidance: row.latest_guidance,
      status: 'ready',
    })).resolves.toMatchObject({ ...row, event_cursor: 8 });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/raw_prompt|raw_provider_output|callback_secret|error_message/i);
    expect(JSON.stringify(values)).not.toContain('credential');
    expect(sql).toMatch(/WHERE run_id=\$1\s+AND event_cursor=\$2/is);
  });
});
