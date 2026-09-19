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
