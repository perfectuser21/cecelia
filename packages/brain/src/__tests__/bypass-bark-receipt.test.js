import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const defaultSend = vi.hoisted(() => vi.fn(() => { throw new Error('unexpected default notifier'); }));
vi.mock('../notifier.js', () => ({ sendBark: defaultSend }));

import { _resetBypassAuditGates, runBypassAudit } from '../bypass-audit.js';
import { schedulerOutcome } from '../lib/workflow-runs.js';

const NOW = Date.parse('2026-10-12T04:00:00Z');
const COUNTS = { phone_lock: 3, phone_outward: 2, openclaw_push: 5 };
let fetchGuard;
let warn;

beforeEach(() => {
  vi.clearAllMocks();
  _resetBypassAuditGates();
  vi.stubEnv('BYPASS_BARK_PHONE_OUTWARD', '1');
  vi.stubEnv('BYPASS_BARK_OPENCLAW_PUSH', '5');
  fetchGuard = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  try {
    expect(defaultSend).not.toHaveBeenCalled();
    expect(fetchGuard).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});

function rollupPool() {
  const writes = [];
  return {
    writes,
    query: vi.fn(async (sql, params) => {
      if (sql.includes('GROUP BY source')) {
        return { rows: Object.entries(COUNTS).map(([kind, n]) => ({ kind, n })) };
      }
      if (sql.includes('INSERT INTO runs')) {
        writes.push(params);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected record-only query: ${sql}`);
    }),
  };
}

describe('bypass audit reports only confirmed Bark sends', () => {
  it.each([
    ['confirmed', true, ['phone_outward', 'openclaw_push']],
    ['false receipt', false, []],
    ['missing receipt', undefined, []],
    ['truthy non-boolean receipt', 'true', []],
    ['rejected send', new Error('owned Bark rejection'), []],
  ])('%s preserves audit data without claiming an unconfirmed send', async (_name, receipt, barked) => {
    const pool = rollupPool();
    const exec = vi.fn(async () => '[]');
    const sendBark = vi.fn(async () => {
      if (receipt instanceof Error) throw receipt;
      return receipt;
    });
    const deps = { exec, sendBark, inContainer: false, now: () => NOW };
    const result = await runBypassAudit(pool, deps);

    expect(result).toMatchObject({ ok: true, rollup: { day: '2026-10-12', counts: COUNTS, barked } });
    expect(schedulerOutcome({ result })).toBe('pass');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toContain('sqlite3 -readonly -json');
    expect(sendBark).toHaveBeenCalledTimes(2);
    expect(sendBark.mock.calls.map(([, , opts]) => opts)).toEqual([
      { dedupeKey: 'bypass-alert:2026-10-12:phone_outward', dedupeTtlSec: 2 * 86400 },
      { dedupeKey: 'bypass-alert:2026-10-12:openclaw_push', dedupeTtlSec: 2 * 86400 },
    ]);
    expect(pool.writes.map(params => params[0])).toEqual(['bypass-audit:2026-10-12', 'bypass-audit:2026-10-11']);
    for (const params of pool.writes) {
      expect(params[3]).toBe('fail'); // The audit outcome follows bypass counts, not notification delivery.
      expect(JSON.parse(params[5])).toMatchObject({ counts: COUNTS, total: 10 });
    }
    expect(warn).toHaveBeenCalledTimes(receipt instanceof Error ? 2 : 0);

    // Failed and unconfigured sends retain the existing five-minute gate; no new retry policy.
    expect(await runBypassAudit(pool, deps)).toMatchObject({ ok: true, scan: { skipped: true }, rollup: { skipped: true } });
    expect(sendBark).toHaveBeenCalledTimes(2);
    expect(pool.writes).toHaveLength(2);
  });
});
