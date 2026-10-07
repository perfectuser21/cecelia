/** 建库脚本：buildCreateDbBody / planCreate 纯函数 + 「可 import 不执行」。绝不碰真 Notion / 真库。 */
import { describe, it, expect, vi } from 'vitest';
import { buildCreateDbBody, planCreate, main } from '../../scripts/ops/create-runs-notion-db.mjs';
import { RUNS_DB_PROPS } from '../runs-notion-projection.js';

describe('buildCreateDbBody', () => {
  it('父页、标题「最近执行」、properties 等于 RUNS_DB_PROPS', () => {
    const body = buildCreateDbBody('abc');
    expect(body.parent).toEqual({ page_id: 'abc' });
    expect(body.title).toEqual([{ type: 'text', text: { content: '最近执行' } }]);
    expect(body.properties).toEqual(RUNS_DB_PROPS);
    expect(Object.keys(body.properties)).toHaveLength(9);
  });

  it('缺父页 id 直接抛错，不构造半截请求体', () => {
    expect(() => buildCreateDbBody('')).toThrow(/parent_page_id/);
    expect(() => buildCreateDbBody(undefined)).toThrow(/parent_page_id/);
  });
});

describe('planCreate', () => {
  it('已存在 active 的 runs 行 → 拒绝重复建库', () => {
    const plan = planCreate({ mapRows: [{ status: 'active', notion_db_id: 'x' }], parentPageId: 'p' });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('已存在');
  });
  it('只有 pending_vessel 占位行 → 可建', () => {
    expect(planCreate({ mapRows: [{ status: 'pending_vessel' }], parentPageId: 'p' }).ok).toBe(true);
  });
  it('没有占位行（迁移 532 未跑）→ 拒绝', () => {
    expect(planCreate({ mapRows: [], parentPageId: 'p' }).ok).toBe(false);
  });
  it('目录投影没配父页 → 拒绝', () => {
    expect(planCreate({ mapRows: [{ status: 'pending_vessel' }], parentPageId: null }).ok).toBe(false);
  });
});

describe('main（注入假 pool / notionReq）', () => {
  function fakePool({ updateRowCount = 1 } = {}) {
    const query = vi.fn(async (sql) => {
      if (sql.includes('UPDATE notion_projection_map')) return { rows: [], rowCount: updateRowCount };
      if (sql.includes('FROM notion_projection_map')) return { rows: [{ notion_db_id: 'unmapped:runs', status: 'pending_vessel' }] };
      if (sql.includes('FROM projection_targets')) return { rows: [{ config: { parent_page_id: 'parent-1' } }] };
      throw new Error(`unexpected sql: ${sql.slice(0, 40)}`);
    });
    return { query, end: vi.fn() };
  }
  const env = { DATABASE_URL: 'postgresql://fake/none' };
  const updates = (pool) => pool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE'));

  it('dry-run：不调 notionReq、不执行 UPDATE，退出码 0', async () => {
    const pool = fakePool();
    const notionReq = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main([], env, { pool, notionReq, getToken: () => 'tok' });
    log.mockRestore();
    expect(code).toBe(0);
    expect(notionReq).not.toHaveBeenCalled();
    expect(updates(pool)).toHaveLength(0);
  });

  it('--apply：建库成功但 UPDATE 命中 0 行 → 退出码 2 并打印新库 id', async () => {
    const pool = fakePool({ updateRowCount: 0 });
    const notionReq = vi.fn().mockResolvedValue({ id: 'new-db-123' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--apply'], env, { pool, notionReq, getToken: () => 'tok' });
    const errText = err.mock.calls.flat().join('\n');
    log.mockRestore(); err.mockRestore();
    expect(code).toBe(2);
    expect(notionReq).toHaveBeenCalledTimes(1);
    expect(updates(pool)).toHaveLength(1);
    expect(errText).toContain('new-db-123');
  });

  it('--apply：UPDATE 命中 1 行 → 退出码 0', async () => {
    const pool = fakePool({ updateRowCount: 1 });
    const notionReq = vi.fn().mockResolvedValue({ id: 'new-db-456' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--apply'], env, { pool, notionReq, getToken: () => 'tok' });
    log.mockRestore();
    expect(code).toBe(0);
  });
});
