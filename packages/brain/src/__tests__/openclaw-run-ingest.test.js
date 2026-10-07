/**
 * OpenClaw 运行记录采集——纯函数单测（SQL / 命令 / 行映射）
 * 决策 c7ff6e02 / 9ec7a010；判定点 b7be0e26（结果按 status）/ 6d4b7ed5（任务名回退 job_id 前 8 位）
 * 不碰数据库、不执行 ssh。
 */
import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildHostCmd } from '../host-exec.js';
import {
  runOpenclawRunIngest,
  upsertRuns,
  buildIngestSql,
  buildMmvCmd,
  parseSqliteJson,
  mapOpenclawRow,
  truncateText,
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

describe('notifyFailureStreaks', () => {
  // 新口径：每个任务名一条 SQL 直接求真起点，返回单行 {count, first_run_id, error, summary}
  const streakRow = (over = {}) => ({ count: 3, first_run_id: 'openclaw:r1', error: null, summary: null, ...over });
  const fakeDb = (row) => ({ query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) });

  it('firstRound=true → 不查库、不发 Bark', async () => {
    const db = fakeDb(streakRow({ count: 9 }));
    const sendBark = vi.fn();
    expect(await notifyFailureStreaks(db, ['任务A'], { sendBark, firstRound: true })).toEqual({ notified: 0 });
    expect(sendBark).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('连败 3 次 → 发一次，标题/正文/去重键符合约定', async () => {
    const db = fakeDb(streakRow({ error: '超时了', summary: 'x' }));
    const sendBark = vi.fn().mockResolvedValue(true);
    const r = await notifyFailureStreaks(db, ['任务A'], { sendBark, firstRound: false });
    expect(r).toEqual({ notified: 1 });
    expect(sendBark).toHaveBeenCalledTimes(1);
    expect(sendBark).toHaveBeenCalledWith(
      'OpenClaw 任务连续失败',
      '任务A 连续 3 次失败：超时了',
      { dedupeKey: 'openclaw-run-streak:任务A:openclaw:r1', dedupeTtlSec: 604800 },
    );
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("run_id LIKE 'openclaw:%'");
    expect(sql).toContain("NOT IN ('fail','timeout','running')");
    expect(sql).toContain("IN ('fail','timeout')");
    expect(sql).not.toContain('LIMIT 50');
    expect(params).toEqual(['任务A']);
  });

  it('error 为空时回退 summary，正文最多取 120 字且不切开代理对', async () => {
    const db = fakeDb(streakRow({ error: '', summary: 'y'.repeat(119) + '\u{1F600}' }));
    const sendBark = vi.fn();
    await notifyFailureStreaks(db, ['任务A'], { sendBark, firstRound: false });
    expect(sendBark.mock.calls[0][1]).toBe('任务A 连续 3 次失败：' + 'y'.repeat(119));
  });

  it('连败 2 次或无失败行 → 不发', async () => {
    const sendBark = vi.fn();
    expect(await notifyFailureStreaks(fakeDb(streakRow({ count: 2 })), ['任务A'], { sendBark, firstRound: false })).toEqual({ notified: 0 });
    expect(await notifyFailureStreaks(fakeDb(streakRow({ count: 0, first_run_id: null })), ['任务A'], { sendBark, firstRound: false })).toEqual({ notified: 0 });
    expect(await notifyFailureStreaks(fakeDb(null), ['任务A'], { sendBark, firstRound: false })).toEqual({ notified: 0 });
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('多个任务名各自判定', async () => {
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [streakRow()] })
      .mockResolvedValueOnce({ rows: [streakRow({ count: 1 })] }) };
    const sendBark = vi.fn();
    const r = await notifyFailureStreaks(db, ['甲', '乙'], { sendBark, firstRound: false });
    expect(r).toEqual({ notified: 1 });
    expect(sendBark.mock.calls[0][1]).toContain('甲 连续 3 次失败');
  });
});

// —— 采集编排 ——
describe('runOpenclawRunIngest', () => {
  const NOW_MS = 1791400000000;
  const failRow = (over = {}) => baseRow({ status: 'failed', error: '炸了', ...over });
  const sqlOf = (cmd) => Buffer.from(cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/)[1], 'base64').toString('utf8');

  // 假 db：按 SQL 特征分派。cursor 为 Date/null；streak 为连败查询返回行
  function makeDb({ cursor = null, streak = null, upsertRowCount = 1 } = {}) {
    const query = vi.fn(async (sql) => {
      if (sql.includes('WITH last_ok')) return { rows: streak ? [streak] : [] }; // 连败 SQL 也含 max(started_at)，须先判
      if (sql.includes('max(started_at)')) return { rows: [{ max_started: cursor }] };
      if (sql.includes('INSERT INTO runs')) return { rows: [], rowCount: upsertRowCount };
      throw new Error(`unexpected sql: ${sql.slice(0, 40)}`);
    });
    return { query };
  }
  const deps = (over = {}) => ({
    exec: vi.fn().mockResolvedValue(JSON.stringify([failRow(), failRow({ task_id: null })])),
    inContainer: false,
    sendBark: vi.fn().mockResolvedValue(true),
    now: () => NOW_MS,
    ...over,
  });
  const insertCalls = (db) => db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO runs'));

  it('两行（一合法 fail、一缺 task_id）→ fetched 2 / skipped_rows 1 / written 1，命令含 mmv 与 base64 -d', async () => {
    const db = makeDb();
    const d = deps();
    const r = await runOpenclawRunIngest(db, d);
    expect(r).toEqual({ fetched: 2, written: 1, skipped_rows: 1, failed_rows: 0, notified: 0, backlog: false });
    expect(d.exec).toHaveBeenCalledTimes(1);
    const [cmd, opts] = d.exec.mock.calls[0];
    expect(cmd).toContain('mmv');
    expect(cmd).toContain('base64 -d');
    expect(cmd.startsWith('ssh -o BatchMode=yes')).toBe(true);
    expect(opts).toEqual({ timeoutMs: 60_000 });
    expect(insertCalls(db)).toHaveLength(1);
  });

  it('inContainer=true → 命令以 ssh -i 开头（经 buildHostCmd 逃逸）', async () => {
    const d = deps({ inContainer: true });
    await runOpenclawRunIngest(makeDb(), d);
    expect(d.exec.mock.calls[0][0].startsWith('ssh -i ')).toBe(true);
  });

  it('exec 抛错 → 整体抛错且不写库', async () => {
    const db = makeDb();
    const d = deps({ exec: vi.fn().mockRejectedValue(new Error('ssh_timeout')) });
    await expect(runOpenclawRunIngest(db, d)).rejects.toThrow('ssh_timeout');
    expect(insertCalls(db)).toHaveLength(0);
  });

  it('输出不是 JSON 数组 → 抛 parse_error 且不写库', async () => {
    const db = makeDb();
    await expect(runOpenclawRunIngest(db, deps({ exec: vi.fn().mockResolvedValue('boom') }))).rejects.toThrow('parse_error');
    expect(insertCalls(db)).toHaveLength(0);
  });

  it('游标为 null（首轮）→ 回填 30 天窗口，不发 Bark，也不查连败', async () => {
    const db = makeDb({ cursor: null, streak: { count: 9, first_run_id: 'openclaw:x', error: 'e', summary: null } });
    const d = deps();
    const r = await runOpenclawRunIngest(db, d);
    expect(d.sendBark).not.toHaveBeenCalled();
    expect(r.notified).toBe(0);
    expect(sqlOf(d.exec.mock.calls[0][0])).toContain(`>= ${NOW_MS - 30 * 86400_000}`);
  });

  it('游标非 null → SQL 用游标（已减 1h）；本批 fail/timeout 且连败≥3 → 按任务名去重各发一次 Bark', async () => {
    const cursor = new Date(NOW_MS - 7200_000);
    const db = makeDb({ cursor, streak: { count: 3, first_run_id: 'openclaw:r1', error: '炸了', summary: null } });
    const rows = [failRow(), failRow({ task_id: 'b' }), failRow({ task_id: 'c', name: '另一任务', status: 'timed_out' }), baseRow({ task_id: 'd', name: '全绿任务' })];
    const d = deps({ exec: vi.fn().mockResolvedValue(JSON.stringify(rows)) });
    const r = await runOpenclawRunIngest(db, d);
    expect(sqlOf(d.exec.mock.calls[0][0])).toContain(`>= ${NOW_MS - 7200_000 - 3600_000}`);
    const streakCalls = db.query.mock.calls.filter(([s]) => s.includes('WITH last_ok'));
    expect(streakCalls.map(([, p]) => p[0]).sort()).toEqual(['另一任务', '悦升云端企业资料同步']);
    expect(d.sendBark).toHaveBeenCalledTimes(2);
    expect(r.notified).toBe(2);
  });

  it('sendBark 抛错被吞：采集不失败，notified 记 0', async () => {
    const db = makeDb({ cursor: new Date(NOW_MS), streak: { count: 3, first_run_id: 'openclaw:r1', error: 'e', summary: null } });
    const d = deps({ sendBark: vi.fn().mockRejectedValue(new Error('bark_down')) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runOpenclawRunIngest(db, d);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(r.notified).toBe(0);
    expect(r.written).toBe(1);
  });

  it('连败查询的库错误也被吞（告警是尽力而为）', async () => {
    const db = { query: vi.fn(async (sql) => {
      if (sql.includes('WITH last_ok')) throw new Error('db_down');
      if (sql.includes('max(started_at)')) return { rows: [{ max_started: new Date(NOW_MS) }] };
      if (sql.includes('INSERT INTO runs')) return { rows: [], rowCount: 1 };
      throw new Error('unexpected');
    }) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runOpenclawRunIngest(db, deps());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(r.notified).toBe(0);
    expect(r.written).toBe(1);
  });

  it('backlog：fetched === 2000 为 true', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => baseRow({ task_id: `t${i}` }));
    const r = await runOpenclawRunIngest(makeDb(), deps({ exec: vi.fn().mockResolvedValue(JSON.stringify(many)) }));
    expect(r.fetched).toBe(2000);
    expect(r.backlog).toBe(true);
  });

  it('单行写库失败计入 failed_rows，不中断整批', async () => {
    let n = 0;
    const db = { query: vi.fn(async (sql) => {
      if (sql.includes('max(started_at)')) return { rows: [{ max_started: null }] };
      if (sql.includes('INSERT INTO runs')) { n += 1; if (n === 2) throw new Error('bad row'); return { rows: [], rowCount: 1 }; }
      return { rows: [] };
    }) };
    const rows = ['a', 'b', 'c'].map((id) => baseRow({ task_id: id }));
    const r = await runOpenclawRunIngest(db, deps({ exec: vi.fn().mockResolvedValue(JSON.stringify(rows)) }));
    expect(r).toMatchObject({ fetched: 3, written: 2, failed_rows: 1 });
  });
});

describe('upsertRuns 逐行容错（假 db）', () => {
  it('单行抛错 → 其余照常写，返回 { written, failed_rows }', async () => {
    let n = 0;
    const db = { query: vi.fn(async () => { n += 1; if (n === 1) throw new Error('x'); return { rowCount: 1 }; }) };
    const rows = [1, 2, 3].map((i) => ({ run_id: `openclaw:${i}`, trigger_ref: 't', executor_kind: 'agent', executor_id: 'e',
      started_at: new Date(), ended_at: null, outcome: 'running', error: null, detail: null }));
    expect(await upsertRuns(db, rows)).toEqual({ written: 2, failed_rows: 1 });
    expect(db.query).toHaveBeenCalledTimes(3);
  });
});

describe('buildHostCmd(buildMmvCmd(sql), true) 往返', () => {
  // 用本机 sh 逐层“解包”：把 ssh 替换成打印最后一个参数的函数，得到各层远端 shell 实际收到的命令；
  // 最后把 sqlite3 替换成 cat，验证 base64 段经两层引号嵌套后仍还原为原 SQL。不触网、不真 ssh。
  const peel = (cmd) => execFileSync('sh', ['-c', `ssh() { for a; do last="$a"; done; printf %s "$last"; }; ${cmd}`], { encoding: 'utf8' });

  it.each([
    'select 1',
    `select '悦升''x' as a, "b" from t where n = 'it''s'`,
  ])('base64 段解码后仍等于原 sql：%s', (sql) => {
    const outer = buildHostCmd(buildMmvCmd(sql), true, () => true);
    expect(outer.startsWith('ssh -i ')).toBe(true);
    const hostCmd = peel(outer);           // 宿主 shell 收到的：ssh ... mmv '...'
    expect(hostCmd.startsWith('ssh -o BatchMode=yes')).toBe(true);
    const mmvCmd = peel(hostCmd);          // mmv 远端 shell 收到的：echo b64 | base64 -d | sqlite3 ...
    expect(mmvCmd).toContain('base64 -d | sqlite3 -readonly -json');
    const out = execFileSync('sh', ['-c', `sqlite3() { cat; }; ${mmvCmd}`], { encoding: 'utf8' });
    expect(out).toBe(sql);
  });
});
