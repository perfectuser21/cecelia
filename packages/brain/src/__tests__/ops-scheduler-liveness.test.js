import { describe, it, expect, vi } from 'vitest';
import { runSchedulerLiveness, SCHEDULER_SOURCE, SCHEDULER_MACHINE } from '../ops-scheduler-liveness.js';

const NOW = Date.parse('2026-09-24T01:00:00Z');
const iso = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
const KEY = 'scheduler_job_last_run:';

/** fakePool：记录 SQL；哨兵查询返回预置行；upsert 返回 RETURNING 行（旧 liveness 由 prev 表给） */
function fakePool({ sentinels = {}, prev = {} } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: s, params });
      if (s.includes('FROM working_memory')) {
        return { rows: Object.entries(sentinels).map(([name, rec]) => ({ key: `${KEY}${name}`, value_json: rec })) };
      }
      if (s.includes('INSERT INTO ops_workflows')) {
        const wfId = params[0];
        const newLv = params[6];
        const old = prev[wfId] ?? null;
        // 模拟 WHERE 降噪：旧 liveness 相同且状态相同 → 不返回行
        if (old && old.liveness === newLv && old.last_run_status === params[4]) return { rows: [] };
        return { rows: [{ wf_id: wfId, liveness: newLv, prev_liveness: old?.liveness ?? null }] };
      }
      return { rows: [] };
    },
  };
}

const jobs = [
  { name: 'notion-gtd-sync', livenessIntervalSec: 30, timeoutMs: 30_000, description: 'gtd' },
  { name: 'ci-patrol', timeoutMs: 300_000, description: 'ci' },
];

describe('runSchedulerLiveness — 调度 job 入运行舱', () => {
  it('每个 job upsert 一行 source=scheduler、machine=us-vps、active=false，只写机器列', async () => {
    const pool = fakePool({ sentinels: { 'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(20) }, 'ci-patrol': { at: iso(5), ok: true } } });
    const r = await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn() });
    const ups = pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(ups).toHaveLength(2);
    for (const q of ups) {
      expect(q.sql).toContain(`'${SCHEDULER_SOURCE}'`);
      expect(q.sql).toMatch(/ON CONFLICT \(source, wf_id\) DO UPDATE/);
      expect(q.sql).toMatch(/active=FALSE/);
      for (const manual of ['owner_manual', 'note_manual', 'priority_manual', 'starred', 'enable_intent', 'dispatch']) {
        expect(q.sql).not.toContain(manual);
      }
      expect(q.params[1]).toBe(SCHEDULER_MACHINE);
    }
    expect(r).toMatchObject({ ok: true, jobs: 2 });
  });

  it('活性只认 liveness_at（handler 自报），没有才退回哨兵 at；30s 尺子老于 900s → dead', async () => {
    const pool = fakePool({ sentinels: {
      'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(901) }, // 哨兵每分钟都新，内层死了
      'ci-patrol': { at: iso(5), ok: true },
    } });
    await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn() });
    const byWf = Object.fromEntries(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows')).map((q) => [q.params[0], q.params]));
    expect(byWf['notion-gtd-sync'][6]).toBe('dead');
    expect(byWf['notion-gtd-sync'][5]).toBe(30);    // baseline_interval_sec = 声明间隔
    expect(byWf['ci-patrol'][6]).toBe('ok');
    expect(byWf['ci-patrol'][5]).toBe(60);
  });

  it('哨兵 ok:false → last_run_status=error；timedOut → timeout；缺哨兵 → cold', async () => {
    const pool = fakePool({ sentinels: { 'notion-gtd-sync': { at: iso(5), ok: false, error: 'x' }, 'hung': { at: iso(5), ok: false, timedOut: true } } });
    await runSchedulerLiveness(pool, { jobs: [...jobs, { name: 'hung', timeoutMs: 1000 }], now: NOW, raise: vi.fn() });
    const byWf = Object.fromEntries(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows')).map((q) => [q.params[0], q.params]));
    expect(byWf['notion-gtd-sync'][4]).toBe('error');
    expect(byWf['hung'][4]).toBe('timeout');
    expect(byWf['ci-patrol'][6]).toBe('cold');
    expect(byWf['hung'][6]).toBe('cold');
  });

  it('翻转到 dead 才告警（去重靠翻转），恢复也告一次，未翻转不告', async () => {
    const raise = vi.fn().mockResolvedValue(undefined);
    const pool = fakePool({
      sentinels: { 'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(2000) }, 'ci-patrol': { at: iso(5), ok: true } },
      prev: { 'notion-gtd-sync': { liveness: 'warn', last_run_status: 'success' }, 'ci-patrol': { liveness: 'ok', last_run_status: 'success' } },
    });
    await runSchedulerLiveness(pool, { jobs, now: NOW, raise });
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P1');
    expect(raise.mock.calls[0][1]).toBe('scheduler_job_dead_notion-gtd-sync');
    expect(raise.mock.calls[0][2]).toMatch(/notion-gtd-sync/);
  });

  it('dead → 非 dead 翻转告恢复（P2）', async () => {
    const raise = vi.fn().mockResolvedValue(undefined);
    const pool = fakePool({
      sentinels: { 'ci-patrol': { at: iso(5), ok: true } },
      prev: { 'ci-patrol': { liveness: 'dead', last_run_status: 'success' } },
    });
    await runSchedulerLiveness(pool, { jobs: [jobs[1]], now: NOW, raise });
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P2');
    expect(raise.mock.calls[0][1]).toBe('scheduler_job_recovered_ci-patrol');
  });

  it('降噪：UPDATE 带 WHERE，只在 liveness/last_run_status 变化或 last_run_at 前进 ≥10min 时刷新', async () => {
    const pool = fakePool({ sentinels: { 'ci-patrol': { at: iso(5), ok: true } } });
    await runSchedulerLiveness(pool, { jobs: [jobs[1]], now: NOW, raise: vi.fn() });
    const up = pool.queries.find((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(up.sql).toMatch(/DO UPDATE SET[\s\S]*WHERE ops_workflows\.liveness IS DISTINCT FROM EXCLUDED\.liveness/);
    expect(up.sql).toMatch(/interval '10 minutes'/);
  });

  it('写 scheduler 心跳；raise 抛错不影响返回', async () => {
    const pool = fakePool({ sentinels: { 'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(2000) } }, prev: { 'notion-gtd-sync': { liveness: 'ok', last_run_status: 'success' } } });
    const r = await runSchedulerLiveness(pool, { jobs: [jobs[0]], now: NOW, raise: vi.fn().mockRejectedValue(new Error('bark down')) });
    expect(r.ok).toBe(true);
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb.params[0]).toBe(SCHEDULER_SOURCE);
    expect(hb.params[3]).toBe('ok');
  });
});
