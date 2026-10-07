/** runs → Notion「最近执行」投影：属性构造（纯函数）+ 库未登记时安静跳过。全程注入假 notionReq，绝不碰真 Notion。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildRunProps, runRunsNotionPush, archiveRows, RUNS_DB_PROPS, IN_WINDOW_SQL, _resetRunsNotionPushGate,
} from '../runs-notion-projection.js';

const COLUMNS = ['Brain ID', '任务', '执行者', '开始时间', '摘要', '来源', '结果', '耗时（秒）', '错误'];

const openclawFail = {
  id: 'u1', run_id: 'openclaw:abc', trigger_kind: 'schedule', trigger_ref: '每日简报',
  executor_id: 'openclaw:main', started_at: new Date('2026-10-05T01:02:03.000Z'),
  duration_ms: 12345, outcome: 'fail', error: '炸了'.repeat(1000),
  detail: { source: 'openclaw', summary: '摘'.repeat(3000) },
};
const brainPass = {
  id: 'u2', run_id: 'brain:xyz', trigger_kind: 'schedule', trigger_ref: 'tick-loop',
  executor_id: 'brain-scheduler', started_at: '2026-10-06T00:00:00.000Z',
  duration_ms: null, outcome: 'pass', error: null, detail: {},
};

describe('buildRunProps', () => {
  it('OpenClaw 失败行：结果/来源/耗时换算，摘要与错误截到 1900', () => {
    const p = buildRunProps(openclawFail);
    expect(Object.keys(p).sort()).toEqual([...COLUMNS].sort());
    expect(p['任务']).toEqual({ title: [{ text: { content: '每日简报' } }] });
    expect(p['开始时间']).toEqual({ date: { start: '2026-10-05T01:02:03.000Z' } });
    expect(p['结果']).toEqual({ select: { name: '失败' } });
    expect(p['耗时（秒）']).toEqual({ number: 12.3 });
    expect(p['执行者']).toEqual({ rich_text: [{ text: { content: 'openclaw:main' } }] });
    expect(p['来源']).toEqual({ select: { name: 'OpenClaw' } });
    expect(p['摘要'].rich_text[0].text.content).toHaveLength(1900);
    expect(p['错误'].rich_text[0].text.content).toHaveLength(1900);
    expect(p['Brain ID']).toEqual({ rich_text: [{ text: { content: 'openclaw:abc' } }] });
  });

  it('Brain 内部 pass 行：耗时 null 保持 null，空摘要/错误给空 rich_text，来源=Brain', () => {
    const p = buildRunProps(brainPass);
    expect(p['结果']).toEqual({ select: { name: '成功' } });
    expect(p['耗时（秒）']).toEqual({ number: null });
    expect(p['来源']).toEqual({ select: { name: 'Brain' } });
    expect(p['摘要']).toEqual({ rich_text: [] });
    expect(p['错误']).toEqual({ rich_text: [] });
    expect(p['开始时间']).toEqual({ date: { start: '2026-10-06T00:00:00.000Z' } });
  });

  it('结果与来源映射表', () => {
    const o = (outcome) => buildRunProps({ ...brainPass, outcome })['结果'].select.name;
    expect([o('timeout'), o('running'), o('skipped'), o('unknown'), o('weird')]).toEqual(['超时', '运行中', '跳过', '未知', '未知']);
    expect(buildRunProps({ ...brainPass, trigger_kind: 'external' })['来源'].select.name).toBe('外部上报');
    expect(buildRunProps({ ...brainPass, run_id: 'openclaw:1', trigger_kind: 'external' })['来源'].select.name).toBe('OpenClaw');
  });

  it('trigger_ref 缺失时标题回退 run_id', () => {
    expect(buildRunProps({ ...brainPass, trigger_ref: null })['任务'].title[0].text.content).toBe('brain:xyz');
  });
});

describe('RUNS_DB_PROPS / IN_WINDOW_SQL', () => {
  it('9 列齐全，select 选项写全', () => {
    expect(Object.keys(RUNS_DB_PROPS).sort()).toEqual([...COLUMNS].sort());
    expect(RUNS_DB_PROPS['任务']).toEqual({ title: {} });
    expect(RUNS_DB_PROPS['结果'].select.options.map((o) => o.name)).toEqual(['成功', '失败', '超时', '运行中', '跳过', '未知']);
    expect(RUNS_DB_PROPS['来源'].select.options.map((o) => o.name)).toEqual(['OpenClaw', 'Brain', '外部上报']);
  });
  it('窗口 SQL 含 7 天与 30 天两档', () => {
    expect(IN_WINDOW_SQL).toContain("interval '7 days'");
    expect(IN_WINDOW_SQL).toContain("interval '30 days'");
  });
});

describe('runRunsNotionPush', () => {
  beforeEach(() => { _resetRunsNotionPushGate(); });

  // 假 pool：库已登记；推送查询返回 pushRows，归档查询返回 archiveRows，其余（UPDATE）记账
  function makePool({ pushRows = [], archiveRowsList = [] } = {}) {
    const query = vi.fn(async (sql) => {
      if (sql.includes('notion_projection_map')) return { rows: [{ notion_db_id: 'db1' }] };
      if (sql.includes('updated_at > notion_synced_at')) return { rows: pushRows };
      if (sql.includes('NOT (')) return { rows: archiveRowsList };
      return { rows: [], rowCount: 1 };
    });
    return { query };
  }
  const row = (i, over = {}) => ({ ...brainPass, id: `r${i}`, run_id: `brain:${i}`, notion_id: null, notion_digest: null, ...over });
  const archiveSelects = (pool) => pool.query.mock.calls.filter(([sql]) => sql.includes('NOT ('));

  it('自 gate：120s 内第二次调用返回 skipped，不查库；满 120s 后照常执行', async () => {
    let t = 1_000_000;
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const r1 = await runRunsNotionPush({ query }, { now: () => t, notionReq: vi.fn() });
    expect(r1).toEqual({ skipped: 'db_not_registered' });
    expect(query).toHaveBeenCalledTimes(1);
    t += 119_000;
    expect(await runRunsNotionPush({ query }, { now: () => t, notionReq: vi.fn() })).toEqual({ skipped: true });
    expect(query).toHaveBeenCalledTimes(1);
    t += 1_000;
    expect(await runRunsNotionPush({ query }, { now: () => t, notionReq: vi.fn() })).toEqual({ skipped: 'db_not_registered' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('首行 notionReq 抛 AbortError（超时，无 status）→ 整批终止：后续行不调用、不归档', async () => {
    const pool = makePool({ pushRows: [row(1), row(2), row(3)], archiveRowsList: [row(9, { notion_id: 'old' })] });
    const notionReq = vi.fn(async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; });
    const r = await runRunsNotionPush(pool, { notionReq, getToken: () => 'tok' });
    expect(notionReq).toHaveBeenCalledTimes(1);
    expect(r.archive_stopped).toBe(true);
    expect(archiveSelects(pool)).toHaveLength(0);
  });

  it('首行 notionReq 抛 TimeoutError / fetch failed（无 status）→ 同样整批终止', async () => {
    for (const mk of [
      () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; },
      () => new TypeError('fetch failed'),
    ]) {
      _resetRunsNotionPushGate();
      const pool = makePool({ pushRows: [row(1), row(2)] });
      const notionReq = vi.fn(async () => { throw mk(); });
      const r = await runRunsNotionPush(pool, { notionReq, getToken: () => 'tok' });
      expect(notionReq).toHaveBeenCalledTimes(1);
      expect(r.archive_stopped).toBe(true);
      expect(archiveSelects(pool)).toHaveLength(0);
    }
  });

  it('首行 429 → 整批终止：后续行不调用、不归档', async () => {
    const pool = makePool({ pushRows: [row(1), row(2), row(3)], archiveRowsList: [row(9, { notion_id: 'old' })] });
    const notionReq = vi.fn(async (tok, path, method) => {
      const e = new Error(`Notion ${method} ${path} → 429: rate limited`); e.status = 429; throw e;
    });
    const r = await runRunsNotionPush(pool, { notionReq, getToken: () => 'tok' });
    expect(notionReq).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ archived: 0, archive_stopped: true });
    expect(archiveSelects(pool)).toHaveLength(0);
  });

  it('推送侧 PATCH 返回 400「Can\'t edit block that is archived」→ 清 notion_id 走重建，不整批终止', async () => {
    const pool = makePool({ pushRows: [row(1, { notion_id: 'gone', notion_digest: 'old' }), row(2)] });
    const notionReq = vi.fn(async (tok, path, method) => {
      if (method === 'PATCH') {
        const e = new Error(`Notion PATCH ${path} → 400: Can't edit block that is archived. You must unarchive the block before editing.`);
        e.status = 400; throw e;
      }
      return { id: 'new-page' };
    });
    const r = await runRunsNotionPush(pool, { notionReq, getToken: () => 'tok' });
    expect(r.pushed).toMatchObject({ cleared: 1, created: 1, failed: 0 });
    const cleared = pool.query.mock.calls.find(([sql, args]) => sql.includes('SET notion_id = NULL') && args[0] === 'r1');
    expect(cleared).toBeTruthy();
  });
});

describe('archiveRows 错误分类', () => {
  const mkErr = (status, msg) => { const e = new Error(`Notion PATCH → ${status}: ${msg}`); e.status = status; return e; };

  it('非 404 的 4xx（400 已归档）→ warn、清三列、继续下一行', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const notionReq = vi.fn(async (tok, path) => {
      if (path === '/pages/a') throw mkErr(400, "Can't edit block that is archived.");
      return {};
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await archiveRows(db, 'tok', [{ id: 'A', notion_id: 'a' }, { id: 'B', notion_id: 'b' }], notionReq);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(r.stopped).toBe(false);
    expect(notionReq).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.map(([, args]) => args[0])).toEqual(['A', 'B']);
  });

  it('429 / 5xx / 无 status 网络错误 → 停止本轮，不清该行', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const err of [mkErr(429, 'slow down'), mkErr(502, 'bad gateway'), new TypeError('fetch failed')]) {
      const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      const notionReq = vi.fn(async () => { throw err; });
      const r = await archiveRows(db, 'tok', [{ id: 'A', notion_id: 'a' }, { id: 'B', notion_id: 'b' }], notionReq);
      expect(r).toEqual({ archived: 0, stopped: true });
      expect(notionReq).toHaveBeenCalledTimes(1);
      expect(db.query).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });

  it('401（key 失效）/ 409（短暂 conflict）→ 停止本轮，不清该行（notion_id 保留）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const err of [mkErr(401, 'unauthorized'), mkErr(409, 'conflict')]) {
      const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      const notionReq = vi.fn(async () => { throw err; });
      const r = await archiveRows(db, 'tok', [{ id: 'A', notion_id: 'a' }, { id: 'B', notion_id: 'b' }], notionReq);
      expect(r).toEqual({ archived: 0, stopped: true });
      expect(notionReq).toHaveBeenCalledTimes(1);
      expect(db.query).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });

  it('410（页已不存在）→ 清三列继续下一行', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const notionReq = vi.fn(async (tok, path) => { if (path === '/pages/a') throw mkErr(410, 'gone'); return {}; });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await archiveRows(db, 'tok', [{ id: 'A', notion_id: 'a' }, { id: 'B', notion_id: 'b' }], notionReq);
    warn.mockRestore();
    expect(r.stopped).toBe(false);
    expect(notionReq).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.map(([, args]) => args[0])).toEqual(['A', 'B']);
  });
});

describe('runRunsNotionPush 推送侧 403', () => {
  beforeEach(() => { _resetRunsNotionPushGate(); });

  it('首行 403（权限收回）→ 整批终止：后续行不调用、不归档', async () => {
    const query = vi.fn(async (sql) => {
      if (sql.includes('notion_projection_map')) return { rows: [{ notion_db_id: 'db1' }] };
      if (sql.includes('updated_at > notion_synced_at')) {
        return { rows: [1, 2, 3].map((i) => ({ ...brainPass, id: `r${i}`, run_id: `brain:${i}`, notion_id: null, notion_digest: null })) };
      }
      return { rows: [], rowCount: 1 };
    });
    const notionReq = vi.fn(async (tok, path, method) => {
      const e = new Error(`Notion ${method} ${path} → 403: restricted`); e.status = 403; throw e;
    });
    const r = await runRunsNotionPush({ query }, { notionReq, getToken: () => 'tok' });
    expect(notionReq).toHaveBeenCalledTimes(1);
    expect(r.archive_stopped).toBe(true);
    expect(query.mock.calls.filter(([sql]) => sql.includes('NOT ('))).toHaveLength(0);
  });
});

describe('runRunsNotionPush 安静跳过', () => {
  beforeEach(() => { _resetRunsNotionPushGate(); });

  it('库未注册（projection_map 无 active 行）→ skipped，不调 Notion、不读 runs', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const notionReq = vi.fn();
    const r = await runRunsNotionPush({ query }, { notionReq });
    expect(r).toEqual({ skipped: 'db_not_registered' });
    expect(notionReq).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('库已注册但缺 NOTION_API_KEY → skipped no_token，不调 Notion', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ notion_db_id: 'db1' }] });
    const notionReq = vi.fn();
    const r = await runRunsNotionPush({ query }, { notionReq, getToken: () => { throw new Error('NOTION_API_KEY 未配置'); } });
    expect(r).toEqual({ skipped: 'no_token' });
    expect(notionReq).not.toHaveBeenCalled();
  });
});
