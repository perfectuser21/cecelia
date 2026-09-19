/**
 * TDD：统一推送引擎（三面模型 PR②a，决策 297ffee5 / 立项 f5ba8ee3）
 * 病根：13 个 push 里 9 个 insert-only（notion_synced_at IS NULL）——Brain 改了 Notion 永不更新；
 * 各自复制粘贴 create/UPDATE/错误处理，改一处漏八处。
 * 引擎契约：指纹按「将要发送的 properties」算；有 id 且指纹同→跳过；变了→PATCH；无 id→POST；
 * 404/错库→清 id+指纹下轮重建；stale relation→按旧行为标 synced 不死循环。库 id 优先从注册表取。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  propsDigest, pushRegisteredRows, resolveDbId,
} from '../notion-projection-engine.js';

const mkPool = (impl) => ({ query: vi.fn(impl || (async () => ({ rows: [] }))) });
const okNotion = () => vi.fn(async (token, path, method) => ({ id: method === 'POST' ? 'new-page' : 'patched' }));

describe('propsDigest', () => {
  it('同内容不同键序 → 同指纹；内容变 → 指纹变', () => {
    const a = propsDigest({ Name: { title: [{ text: { content: 'x' } }] }, Status: { select: { name: 'a' } } });
    const b = propsDigest({ Status: { select: { name: 'a' } }, Name: { title: [{ text: { content: 'x' } }] } });
    const c = propsDigest({ Name: { title: [{ text: { content: 'y' } }] }, Status: { select: { name: 'a' } } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('pushRegisteredRows', () => {
  const buildProps = (r) => ({ Name: { title: [{ text: { content: r.name } }] } });

  it('有 notion_id 且指纹相同 → 不调 Notion（防限流），只抬 synced 防饿死', async () => {
    const digest = propsDigest(buildProps({ name: 'same' }));
    const pool = mkPool(); const notion = okNotion();
    const res = await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'same', notion_id: 'p1', notion_digest: digest }], buildProps, notionReq: notion });
    expect(notion).not.toHaveBeenCalled();
    expect(res.skipped).toBe(1);
    expect(pool.query.mock.calls.some(c => /notion_digest/.test(c[0]))).toBe(false);
  });

  it('有 notion_id 但指纹变了 → PATCH 该页并回写新指纹（insert-only 缺陷的核心修复）', async () => {
    const pool = mkPool(); const notion = okNotion();
    await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'changed', notion_id: 'p1', notion_digest: 'old' }], buildProps, notionReq: notion });
    expect(notion).toHaveBeenCalledWith('t', '/pages/p1', 'PATCH', expect.objectContaining({ properties: expect.any(Object) }));
    const upd = pool.query.mock.calls.find(c => /UPDATE issues/.test(c[0]));
    expect(upd[0]).toMatch(/notion_digest/);
    expect(upd[1]).toContain(propsDigest(buildProps({ name: 'changed' })));
  });

  it('无 notion_id → POST 到注册表给的库，带 children，回写 id+指纹+synced', async () => {
    const pool = mkPool(); const notion = okNotion();
    await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'new', notion_id: null }], buildProps,
      buildChildren: () => [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }], notionReq: notion });
    expect(notion).toHaveBeenCalledWith('t', '/pages', 'POST', expect.objectContaining({
      parent: { database_id: 'db1' }, children: expect.any(Array) }));
    const upd = pool.query.mock.calls.find(c => /UPDATE issues/.test(c[0]));
    expect(upd[0]).toMatch(/notion_id/); expect(upd[0]).toMatch(/notion_digest/); expect(upd[0]).toMatch(/notion_synced_at/);
    expect(upd[1]).toContain('new-page');
  });

  it('404（页被人删）或错库 400 → 清 notion_id 与指纹，下轮重建', async () => {
    const pool = mkPool();
    const notion = vi.fn(async () => { throw new Error('Notion PATCH /pages/p1 → 404: Could not find page'); });
    await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'x', notion_id: 'p1', notion_digest: 'old' }], buildProps, notionReq: notion, logSyncError: async () => {} });
    const clr = pool.query.mock.calls.find(c => /notion_id\s*=\s*NULL/.test(c[0]));
    expect(clr).toBeTruthy();
    expect(clr[0]).toMatch(/notion_digest\s*=\s*NULL/);
  });

  it('stale relation（关联页失效）→ 标 synced 不死循环（沿用旧行为）', async () => {
    const pool = mkPool();
    const notion = vi.fn(async () => { throw new Error('Notion POST /pages → 400: Could not find database with ID: rel-x'); });
    await pushRegisteredRows(pool, 't', { table: 'journeys', dbId: 'db1',
      rows: [{ id: 1, name: 'x', notion_id: null }], buildProps, notionReq: notion, logSyncError: async () => {},
      isStaleRelationError: () => true });
    const upd = pool.query.mock.calls.find(c => /UPDATE journeys SET notion_synced_at\s*=\s*NOW\(\)/.test(c[0]));
    expect(upd).toBeTruthy();
  });
});

describe('resolveDbId — 库 id 优先从注册表取', () => {
  it('注册表有 active push 行 → 用它；没有 → 回退给的常量（安全灰度）', async () => {
    const pool = mkPool(async (sql, params) => /notion_projection_map/.test(sql) && params[0] === 'issues'
      ? { rows: [{ notion_db_id: 'reg-db' }] } : { rows: [] });
    expect(await resolveDbId(pool, 'issues', 'const-db')).toBe('reg-db');
    expect(await resolveDbId(pool, 'journeys', 'const-db')).toBe('const-db');
  });
});
