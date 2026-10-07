/** 建库脚本：buildCreateDbBody / planCreate 纯函数 + 「可 import 不执行」。绝不碰真 Notion / 真库。 */
import { describe, it, expect } from 'vitest';
import { buildCreateDbBody, planCreate } from '../../scripts/ops/create-runs-notion-db.mjs';
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
