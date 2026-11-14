/**
 * TDD：入口血管 ingest（三面模型 PR②b，决策 297ffee5 / 立项 f5ba8ee3）
 * ✍️ 入口库人写、Brain 收：「决策」库 → decisions。
 * 收据表 notion_ingest_receipts 保证幂等；人改了 → 再收并留痕（冲突人赢）。机器不写入口库。
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../recurring-notion-sync.js', () => ({
  notionReq: vi.fn(), getToken: () => 'isolated-test-token',
}));
import {
  NOTION_TYPE_TO_CATEGORY, mapDecisionPage,
  ingestDecisionsInlet, runNotionInletIngest,
} from '../notion-inlet-ingest.js';

const page = (over = {}) => ({
  id: 'page-1', last_edited_time: '2026-09-17T09:20:00.000Z',
  properties: {
    '决策': { type: 'title', title: [{ plain_text: 'TikTok 采用 API 上传草稿' }] },
    '结论': { type: 'rich_text', rich_text: [{ plain_text: '改用 video.upload 草稿模式' }] },
    '理由': { type: 'rich_text', rich_text: [{ plain_text: '避免反复切换可见性' }] },
    '背景': { type: 'rich_text', rich_text: [{ plain_text: '未审核 Direct Post 只能发私密' }] },
    '类型': { type: 'select', select: { name: '项目' } },
    '状态': { type: 'select', select: { name: '已决定' } },
    '决策日期': { type: 'date', date: { start: '2026-09-17' } },
    ...over,
  },
});

describe('mapDecisionPage', () => {
  it('把「决策」库一行映射成 decisions 行：类型走 CHECK 白名单、背景并入 reason、source_ref=notion:<page>', () => {
    const r = mapDecisionPage(page());
    expect(r.topic).toBe('TikTok 采用 API 上传草稿');
    expect(r.decision).toBe('改用 video.upload 草稿模式');
    expect(r.reason).toContain('避免反复切换可见性');
    expect(r.reason).toContain('背景');
    expect(r.category).toBe(NOTION_TYPE_TO_CATEGORY['项目']);
    expect(['governance','scope-decision','process','technical','general','decision']).toContain(r.category);
    expect(r.made_by).toBe('user');
    expect(r.source_ref).toBe('notion:page-1');
    expect(r.decided_at).toBe('2026-09-17');
  });
  it('草案 / 已推翻 不收（只收已决定）', () => {
    expect(mapDecisionPage(page({ '状态': { type: 'select', select: { name: '草案' } } }))).toBeNull();
  });
  it('无结论时用标题当 decision，不丢行', () => {
    const r = mapDecisionPage(page({ '结论': { type: 'rich_text', rich_text: [] } }));
    expect(r.decision).toBe('TikTok 采用 API 上传草稿');
  });
});

function mkPool(receipts = {}) {
  const calls = [];
  const pool = { query: vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM notion_ingest_receipts/.test(sql)) {
      const r = receipts[params[0]]; return { rows: r ? [r] : [] };
    }
    if (/INSERT INTO decisions/.test(sql)) return { rows: [{ id: 'dec-new' }] };
    return { rows: [] };
  }) };
  return { pool, calls };
}
const notionOf = (pages) => vi.fn(async (token, path, method) => /\/query$/.test(path) ? { results: pages, has_more: false } : {});

describe('ingestDecisionsInlet', () => {
  it('首次见到 → INSERT decisions(made_by=user) + 写收据；不写 Notion', async () => {
    const { pool, calls } = mkPool();
    const notion = notionOf([page()]);
    const s = await ingestDecisionsInlet(pool, 't', { dbId: 'db', notionReq: notion });
    expect(s.inserted).toBe(1);
    expect(calls.some(c => /INSERT INTO decisions/.test(c.sql) && c.params.includes('user'))).toBe(true);
    expect(calls.some(c => /INSERT INTO notion_ingest_receipts/.test(c.sql))).toBe(true);
    expect(notion.mock.calls.every(c => c[2] !== 'PATCH' && c[2] !== 'POST' || /\/query$/.test(c[1]))).toBe(true);
  });
  it('收据 last_edited 与页面相同 → 跳过，不写库', async () => {
    const { pool, calls } = mkPool({ 'page-1': { notion_page_id: 'page-1', brain_id: 'dec-1', last_edited_time: new Date('2026-09-17T09:20:00.000Z') } });
    const s = await ingestDecisionsInlet(pool, 't', { dbId: 'db', notionReq: notionOf([page()]) });
    expect(s.skipped).toBe(1);
    expect(calls.some(c => /INSERT|UPDATE decisions/.test(c.sql))).toBe(false);
  });
  it('人改了（页面更新时间更新）→ UPDATE decisions 并在收据 history 留痕（冲突人赢）', async () => {
    const { pool, calls } = mkPool({ 'page-1': { notion_page_id: 'page-1', brain_id: 'dec-1', last_edited_time: new Date('2026-09-10T00:00:00.000Z') } });
    const s = await ingestDecisionsInlet(pool, 't', { dbId: 'db', notionReq: notionOf([page()]) });
    expect(s.updated).toBe(1);
    const upd = calls.find(c => /UPDATE decisions/.test(c.sql));
    expect(upd).toBeTruthy(); expect(upd.params).toContain('dec-1');
    const rc = calls.find(c => /UPDATE notion_ingest_receipts/.test(c.sql));
    expect(rc.sql).toMatch(/history/);
  });
});

describe('注册表入口派发', () => {
  it('历史员工Skill注册不再下载或建单，仍正常回灌决策', async () => {
    const { pool, calls } = mkPool();
    const query = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM notion_projection_map')) return { rows: [
        { face: 'inlet', brain_table: 'skill_evals', notion_db_id: 'old-staff', status: 'active', direction: 'ingest' },
        { face: 'inlet', brain_table: 'decisions', notion_db_id: 'decisions-live', status: 'active', direction: 'both' },
      ] };
      return query(sql, params);
    });
    const notionReq = notionOf([page()]);
    const download = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected download'));
    try {
      const result = await runNotionInletIngest(pool, { now: () => 1_800_000_000_000, notionReq });
      expect(result.ok).toBe(true);
      expect(result.results.decisions.inserted).toBe(1);
      expect(result.results).not.toHaveProperty('skill_evals');
      expect(result.sources.map((source) => source.brain_table)).toEqual(['decisions']);
      expect(notionReq.mock.calls.map((call) => call[1])).toEqual(['/databases/decisions-live/query']);
      expect(download).not.toHaveBeenCalled();
      expect(calls.filter(({ sql }) => /INSERT INTO decisions/.test(sql))).toHaveLength(1);
      expect(calls.some(({ sql }) => /INSERT INTO (tasks|skill_evals)/.test(sql))).toBe(false);
    } finally {
      download.mockRestore();
    }
  });
});
