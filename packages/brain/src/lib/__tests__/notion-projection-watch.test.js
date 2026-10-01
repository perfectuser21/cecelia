/**
 * TDD：守夜遍历（三面模型 PR③，决策 297ffee5 / 立项 f5ba8ee3）
 * 对账不再一根一根手写：遍历 notion_projection_map，每根血管自带断言。
 *  A7 registry_coverage   有 notion_id 列却未登记 → 红（新表接了列不登记=纸门）
 *  A8 mirror_tampered     🔒 镜子库 24h 内被非机器人改过 → 红 + 留痕 notion_sync_log + 置 notion_digest=NULL 令下轮重推覆盖
 *  A9 constants_match     代码里的库常量 / working_memory.ops_notion_dbs 必须等于注册表（否则 resolveDbId 翻转会打错库）
 *  A10 projection_counts  🔒 push 库：Brain 有 notion_id 的行数 == Notion 页数（人往镜子里加行会被抓）
 */
import { describe, it, expect, vi } from 'vitest';
import { buildProjectionAssertions } from '../notion-projection-watch.js';

const REG = [
  { notion_db_id: 'db-issues', title: 'Issues', face: 'mirror', brain_table: 'issues', direction: 'push', status: 'active', vessel: 'notion-push-sync.pushIssues' },
  { notion_db_id: 'db-tasks', title: 'Tasks', face: 'inlet', brain_table: 'tasks', direction: 'both', status: 'active', vessel: 'x' },
  { notion_db_id: 'db-know', title: 'Knowledge', face: 'truth', brain_table: 'knowledge', direction: 'none', status: 'active', vessel: null },
];
function mkPool({ unregistered = [], brainCounts = {}, extra = {} } = {}) {
  const calls = [];
  const pool = { query: vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/information_schema\.columns/.test(sql)) return { rows: [...new Set(['issues', 'tasks', 'knowledge', ...unregistered])].map(t => ({ table_name: t })) };
    if (/FROM notion_projection_map/.test(sql) && /brain_table IS NOT NULL/.test(sql) && /DISTINCT/.test(sql)) return { rows: REG.filter(r => r.brain_table).map(r => ({ brain_table: r.brain_table })) };
    if (/FROM notion_projection_map/.test(sql)) return { rows: REG };
    if (/working_memory/.test(sql)) return { rows: extra.ops ? [{ value_json: extra.ops }] : [] };
    const m = /count\(\*\).*FROM (\w+) WHERE notion_id IS NOT NULL/s.exec(sql);
    if (m) return { rows: [{ count: String(brainCounts[m[1]] ?? 0) }] };
    return { rows: [] };
  }) };
  return { pool, calls };
}
const BOT = 'bot-1';
function notionWith({ pages = {}, tampered = {} } = {}) {
  return vi.fn(async (token, path, method, body) => {
    const db = path.match(/databases\/([^/]+)\/query/)?.[1];
    if (!db) return {};
    if (body?.filter?.timestamp === 'last_edited_time') {
      return { results: (tampered[db] || []).map((t, i) => ({ id: `pg-${i}`, last_edited_by: { id: t.by }, properties: { Name: { type: 'title', title: [{ plain_text: t.title }] } } })), has_more: false };
    }
    return { results: Array.from({ length: pages[db] ?? 0 }, (_, i) => ({ id: `p${i}` })), has_more: false };
  });
}

