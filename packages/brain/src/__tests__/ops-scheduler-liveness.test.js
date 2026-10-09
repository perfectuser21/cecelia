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
        // 模拟 WHERE 降噪：旧 liveness/状态相同且 silent_sec 增量 <600 → 不返回行
        if (old && old.liveness === newLv && old.last_run_status === params[4]) return { rows: [] };
        return { rows: [{ wf_id: wfId, liveness: newLv, prev_liveness: old?.liveness ?? null }] };
      }
      // UPDATE ... wf_id <> ALL($1) 僵尸行清理 / ops_source_heartbeats 心跳，默认无行受影响
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
    const r = await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
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
    await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
    const byWf = Object.fromEntries(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows')).map((q) => [q.params[0], q.params]));
    expect(byWf['notion-gtd-sync'][6]).toBe('dead');
    expect(byWf['notion-gtd-sync'][5]).toBe(30);    // baseline_interval_sec = 声明间隔
    expect(byWf['ci-patrol'][6]).toBe('ok');
    expect(byWf['ci-patrol'][5]).toBe(60);
  });

  it('哨兵 ok:false 仍按时间戳判活（不看 ok）；status 分别是 error/timeout；真正缺哨兵才 cold', async () => {
    const pool = fakePool({ sentinels: {
      'notion-gtd-sync': { at: iso(5), ok: false, error: 'x' },   // 报错但最近跑过 → 按时间戳算活
      'hung': { at: iso(5), ok: false, timedOut: true },          // 超时但最近跑过 → 按时间戳算活
    } });
    await runSchedulerLiveness(pool, { jobs: [...jobs, { name: 'hung', timeoutMs: 1000 }], now: NOW, raise: vi.fn(), bark: vi.fn() });
    const byWf = Object.fromEntries(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows')).map((q) => [q.params[0], q.params]));
    expect(byWf['notion-gtd-sync'][4]).toBe('error');
    expect(byWf['notion-gtd-sync'][6]).toBe('ok');   // lastRunAt=iso(5)，30s 尺子内仍算活
    expect(byWf['hung'][4]).toBe('timeout');
    expect(byWf['hung'][6]).toBe('ok');              // lastRunAt=iso(5)，60s 尺子内仍算活
    expect(byWf['ci-patrol'][6]).toBe('cold');       // 真无哨兵才 cold
  });

  it('两个 job 同轮翻 dead → 按轮合并成一条 Bark；raise 不用于失联；未翻转不发', async () => {
    const bark = vi.fn().mockResolvedValue(true);
    const raise = vi.fn().mockResolvedValue(undefined);
    const pool = fakePool({
      sentinels: {
        'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(2000) },
        'ci-patrol': { at: iso(5), ok: true, liveness_at: iso(2000) },
      },
      prev: { 'notion-gtd-sync': { liveness: 'warn', last_run_status: 'success' }, 'ci-patrol': { liveness: 'ok', last_run_status: 'success' } },
    });
    await runSchedulerLiveness(pool, { jobs, now: NOW, raise, bark });
    expect(raise).not.toHaveBeenCalled();
    expect(bark).toHaveBeenCalledTimes(1);
    const [title, body] = bark.mock.calls[0];
    expect(title).toMatch(/失联 2 个/);
    expect(body).toMatch(/notion-gtd-sync/);
    expect(body).toMatch(/ci-patrol/);
  });

  it('Bark 静默失败（无 BARK_TOKEN 时返回 false，不抛）→ 兜底 raise(P1) 一次；返回 true → raise 不调', async () => {
    const bark = vi.fn().mockResolvedValue(false);
    const raise = vi.fn().mockResolvedValue(undefined);
    const pool = fakePool({
      sentinels: { 'ci-patrol': { at: iso(5), ok: true, liveness_at: iso(2000) } },
      prev: { 'ci-patrol': { liveness: 'ok', last_run_status: 'success' } },
    });
    await runSchedulerLiveness(pool, { jobs: [jobs[1]], now: NOW, raise, bark });
    expect(bark).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P1');
    expect(raise.mock.calls[0][1]).toBe('scheduler_job_dead');
  });

  it('dead → ok/warn 翻转告恢复（P2，走 raise）', async () => {
    const raise = vi.fn().mockResolvedValue(undefined);
    const bark = vi.fn().mockResolvedValue(true);
    const pool = fakePool({
      sentinels: { 'ci-patrol': { at: iso(5), ok: true } },
      prev: { 'ci-patrol': { liveness: 'dead', last_run_status: 'success' } },
    });
    await runSchedulerLiveness(pool, { jobs: [jobs[1]], now: NOW, raise, bark });
    expect(bark).not.toHaveBeenCalled();
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P2');
    expect(raise.mock.calls[0][1]).toBe('scheduler_job_recovered_ci-patrol');
  });

  it('降噪：UPDATE 带 WHERE 五条件（含 silent_sec 增量 ≥600），只在其一满足时才刷新', async () => {
    const pool = fakePool({ sentinels: { 'ci-patrol': { at: iso(5), ok: true } } });
    await runSchedulerLiveness(pool, { jobs: [jobs[1]], now: NOW, raise: vi.fn(), bark: vi.fn() });
    const up = pool.queries.find((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(up.sql).toMatch(/DO UPDATE SET[\s\S]*WHERE ops_workflows\.liveness IS DISTINCT FROM EXCLUDED\.liveness/);
    expect(up.sql).toMatch(/interval '10 minutes'/);
    expect(up.sql).toMatch(/silent_sec.*>= 600/);
  });

  it('写 scheduler 心跳；bark 抛错不影响返回（告警是增益不是前提）', async () => {
    const pool = fakePool({ sentinels: { 'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(2000) } }, prev: { 'notion-gtd-sync': { liveness: 'ok', last_run_status: 'success' } } });
    const r = await runSchedulerLiveness(pool, { jobs: [jobs[0]], now: NOW, raise: vi.fn(), bark: vi.fn().mockRejectedValue(new Error('bark down')) });
    expect(r.ok).toBe(true);
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb.params[0]).toBe(SCHEDULER_SOURCE);
    expect(hb.params[3]).toBe('ok');
  });

  it('查询哨兵失败（非网络类错误）→ 心跳复用 classifyError 归类为 parse_error 并返回 ok:false，不静默吞', async () => {
    const queries = [];
    const pool = {
      queries,
      query: async (sql, params) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        queries.push({ sql: s, params });
        if (s.includes('FROM working_memory')) throw new Error('unexpected end of JSON input');
        return { rows: [] };
      },
    };
    const r = await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
    expect(r).toMatchObject({ ok: false, error: 'unexpected end of JSON input' });
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb).toBeDefined();
    expect(hb.params[3]).toBe('parse_error');
    expect(hb.params[4]).toBe('parse_error');
    expect(hb.params[5]).toBe('unexpected end of JSON input');
  });

  it('查询哨兵失败（连接类错误）→ 心跳复用 classifyError 归类为 unreachable，与 n8n/launchd 腿口径一致', async () => {
    const queries = [];
    const pool = {
      queries,
      query: async (sql, params) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        queries.push({ sql: s, params });
        if (s.includes('FROM working_memory')) throw new Error('connect ETIMEDOUT');
        return { rows: [] };
      },
    };
    const r = await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
    expect(r).toMatchObject({ ok: false, error: 'connect ETIMEDOUT' });
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb).toBeDefined();
    expect(hb.params[3]).toBe('unreachable');
    expect(hb.params[4]).toBe('ssh_or_exec_failed');
  });

  it('下线的 job（不在本轮 jobs 里）source=scheduler 行置 cold 且清掉 silent_sec/liveness_at，不留"数据不足+停了N分钟"自相矛盾', async () => {
    const pool = fakePool({ sentinels: { 'ci-patrol': { at: iso(5), ok: true } } });
    await runSchedulerLiveness(pool, { jobs: [jobs[1]], now: NOW, raise: vi.fn(), bark: vi.fn() });
    const cleanup = pool.queries.find((q) => q.sql.includes('wf_id <> ALL'));
    expect(cleanup).toBeDefined();
    expect(cleanup.sql).toMatch(/source\s*=\s*'scheduler'/);
    expect(cleanup.sql).toMatch(/liveness\s*=\s*'cold'/);
    expect(cleanup.sql).toMatch(/silent_sec\s*=\s*NULL/);
    expect(cleanup.sql).toMatch(/liveness_at\s*=\s*NULL/);
    expect(cleanup.params[0]).toEqual(['ci-patrol']);
  });

  it('sentinelPrefix 可注入，SELECT 用注入前缀而非硬编码', async () => {
    const pool = fakePool({ sentinels: {} });
    await runSchedulerLiveness(pool, { jobs: [], now: NOW, raise: vi.fn(), bark: vi.fn(), sentinelPrefix: 'custom_prefix:' });
    const sel = pool.queries.find((q) => q.sql.includes('FROM working_memory'));
    expect(sel.params[0]).toBe('custom_prefix:%');
  });

  it('self=自身名字时不查自己的哨兵，以当前时刻计活（哨兵是 5000s 前的旧值也判 ok）', async () => {
    const selfJobs = [{ name: 'scheduler-liveness' }];
    const pool = fakePool({ sentinels: { 'scheduler-liveness': { at: iso(5000), ok: true } } });
    await runSchedulerLiveness(pool, { jobs: selfJobs, now: NOW, raise: vi.fn(), bark: vi.fn(), self: 'scheduler-liveness' });
    const up = pool.queries.find((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(up.params[6]).toBe('ok');
    expect(up.params[3]).toBe(new Date(NOW).toISOString()); // last_run_at = collectedAt，不是陈旧哨兵
  });

  it('不传 self 时同样的陈旧哨兵会判 dead（证明上一条用例是 self 生效，不是巧合）', async () => {
    const selfJobs = [{ name: 'scheduler-liveness' }];
    const pool = fakePool({ sentinels: { 'scheduler-liveness': { at: iso(5000), ok: true } } });
    await runSchedulerLiveness(pool, { jobs: selfJobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
    const up = pool.queries.find((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(up.params[6]).toBe('dead');
  });
});
