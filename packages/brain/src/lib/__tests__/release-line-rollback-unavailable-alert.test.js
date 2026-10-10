/**
 * 发布线·无可退目标告警（审查阻断项，任务 d9eb572d）：
 * 主理人原文「自动退回只退到曾收敛过的版本，没有则只告警（去重）不退回」——生产版从未收敛、又没有可退目标时也要告警，
 * 防刷屏靠 recentlyNotified 去重（同一 Activity + 同一生产版 24 小时内、期间没有全绿只告警一次），不靠静默。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ events: [], converged: false, nextId: 1, clock: 0 }));

vi.mock('../release-line.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    releaseLineReady: vi.fn(async () => true),
    lockReleaseLine: vi.fn(async () => {}),
    getPointer: vi.fn(async () => ({ production_version_id: 'v-prod' })),
    everConverged: vi.fn(async () => state.converged),
    recordEvent: vi.fn(async (_db, e) => {
      const row = { id: state.nextId++, created_at: new Date(state.clock).toISOString(), ...e };
      state.events.push(row);
      return row;
    }),
    withReleaseTx: vi.fn(async (db, fn) => fn(db)),
  };
});

const { onJudgmentRecorded } = await import('../release-line-rollback.js');

const failingJudgments = ['r3', 'r2', 'r1'].map((run, i) => ({
  id: 10 - i, trigger_ref: run, judged_at: new Date(0).toISOString(),
  report: { runs: [{ run_id: run, green: false }], run_version_ids: { [run]: ['b1'] } },
}));

function fakeDb() {
  return { query: vi.fn(async (sql, params = []) => {
    if (/FROM activity_version_builds/.test(sql)) return { rows: [{ build_id: 'b1' }] };
    if (/trigger_ref IS NOT NULL/.test(sql)) return { rows: failingJudgments };
    if (/SELECT to_version_id, max\(id\)/.test(sql)) return { rows: [] };
    if (/FROM activity_release_events WHERE activity_id = \$1 AND kind = \$2 AND from_version_id = \$3/.test(sql)) {
      const [a, kind, from] = params;
      const hit = state.events.filter(e => e.activity_id === a && e.kind === kind && e.from_version_id === from).slice(-1);
      return { rows: hit.map(e => ({ id: e.id, created_at: e.created_at })) };
    }
    if (/jsonb_array_elements\(j\.report->'runs'\)/.test(sql)) return { rows: [] };
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
  }) };
}

const quiet = { warn: vi.fn(), info: vi.fn() };
const flush = () => new Promise(r => setTimeout(r, 0));
const run = async (db, activityId, alert, bark = vi.fn()) => {
  const out = await onJudgmentRecorded(db, activityId, {}, { env: {}, alert, bark, log: quiet, now: state.clock });
  await flush();
  return out;
};

describe('无可退目标：生产版从未收敛也告警（去重）', () => {
  beforeEach(() => { state.events = []; state.converged = false; state.nextId = 1; state.clock = Date.parse('2026-10-10T00:00:00Z'); });

  it('未收敛生产版、无退回目标 → rollback_unavailable + 告警 1 次（不发 Bark）；24 小时内再失败不再告警', async () => {
    const alert = vi.fn(), bark = vi.fn();
    const db = fakeDb();
    const r1 = await run(db, 'act-1', alert, bark);
    expect(r1).toMatchObject({ action: 'rollback_unavailable', to_version_id: null });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('P2');
    expect(alert.mock.calls[0][1]).toBe('activity_production_rollback_unavailable:act-1');
    expect(bark).not.toHaveBeenCalled();

    state.clock += 3600 * 1000;
    const r2 = await run(db, 'act-1', alert, bark);
    expect(r2).toMatchObject({ action: 'deduped', kind: 'rollback_unavailable' });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(state.events.filter(e => e.kind === 'rollback_unavailable')).toHaveLength(1);
  });

  it('超过 24 小时仍失败 → 再告警一次', async () => {
    const alert = vi.fn();
    const db = fakeDb();
    await run(db, 'act-2', alert);
    state.clock += 25 * 3600 * 1000;
    const r = await run(db, 'act-2', alert);
    expect(r).toMatchObject({ action: 'rollback_unavailable' });
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('曾收敛生产版退化、无退回目标 → 仍是 P1', async () => {
    state.converged = true;
    const alert = vi.fn();
    await run(fakeDb(), 'act-3', alert);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('P1');
  });

  it('告警函数抛错 → 不影响返回结果（fail-safe）', async () => {
    const alert = vi.fn(() => { throw new Error('alert down'); });
    const r = await run(fakeDb(), 'act-4', alert);
    expect(r).toMatchObject({ action: 'rollback_unavailable' });
  });
});
