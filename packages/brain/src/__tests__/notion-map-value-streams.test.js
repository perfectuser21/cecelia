/**
 * [BEHAVIOR] 价值流镜子 notion-map-value-streams（决策 e00d9cc3 / 9d5fce74）。
 *
 * Brain 结构地图 active run 的 value_stream 节点 →「价值流 Value Streams」库，一行一条价值流：
 *  - 按 (scope, node_key) upsert，记账表 notion_map_node_pages（主键 scope+node_key）
 *  - 指纹（不含同步时间）不变不打 Notion
 *  - active run 里已不存在的节点 → 页面「状态」标已归档（PATCH，不删页面）
 *  - 库未在 notion_projection_map 登记 push+active → 整段跳过
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pushMapValueStreams, buildValueStreamProps, valueStreamDigest,
} from '../notion-map-value-streams.js';

const DB = 'db-value-streams';

const FACTORY = {
  scope_key: 'cecelia', manifest_version: 7, manifest_digest: 'a'.repeat(64),
  node_key: 'factory', name: '工厂', attributes: { order: 1, perceiver: '待造软件' },
  capabilities: [
    { key: 'MJ5', name: '账本', order: 2 },
    { key: 'F0', name: '需求入口', order: 1 },
  ],
};
const LINE01 = {
  scope_key: 'zenithjoy-workspace', manifest_version: 6, manifest_digest: 'b'.repeat(64),
  node_key: 'line01', name: 'Line 01 客户首次成功', attributes: { order: 1, perceiver: '客户端（Customer App）' },
  capabilities: [],
};

function makePool({ registered = true, nodes = [], ledger = [] } = {}) {
  const writes = [];
  return {
    writes,
    query: vi.fn(async (sql, params) => {
      const text = String(sql);
      if (/FROM notion_projection_map/.test(text)) {
        return { rows: registered && params?.[0] === 'notion_map_node_pages' ? [{ notion_db_id: DB }] : [] };
      }
      if (/FROM map_projection_runs/.test(text)) return { rows: nodes };
      if (/^\s*SELECT[\s\S]*FROM notion_map_node_pages/.test(text)) return { rows: ledger };
      if (/INSERT INTO notion_map_node_pages/.test(text) || /UPDATE notion_map_node_pages/.test(text)) {
        writes.push({ sql: text, params });
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

let notionReq;
beforeEach(() => {
  notionReq = vi.fn(async (token, p, method) => {
    if (method === 'GET') return { properties: { Name: { type: 'title' } } };
    if (p === '/pages' && method === 'POST') return { id: `page-${notionReq.mock.calls.length}` };
    return {};
  });
});

const pageCalls = () => notionReq.mock.calls.filter(([, p, m]) => p.startsWith('/pages') && (m === 'POST' || m === 'PATCH'));

describe('buildValueStreamProps', () => {
  it('一条价值流一行：Name/Key/Scope/Persona/能力逐行按 order/能力数/地图版本/状态在册', () => {
    const p = buildValueStreamProps(FACTORY);
    expect(p.Name.title[0].text.content).toBe('工厂');
    expect(p.Key.rich_text[0].text.content).toBe('factory');
    expect(p.Scope).toEqual({ select: { name: 'cecelia' } });
    expect(p.Persona.rich_text[0].text.content).toBe('待造软件');
    expect(p['能力'].rich_text[0].text.content).toBe('F0 需求入口\nMJ5 账本');
    expect(p['能力数']).toEqual({ number: 2 });
    expect(p['地图版本'].rich_text[0].text.content).toMatch(/^v7 · a{8}/);
    expect(p['状态']).toEqual({ select: { name: '在册' } });
    expect(p['同步时间']).toBeUndefined();
  });

  it('无能力的价值流：能力列空、能力数 0', () => {
    const p = buildValueStreamProps(LINE01);
    expect(p['能力']).toEqual({ rich_text: [] });
    expect(p['能力数']).toEqual({ number: 0 });
  });
});

describe('pushMapValueStreams', () => {
  it('库未登记 push+active → 整段跳过，不打 Notion', async () => {
    const pool = makePool({ registered: false, nodes: [FACTORY] });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toBeNull();
    expect(notionReq).not.toHaveBeenCalled();
  });

  it('新节点 → POST 到登记库并按 (scope,node_key) upsert 记账表，带同步时间', async () => {
    const pool = makePool({ nodes: [FACTORY, LINE01] });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toMatchObject({ created: 2, patched: 0, skipped: 0, archived: 0 });
    const posts = pageCalls().filter(([, , m]) => m === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0][3].parent).toEqual({ database_id: DB });
    expect(posts[0][3].properties['同步时间'].date.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ups = pool.writes.filter((w) => /INSERT INTO notion_map_node_pages/.test(w.sql));
    expect(ups).toHaveLength(2);
    expect(ups[0].sql).toMatch(/ON CONFLICT \(scope, node_key\) DO UPDATE/);
    expect(ups[0].params.slice(0, 3)).toEqual(['cecelia', 'factory', expect.stringMatching(/^page-/)]);
    expect(ups[0].params[3]).toBe(valueStreamDigest(FACTORY));
  });

  it('指纹不变 → 不打 Notion 写接口', async () => {
    const ledger = [{ scope: 'cecelia', node_key: 'factory', notion_id: 'page-f', notion_digest: valueStreamDigest(FACTORY) }];
    const pool = makePool({ nodes: [FACTORY], ledger });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toMatchObject({ created: 0, patched: 0, skipped: 1, archived: 0 });
    expect(pageCalls()).toHaveLength(0);
  });

  it('内容变了 → PATCH 已有页面并回写新指纹', async () => {
    const ledger = [{ scope: 'cecelia', node_key: 'factory', notion_id: 'page-f', notion_digest: 'stale' }];
    const pool = makePool({ nodes: [FACTORY], ledger });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toMatchObject({ patched: 1, created: 0 });
    const [[, path, method, body]] = pageCalls();
    expect([path, method]).toEqual(['/pages/page-f', 'PATCH']);
    expect(body.properties['能力数']).toEqual({ number: 2 });
    const up = pool.writes.find((w) => /INSERT INTO notion_map_node_pages/.test(w.sql));
    expect(up.params[3]).toBe(valueStreamDigest(FACTORY));
  });

  it('页面 404（被人删了）→ 重新 POST 建页', async () => {
    const ledger = [{ scope: 'cecelia', node_key: 'factory', notion_id: 'page-dead', notion_digest: 'stale' }];
    notionReq.mockImplementation(async (t, p, m) => {
      if (m === 'GET') return { properties: {} };
      if (p === '/pages/page-dead') throw new Error('Notion 404: Could not find page');
      if (p === '/pages' && m === 'POST') return { id: 'page-new' };
      return {};
    });
    const pool = makePool({ nodes: [FACTORY], ledger });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toMatchObject({ created: 1 });
    const up = pool.writes.find((w) => /INSERT INTO notion_map_node_pages/.test(w.sql));
    expect(up.params[2]).toBe('page-new');
  });

  it('页面进了回收站（400 archived ancestor）→ 视同 404 重新 POST', async () => {
    const ledger = [{ scope: 'cecelia', node_key: 'factory', notion_id: 'page-trash', notion_digest: 'stale' }];
    notionReq.mockImplementation(async (t, p, m) => {
      if (m === 'GET') return { properties: {} };
      if (p === '/pages/page-trash') throw new Error("Notion 400: Can't edit block that is archived. You must unarchive the block before editing. archived ancestor");
      if (p === '/pages' && m === 'POST') return { id: 'page-new2' };
      return {};
    });
    const pool = makePool({ nodes: [FACTORY], ledger });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toMatchObject({ created: 1, failed: 0 });
  });

  it('active run 里消失的节点 → 页面状态标已归档（PATCH，不删页面），记账表记 archived_at', async () => {
    const ledger = [
      { scope: 'cecelia', node_key: 'factory', notion_id: 'page-f', notion_digest: valueStreamDigest(FACTORY) },
      { scope: 'cecelia', node_key: 'old_stream', notion_id: 'page-old', notion_digest: 'x', archived_at: null },
    ];
    const pool = makePool({ nodes: [FACTORY], ledger });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toMatchObject({ archived: 1, skipped: 1 });
    const calls = pageCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('/pages/page-old');
    expect(calls[0][2]).toBe('PATCH');
    expect(calls[0][3].properties['状态']).toEqual({ select: { name: '已归档' } });
    expect(calls[0][3].archived).toBeUndefined();
    expect(notionReq.mock.calls.some(([, , m]) => m === 'DELETE')).toBe(false);
    const w = pool.writes.find((x) => /UPDATE notion_map_node_pages/.test(x.sql));
    expect(w.sql).toMatch(/archived_at = NOW\(\)/);
    expect(w.params).toEqual(['cecelia', 'old_stream', expect.any(String)]);
  });

  it('已归档过的节点不重复 PATCH', async () => {
    const ledger = [{ scope: 'cecelia', node_key: 'old_stream', notion_id: 'page-old', notion_digest: 'x', archived_at: '2026-09-29T00:00:00Z' }];
    const pool = makePool({ nodes: [FACTORY], ledger });
    await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(pageCalls().filter(([, p]) => p === '/pages/page-old')).toHaveLength(0);
  });

  it('地图整体读空（0 个价值流）→ 不归档任何页面（防空地图抹镜子）', async () => {
    const ledger = [{ scope: 'cecelia', node_key: 'factory', notion_id: 'page-f', notion_digest: 'x', archived_at: null }];
    const pool = makePool({ nodes: [], ledger });
    const out = await pushMapValueStreams(pool, 'tok', { notionReq });
    expect(out).toMatchObject({ archived: 0 });
    expect(pageCalls()).toHaveLength(0);
  });

  it('推前补缺列：GET 库结构后 PATCH 缺的列', async () => {
    const pool = makePool({ nodes: [] });
    await pushMapValueStreams(pool, 'tok', { notionReq });
    const patchDb = notionReq.mock.calls.find(([, p, m]) => p === `/databases/${DB}` && m === 'PATCH');
    expect(Object.keys(patchDb[3].properties)).toEqual(expect.arrayContaining(['Key', 'Scope', '能力', '能力数', '状态']));
  });

  it('读地图 SQL 只取 active run 的 value_stream 与 contains→capability', async () => {
    const pool = makePool({ nodes: [] });
    await pushMapValueStreams(pool, 'tok', { notionReq });
    const sql = pool.query.mock.calls.map(([s]) => String(s)).find((s) => /FROM map_projection_runs/.test(s));
    expect(sql).toMatch(/r\.status = 'active'/);
    expect(sql).toMatch(/node_type = 'value_stream'/);
    expect(sql).toMatch(/edge_type = 'contains'/);
    expect(sql).toMatch(/node_type = 'capability'/);
  });
});