describe('A7 registry_coverage', () => {
  it('全部带 notion_id 的表都已登记 → 绿', async () => {
    const { pool } = mkPool();
    const rs = await buildProjectionAssertions(pool, { notionReq: notionWith(), token: 't', botUserId: BOT, constants: {} });
    expect(rs.find(r => r.key === 'registry_coverage').ok).toBe(true);
  });
  it('有表带 notion_id 列却未登记 → 红并点名', async () => {
    const { pool } = mkPool({ unregistered: ['ghost_table'] });
    const rs = await buildProjectionAssertions(pool, { notionReq: notionWith(), token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'registry_coverage');
    expect(a.ok).toBe(false); expect(a.detail).toContain('ghost_table');
  });
});

describe('A8 mirror_tampered', () => {
  it('镜子库被非机器人改过 → 红、留痕 notion_sync_log、置该行 notion_digest=NULL 令下轮重推覆盖', async () => {
    const { pool, calls } = mkPool();
    const notion = notionWith({ tampered: { 'db-issues': [{ by: 'human-9', title: '被人改的 issue' }] } });
    const rs = await buildProjectionAssertions(pool, { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'mirror_tampered');
    expect(a.ok).toBe(false); expect(a.detail).toContain('Issues');
    expect(calls.some(c => /INSERT INTO notion_sync_log/.test(c.sql) && /mirror_tamper/.test(c.sql + JSON.stringify(c.params)))).toBe(true);
    expect(calls.some(c => /UPDATE issues SET notion_digest = NULL WHERE notion_id = \$1/.test(c.sql))).toBe(true);
  });
  it('镜子库只有机器人自己改过 → 绿；入口/真身库不检查', async () => {
    const { pool } = mkPool();
    const notion = notionWith({ tampered: { 'db-issues': [{ by: BOT, title: 'bot edit' }], 'db-tasks': [{ by: 'human', title: '人写任务' }] } });
    const rs = await buildProjectionAssertions(pool, { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    expect(rs.find(r => r.key === 'mirror_tampered').ok).toBe(true);
  });
});

describe('A9 constants_match', () => {
  it('代码常量与注册表同库 → 绿；不同 → 红并点名', async () => {
    const { pool } = mkPool();
    const ok = await buildProjectionAssertions(pool, { notionReq: notionWith(), token: 't', botUserId: BOT, constants: { issues: 'db-issues' } });
    expect(ok.find(r => r.key === 'constants_match').ok).toBe(true);
    const bad = await buildProjectionAssertions(pool, { notionReq: notionWith(), token: 't', botUserId: BOT, constants: { issues: 'db-OTHER' } });
    const a = bad.find(r => r.key === 'constants_match');
    expect(a.ok).toBe(false); expect(a.detail).toContain('issues');
  });
});

describe('A10 projection_counts', () => {
  it('🔒 push 库 Brain 行数 == Notion 页数 → 绿；不等 → 红并给出两个数', async () => {
    const { pool } = mkPool({ brainCounts: { issues: 3 } });
    const ok = await buildProjectionAssertions(pool, { notionReq: notionWith({ pages: { 'db-issues': 3 } }), token: 't', botUserId: BOT, constants: {} });
    expect(ok.find(r => r.key === 'projection_counts').ok).toBe(true);
    const bad = await buildProjectionAssertions(pool, { notionReq: notionWith({ pages: { 'db-issues': 5 } }), token: 't', botUserId: BOT, constants: {} });
    const a = bad.find(r => r.key === 'projection_counts');
    expect(a.ok).toBe(false); expect(a.detail).toMatch(/Issues.*3.*5|Issues.*5.*3/);
  });
  it('Notion 不可达 → 标 degraded 不算红（外部抖动不天天叫）', async () => {
    const { pool } = mkPool({ brainCounts: { issues: 3 } });
    const notion = vi.fn(async () => { throw new Error('Notion 503'); });
    const rs = await buildProjectionAssertions(pool, { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'projection_counts');
    expect(a.ok).toBe(true); expect(a.degraded).toBe(true);
  });
});

describe('一库多表 / 一表多库 的取行纪律（生产 proven-to-fire 抓出的两处）', () => {
  const REG2 = [
    { notion_db_id: 'db-notes', title: 'AI Notes', face: 'mirror', brain_table: 'decisions', direction: 'push', status: 'active', vessel: 'notion-push-sync.pushDecisions' },
    { notion_db_id: 'db-notes', title: 'AI Notes', face: 'mirror', brain_table: 'initiative_contracts', direction: 'push', status: 'active', vessel: 'notion-push-sync.pushInitiativeContracts' },
    { notion_db_id: 'db-juece', title: '决策', face: 'inlet', brain_table: 'decisions', direction: 'ingest', status: 'active', vessel: 'inlet' },
  ];
  function pool2(counts) {
    return { query: vi.fn(async (sql) => {
      if (/information_schema\.columns/.test(sql)) return { rows: [{ table_name: 'decisions' }, { table_name: 'initiative_contracts' }] };
      if (/FROM notion_projection_map/.test(sql) && /DISTINCT/.test(sql)) return { rows: [{ brain_table: 'decisions' }, { brain_table: 'initiative_contracts' }] };
      if (/FROM notion_projection_map/.test(sql)) return { rows: REG2 };
      const m = /FROM (\w+) WHERE notion_id IS NOT NULL/.exec(sql); if (m) return { rows: [{ count: String(counts[m[1]] ?? 0) }] };
      return { rows: [] };
    }) };
  }
  it('A9：decisions 既有镜子行(AI Notes)又有入口行(决策库)——代码常量应对镜子行比，不能撞到入口行', async () => {
    const notion = vi.fn(async (t, path, m, body) => body?.filter?.timestamp ? { results: [] } : { results: [], has_more: false });
    const rs = await buildProjectionAssertions(pool2({}), { notionReq: notion, token: 't', botUserId: 'b', constants: { decisions: 'db-notes' } });
    expect(rs.find(r => r.key === 'constants_match').ok).toBe(true);
  });
  it('A10：AI Notes 同时装 decisions+initiative_contracts → Brain 两表合计再与 Notion 页数比', async () => {
    const notion = vi.fn(async (t, path, m, body) => body?.filter?.timestamp ? { results: [] } : { results: Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i })), has_more: false });
    const rs = await buildProjectionAssertions(pool2({ decisions: 5, initiative_contracts: 2 }), { notionReq: notion, token: 't', botUserId: 'b', constants: {} });
    expect(rs.find(r => r.key === 'projection_counts').ok).toBe(true);
  });
});

describe('A11 mirror_db_reachable（镜子库探活，决策 24a37029）', () => {
  // 09-19 起三个库进回收站都是上产后手工才发现：Notion 对回收站里的库 GET 200 但 in_trash:true / archived:true，写入 404。
  // 对 status=active 且 direction∈{push,both} 的每个库 GET /databases/{id}：in_trash/archived=true 或 404 → 红；其它错误 → degraded 不红。
  const REG3 = [
    { notion_db_id: 'db-issues', title: 'Issues', face: 'mirror', brain_table: 'issues', direction: 'push', status: 'active', vessel: 'notion-push-sync.pushIssues' },
    { notion_db_id: 'db-tasks', title: 'Tasks', face: 'inlet', brain_table: 'tasks', direction: 'both', status: 'active', vessel: 'x' },
    { notion_db_id: 'db-old', title: 'AI Journey', face: 'mirror', brain_table: 'journeys', direction: 'none', status: 'archived', vessel: '(停推)' },
    { notion_db_id: 'db-know', title: 'Knowledge', face: 'truth', brain_table: 'knowledge', direction: 'none', status: 'active', vessel: null },
  ];
  function pool3() {
    return { query: vi.fn(async (sql) => {
      if (/information_schema\.columns/.test(sql)) return { rows: REG3.filter(r => r.brain_table).map(r => ({ table_name: r.brain_table })) };
      if (/FROM notion_projection_map/.test(sql) && /DISTINCT/.test(sql)) return { rows: REG3.map(r => ({ brain_table: r.brain_table })) };
      if (/FROM notion_projection_map/.test(sql)) return { rows: REG3 };
      if (/count\(\*\)/.test(sql)) return { rows: [{ count: '0' }] };
      return { rows: [] };
    }) };
  }
  /** GET /databases/{id} 按表给响应；query 端点照旧返回空 */
  function notionGet(byDb) {
    return vi.fn(async (token, path, method) => {
      const m = /^\/databases\/([^/]+)$/.exec(path);
      if (m && method === 'GET') {
        const v = byDb[m[1]];
        if (v instanceof Error) throw v;
        return v ?? { object: 'database', id: m[1], in_trash: false, archived: false };
      }
      return { results: [], has_more: false };
    });
  }

  it('全部 active 推送库 GET 200 且未进回收站 → 绿，并说明探了几个库', async () => {
    const notion = notionGet({});
    const rs = await buildProjectionAssertions(pool3(), { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'mirror_db_reachable');
    expect(a).toBeTruthy();
    expect(a.ok).toBe(true);
    expect(a.detail).toMatch(/2 个/);
    // 只探 active 且 push/both：issues + tasks；archived 的 db-old 与 truth/none 的 db-know 不探
    const probed = notion.mock.calls.filter(c => /^\/databases\/[^/]+$/.test(c[1]) && c[2] === 'GET').map(c => c[1]);
    expect(probed.sort()).toEqual(['/databases/db-issues', '/databases/db-tasks']);
  });

  it('GET 200 但 in_trash:true → 红并点名库；结果带 lost 清单供晨报/日报', async () => {
    const notion = notionGet({ 'db-issues': { object: 'database', id: 'db-issues', in_trash: true, archived: false } });
    const rs = await buildProjectionAssertions(pool3(), { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'mirror_db_reachable');
    expect(a.ok).toBe(false);
    expect(a.detail).toContain('Issues');
    expect(a.detail).toMatch(/回收站/);
    expect(a.lost).toEqual([expect.objectContaining({ title: 'Issues', table: 'issues', reason: 'in_trash' })]);
  });

  it('archived:true 同样算失联', async () => {
    const notion = notionGet({ 'db-tasks': { object: 'database', id: 'db-tasks', in_trash: false, archived: true } });
    const rs = await buildProjectionAssertions(pool3(), { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'mirror_db_reachable');
    expect(a.ok).toBe(false);
    expect(a.lost).toEqual([expect.objectContaining({ title: 'Tasks', reason: 'archived' })]);
  });

  it('GET 404 → 红（库被删/未共享）', async () => {
    const notion = notionGet({ 'db-issues': new Error('Notion GET /databases/db-issues → 404: Could not find database with ID: db-issues.') });
    const rs = await buildProjectionAssertions(pool3(), { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'mirror_db_reachable');
    expect(a.ok).toBe(false);
    expect(a.lost).toEqual([expect.objectContaining({ title: 'Issues', reason: '404' })]);
  });

  it('其它错误（503/超时）→ degraded 不红，不拖垮整轮', async () => {
    const notion = notionGet({ 'db-issues': new Error('Notion 503'), 'db-tasks': new Error('fetch timeout') });
    const rs = await buildProjectionAssertions(pool3(), { notionReq: notion, token: 't', botUserId: BOT, constants: {} });
    const a = rs.find(r => r.key === 'mirror_db_reachable');
    expect(a.ok).toBe(true);
    expect(a.degraded).toBe(true);
    expect(a.lost).toEqual([]);
  });
});

describe('独立 KR 投影沿 projection_links 对账', () => {
  const registry = [{ notion_db_id: 'db-brain-kr', title: 'Brain Key Results', face: 'mirror', brain_table: 'key_results', direction: 'push', vessel: 'notion-kr-projection', status: 'active' }];
  function krPool() {
    return { query: vi.fn(async sql => {
      if (sql.includes('information_schema')) return { rows: [] };
      if (sql.includes('FROM notion_projection_map')) return { rows: registry };
      if (sql.includes('count(*)') && sql.includes('projection_links')) return { rows: [{ count: 2 }] };
      return { rows: [] };
    }) };
  }
  it('非机器人修改KR镜子清links指纹，禁止向key_results写不存在的notion列', async () => {
    const pool = krPool();
    await buildProjectionAssertions(pool, { notionReq: notionWith({ tampered: { 'db-brain-kr': [{ by: 'human', title: '改过' }] } }), token: 't', botUserId: BOT });
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE projection_links SET content_hash = NULL/.test(sql))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE key_results SET notion_digest/.test(sql))).toBe(false);
  });
  it('KR库页数与已绑定Brain实体数不等须报红', async () => {
    const result = await buildProjectionAssertions(krPool(), { notionReq: notionWith({ pages: { 'db-brain-kr': 3 } }), token: 't', botUserId: BOT });
    expect(result.find(r => r.key === 'projection_counts')).toMatchObject({ ok: false, degraded: false });
  });
});

it('KR漏推时即使链接和远端都各一行仍报红，不能隐藏其余应投影KR', async () => {
  const row = { notion_db_id: 'db-brain-kr', title: 'Brain Key Results', face: 'mirror', brain_table: 'key_results', direction: 'push', vessel: 'notion-kr-projection', status: 'active' };
  const pool = { query: vi.fn(async sql => {
    if (sql.includes('information_schema')) return { rows: [] };
    if (sql.includes('FROM notion_projection_map')) return { rows: [row] };
    if (sql.includes('FROM projection_links')) return { rows: [{ count: 1, entity_id: 'kr-1', external_id: 'p0' }] };
    if (sql.includes('FROM key_results')) return { rows: [{ count: 38 }] };
    return { rows: [] };
  }) };
  const result = await buildProjectionAssertions(pool, { notionReq: notionWith({ pages: { 'db-brain-kr': 1 } }), token: 't', botUserId: BOT });
  expect(result.find(r => r.key === 'projection_counts')).toMatchObject({ ok: false, degraded: false });
});
