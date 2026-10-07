/**
 * OpenClaw 运行记录采集——纯函数单测（SQL / 命令 / 行映射）
 * 决策 c7ff6e02 / 9ec7a010；判定点 b7be0e26（结果按 status）/ 6d4b7ed5（任务名回退 job_id 前 8 位）
 * 不碰数据库、不执行 ssh。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildIngestSql,
  buildMmvCmd,
  parseSqliteJson,
  mapOpenclawRow,
  truncateText,
  findStreakStart,
  notifyFailureStreaks,
  OUTCOME_BY_STATUS,
} from '../openclaw-run-ingest.js';

const NOW = 1791400000000;
const DAY30 = 30 * 86400_000;

function baseRow(over = {}) {
  return {
    task_id: '5449a287-907f-4be8-bbb1-eb7b3792e50c',
    source_id: 'a9654769-fedb-4a84-a408-a9421bea74ea',
    agent_id: 'main',
    status: 'succeeded',
    created_at: 1791384725528,
    started_at: 1791384725528,
    ended_at: 1791384740472,
    terminal_summary: '{ "ok": true }',
    error: null,
    name: '悦升云端企业资料同步',
    payload_kind: 'command',
    ...over,
  };
}

describe('buildIngestSql', () => {
  it('sinceMs 为 null 时取 nowMs - 30 天', () => {
    const sql = buildIngestSql({ sinceMs: null, nowMs: NOW });
    expect(sql).toContain(`>= ${NOW - DAY30}`);
  });

  it('sinceMs 给定时用 sinceMs', () => {
    const sql = buildIngestSql({ sinceMs: 1791000000000, nowMs: NOW });
    expect(sql).toContain('>= 1791000000000');
    expect(sql).not.toContain(`>= ${NOW - DAY30}`);
  });

  it('含 cron 过滤、进行中兜底、LEFT JOIN、排序与默认 LIMIT 2000', () => {
    const sql = buildIngestSql({ sinceMs: null, nowMs: NOW });
    expect(sql).toContain("t.runtime='cron'");
    expect(sql).toContain("status IN ('running','queued')");
    expect(sql).toContain('coalesce(t.last_event_at,t.ended_at,t.created_at)');
    expect(sql).toContain('LEFT JOIN cron_jobs j ON j.job_id=t.source_id');
    expect(sql).toContain('ORDER BY t.created_at');
    expect(sql).toContain('LIMIT 2000');
    for (const col of [
      't.task_id', 't.source_id', 't.agent_id', 't.status', 't.created_at', 't.started_at',
      't.ended_at', 't.terminal_summary', 't.error', 'j.name', 'j.payload_kind',
    ]) {
      expect(sql).toContain(col);
    }
  });

  it('limit 可覆盖', () => {
    expect(buildIngestSql({ sinceMs: null, nowMs: NOW, limit: 50 })).toContain('LIMIT 50');
  });

  it('limit 越界（<1 或 >2000）抛 invalid_limit，边界值放行', () => {
    for (const bad of [0, -1, 2001]) {
      expect(() => buildIngestSql({ sinceMs: null, nowMs: NOW, limit: bad })).toThrow(/invalid_limit/);
    }
    expect(buildIngestSql({ sinceMs: null, nowMs: NOW, limit: 1 })).toContain('LIMIT 1');
    expect(buildIngestSql({ sinceMs: null, nowMs: NOW, limit: 2000 })).toContain('LIMIT 2000');
  });

  it('非整数入参抛错（防注入）', () => {
    expect(() => buildIngestSql({ sinceMs: '1;drop', nowMs: NOW })).toThrow();
    expect(() => buildIngestSql({ sinceMs: null, nowMs: 'x' })).toThrow();
    expect(() => buildIngestSql({ sinceMs: null, nowMs: NOW, limit: '1;drop' })).toThrow();
    expect(() => buildIngestSql({ sinceMs: 1.5, nowMs: NOW })).toThrow();
    expect(() => buildIngestSql({ sinceMs: NaN, nowMs: NOW })).toThrow();
  });
});

describe('buildMmvCmd', () => {
  it('SQL 经 base64 传输，命令里不含明文且可解码还原', () => {
    const cmd = buildMmvCmd('select 1');
    expect(cmd).not.toContain('select');
    expect(cmd).toContain('base64 -d | sqlite3 -readonly -json');
    expect(cmd.startsWith('ssh -o BatchMode=yes -o ConnectTimeout=20 mmv ')).toBe(true);
    expect(cmd).toContain('~/.openclaw/state/openclaw.sqlite');
    const m = cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m[1], 'base64').toString('utf8')).toBe('select 1');
  });

  it('中文与引号的 SQL 也能无损往返', () => {
    const sql = "select '悦升''x' as a";
    const cmd = buildMmvCmd(sql);
    const m = cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    expect(Buffer.from(m[1], 'base64').toString('utf8')).toBe(sql);
  });
});

describe('parseSqliteJson', () => {
  it('空串/空白 → []', () => {
    expect(parseSqliteJson('')).toEqual([]);
    expect(parseSqliteJson('  \n ')).toEqual([]);
  });

  it('数组 JSON 正常解析', () => {
    expect(parseSqliteJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('非数组 JSON 与非法 JSON 抛 parse_error', () => {
    expect(() => parseSqliteJson('{}')).toThrow(/parse_error/);
    expect(() => parseSqliteJson('oops')).toThrow(/parse_error/);
  });
});

describe('OUTCOME_BY_STATUS', () => {
  it('五种 status 映射', () => {
    expect(OUTCOME_BY_STATUS).toEqual({
      succeeded: 'pass', failed: 'fail', timed_out: 'timeout', running: 'running', queued: 'running',
    });
  });
});

describe('mapOpenclawRow', () => {
  it('完整行映射为 RunRow', () => {
    const r = mapOpenclawRow(baseRow());
    expect(r).toEqual({
      run_id: 'openclaw:5449a287-907f-4be8-bbb1-eb7b3792e50c',
      trigger_ref: '悦升云端企业资料同步',
      executor_kind: 'code',
      executor_id: 'openclaw:main',
      started_at: new Date(1791384725528),
      ended_at: new Date(1791384740472),
      outcome: 'pass',
      error: null,
      detail: {
        source: 'openclaw',
        job_id: 'a9654769-fedb-4a84-a408-a9421bea74ea',
        task_id: '5449a287-907f-4be8-bbb1-eb7b3792e50c',
        summary: '{ "ok": true }',
        status: 'succeeded',
      },
    });
  });

  it.each([
    ['succeeded', 'pass'], ['failed', 'fail'], ['timed_out', 'timeout'],
    ['running', 'running'], ['queued', 'running'], ['cancelled', 'unknown'], [null, 'unknown'],
  ])('status %s → outcome %s', (status, outcome) => {
    expect(mapOpenclawRow(baseRow({ status })).outcome).toBe(outcome);
  });

  it('name 为空时 trigger_ref 回退 openclaw-job:<job_id 前 8 位>', () => {
    expect(mapOpenclawRow(baseRow({ name: null })).trigger_ref).toBe('openclaw-job:a9654769');
    expect(mapOpenclawRow(baseRow({ name: '' })).trigger_ref).toBe('openclaw-job:a9654769');
  });

  it('payload_kind=command → code，其余 → agent', () => {
    expect(mapOpenclawRow(baseRow({ payload_kind: 'command' })).executor_kind).toBe('code');
    expect(mapOpenclawRow(baseRow({ payload_kind: 'agentTurn' })).executor_kind).toBe('agent');
    expect(mapOpenclawRow(baseRow({ payload_kind: null })).executor_kind).toBe('agent');
  });

  it('executor_id：有 agent_id → openclaw:<id>，空 → openclaw', () => {
    expect(mapOpenclawRow(baseRow({ agent_id: 'media' })).executor_id).toBe('openclaw:media');
    expect(mapOpenclawRow(baseRow({ agent_id: '' })).executor_id).toBe('openclaw');
    expect(mapOpenclawRow(baseRow({ agent_id: null })).executor_id).toBe('openclaw');
  });

  it('ended_at 早于 started_at 时置为 started_at', () => {
    const r = mapOpenclawRow(baseRow({ started_at: 2000, created_at: 2000, ended_at: 1000 }));
    expect(r.ended_at).toEqual(new Date(2000));
  });

  it('running 行 ended_at 为 null', () => {
    const r = mapOpenclawRow(baseRow({ status: 'running', ended_at: null }));
    expect(r.ended_at).toBeNull();
    const q = mapOpenclawRow(baseRow({ status: 'queued', ended_at: null }));
    expect(q.ended_at).toBeNull();
  });

  it('error 截 2000，summary 截 4000', () => {
    const r = mapOpenclawRow(baseRow({
      status: 'failed', error: 'e'.repeat(3000), terminal_summary: 's'.repeat(5000),
    }));
    expect(r.error).toHaveLength(2000);
    expect(r.detail.summary).toHaveLength(4000);
  });

  it('started_at 缺失时用 created_at', () => {
    const r = mapOpenclawRow(baseRow({ started_at: null, created_at: 1791384000000 }));
    expect(r.started_at).toEqual(new Date(1791384000000));
  });

  it('task_id 缺失 → null', () => {
    expect(mapOpenclawRow(baseRow({ task_id: null }))).toBeNull();
    expect(mapOpenclawRow(baseRow({ task_id: '' }))).toBeNull();
    expect(mapOpenclawRow(null)).toBeNull();
  });

  it('started_at 与 created_at 都非法 → null', () => {
    expect(mapOpenclawRow(baseRow({ started_at: null, created_at: null }))).toBeNull();
    expect(mapOpenclawRow(baseRow({ started_at: 'abc', created_at: 'xyz' }))).toBeNull();
  });
});

describe('truncateText', () => {
  const hasLoneSurrogate = (str) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(str);

  it('null/undefined → null；短串原样返回', () => {
    expect(truncateText(null, 10)).toBeNull();
    expect(truncateText(undefined, 10)).toBeNull();
    expect(truncateText('abc', 10)).toBe('abc');
  });

  it('普通字符串按码元截到 max', () => {
    expect(truncateText('a'.repeat(30), 10)).toHaveLength(10);
  });

  it('恰在代理对边界截断时不留孤立高代理项，且长度 <= max', () => {
    // 'a'*9 + emoji(2 码元) → 第 10 个码元是高代理项
    const s = 'a'.repeat(9) + '\u{1F600}' + 'tail';
    const out = truncateText(s, 10);
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out).toBe('a'.repeat(9));
  });

  it('代理对完整落在上限内时保留', () => {
    const out = truncateText('a'.repeat(8) + '\u{1F600}' + 'tail', 10);
    expect(out).toBe('a'.repeat(8) + '\u{1F600}');
  });

  it('mapOpenclawRow 的 error/summary 在代理对边界截断后可安全序列化', () => {
    const r = mapOpenclawRow(baseRow({
      status: 'failed',
      error: 'x'.repeat(1999) + '\u{1F600}',
      terminal_summary: 'y'.repeat(3999) + '\u{1F600}',
    }));
    expect(hasLoneSurrogate(r.error)).toBe(false);
    expect(hasLoneSurrogate(r.detail.summary)).toBe(false);
    expect(r.error.length).toBeLessThanOrEqual(2000);
    expect(r.detail.summary.length).toBeLessThanOrEqual(4000);
  });
});

describe('findStreakStart', () => {
  const rec = (...outs) => outs.map((outcome, i) => ({ run_id: `openclaw:r${i + 1}`, outcome }));

  it('连败不足 3 条 → null', () => {
    expect(findStreakStart(rec('fail', 'fail', 'pass'))).toBeNull();
    expect(findStreakStart([])).toBeNull();
  });

  it('fail 与 timeout 混合连败 3 条 → 起点为第 3 条', () => {
    expect(findStreakStart(rec('fail', 'timeout', 'fail'))).toEqual({ firstRunId: 'openclaw:r3', count: 3 });
  });

  it('连败段在第一条非失败处截止，更早的失败不计', () => {
    expect(findStreakStart(rec('fail', 'fail', 'fail', 'fail', 'pass', 'fail')))
      .toEqual({ firstRunId: 'openclaw:r4', count: 4 });
  });

  it('最近一条就是成功 → null', () => {
    expect(findStreakStart(rec('pass', 'fail', 'fail', 'fail'))).toBeNull();
  });
});

describe('notifyFailureStreaks', () => {
  const failRows = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
    run_id: `openclaw:r${i + 1}`, outcome: 'fail', error: null, summary: null, ...extra,
  }));
  const fakeDb = (rows) => ({ query: vi.fn().mockResolvedValue({ rows }) });

  it('firstRound=true → 不查库、不发 Bark', async () => {
    const db = fakeDb(failRows(5));
    const sendBark = vi.fn();
    expect(await notifyFailureStreaks(db, ['任务A'], { sendBark, firstRound: true })).toEqual({ notified: 0 });
    expect(sendBark).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('连败 3 次 → 发一次，标题/正文/去重键符合约定', async () => {
    const rows = failRows(3, { error: null, summary: 'x' });
    rows[0].error = '超时了';
    const db = fakeDb(rows);
    const sendBark = vi.fn().mockResolvedValue(true);
    const r = await notifyFailureStreaks(db, ['任务A'], { sendBark, firstRound: false });
    expect(r).toEqual({ notified: 1 });
    expect(sendBark).toHaveBeenCalledTimes(1);
    expect(sendBark).toHaveBeenCalledWith(
      'OpenClaw 任务连续失败',
      '任务A 连续 3 次失败：超时了',
      { dedupeKey: 'openclaw-run-streak:任务A:openclaw:r3', dedupeTtlSec: 604800 },
    );
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("run_id LIKE 'openclaw:%'");
    expect(sql).toContain("outcome <> 'running'");
    expect(sql).toContain('ORDER BY started_at DESC');
    expect(sql).toContain('LIMIT 50');
    expect(params).toEqual(['任务A']);
  });

  it('error 为空时回退 summary，正文最多取 120 字且不切开代理对', async () => {
    const rows = failRows(3, { error: '', summary: 'y'.repeat(119) + '\u{1F600}' });
    const sendBark = vi.fn();
    await notifyFailureStreaks(fakeDb(rows), ['任务A'], { sendBark, firstRound: false });
    const body = sendBark.mock.calls[0][1];
    expect(body).toBe('任务A 连续 3 次失败：' + 'y'.repeat(119));
  });

  it('连败 2 次 → 不发', async () => {
    const sendBark = vi.fn();
    const r = await notifyFailureStreaks(fakeDb(failRows(2)), ['任务A'], { sendBark, firstRound: false });
    expect(r).toEqual({ notified: 0 });
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('多个任务名各自判定', async () => {
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: failRows(3) })
      .mockResolvedValueOnce({ rows: failRows(1) }) };
    const sendBark = vi.fn();
    const r = await notifyFailureStreaks(db, ['甲', '乙'], { sendBark, firstRound: false });
    expect(r).toEqual({ notified: 1 });
    expect(sendBark.mock.calls[0][1]).toContain('甲 连续 3 次失败');
  });
});
