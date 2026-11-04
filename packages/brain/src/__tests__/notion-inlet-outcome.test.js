import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../recurring-notion-sync.js', () => ({ getToken: () => 'controlled', notionReq: vi.fn() }));
const inletRows = vi.hoisted(() => ({ value: [] }));
vi.mock('../lib/notion-projection-registry.js', () => ({ loadProjectionMap: async () => ({ byFace: { inlet: inletRows.value } }) }));
beforeEach(() => { inletRows.value = [{ status: 'active', direction: 'ingest', brain_table: 'decisions', notion_db_id: 'controlled' }]; });
import { runNotionInletIngest } from '../notion-inlet-ingest.js';
let clock = 1_000_000_000;
describe('入口逐项失败传播到调度结果', () => {
  it.each(['notion_query', 'page_write'])('%s不伪报整批成功', async kind => {
    const pool = { query: vi.fn(async sql => {
      if (sql.includes('FROM notion_ingest_receipts')) throw new Error('controlled page failure');
      return { rows: [] };
    }) };
    const notionReq = async () => {
      if (kind === 'notion_query') throw new Error('controlled query failure');
      return { results: [{ id: 'page', last_edited_time: '2026-11-04T00:00:00Z', properties: { '状态': { select: { name: '已决定' } }, '决策': { title: [{ plain_text: 'controlled' }] } } }] };
    };
    clock += 400_000;
    const result = await runNotionInletIngest(pool, { now: () => clock, notionReq });
    expect(result.ok).toBe(false);
    if (kind === 'page_write') expect(result.results.decisions.failed).toBe(1);
    else expect(result.results.decisions.error).toContain('controlled query failure');
  });
});

it('同表多库首库失败不会被次库成功覆盖，保留每库带身份的结果', async () => {
  inletRows.value = ['first', 'second'].map(notion_db_id => ({ status: 'active', direction: 'ingest', brain_table: 'decisions', notion_db_id }));
  clock += 400_000;
  const result = await runNotionInletIngest({ query: vi.fn() }, {
    now: () => clock,
    notionReq: async (_token, path) => {
      if (path.includes('/first/')) throw new Error('controlled first inlet unavailable');
      return { results: [] };
    },
  });
  expect(result.ok).toBe(false);
  expect(result.sources).toEqual([
    { brain_table: 'decisions', notion_db_id: 'first', result: { error: 'controlled first inlet unavailable' } },
    { brain_table: 'decisions', notion_db_id: 'second', result: { inserted: 0, updated: 0, skipped: 0, failed: 0, resolved: 0 } },
  ]);
});
