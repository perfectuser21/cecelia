/** 真 runManualRumination + 真 PG suggestions/events；模型与非目标副作用为显式边界。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDebt07Fixture } from './helpers/debt-07-pg.js';
vi.mock('../db.js', () => ({ default: { query() { throw new Error('禁止默认池'); } } }));
const insight = '第07路真实反刍去重合同：相同洞察在一天内只能进入一次建议队列，过期以后允许再次记录，避免重复任务循环。';
vi.mock('../notebook-adapter.js', () => ({ queryNotebook: vi.fn(async () => ({ ok: true, text: insight })), addTextSource: vi.fn(async () => {}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(async () => ({ text: '' })) }));
vi.mock('../memory-retriever.js', () => ({ buildMemoryContext: vi.fn(async () => ({ block: '' })) }));
vi.mock('../self-model.js', () => ({ updateSelfModel: vi.fn() }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(async () => {}), EVENT_TYPES: { RUMINATION_RESULT: 'rumination_result' } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn(() => { throw new Error('禁止建单'); }) }));
let fixture, db, runManualRumination, reset;
const hash = createHash('sha256').update(insight).digest('hex');
beforeAll(async () => {
  fixture = await createDebt07Fixture();
  db = fixture.pool;
  await db.query('CREATE TABLE schema_version (version varchar(10) PRIMARY KEY, description text)');
  for (const migration of ['087_suggestions_table.sql', '191_add_suggestions_content_hash.sql']) {
    await db.query(readFileSync(new URL('../../migrations/' + migration, import.meta.url), 'utf8'));
  }
  ({ runManualRumination, _resetState: reset } = await import('../rumination.js'));
});
afterAll(async () => { if (fixture) await fixture.close(); });
beforeEach(async () => { if (db) await db.query('TRUNCATE suggestions, cecelia_events'); });
// 非目标表使用显式端口夹具；目标去重查询、INSERT 和时间窗口均交给真实 PG。
const adapter = { async query(sql, params) {
  if (/\b(suggestions|cecelia_events|working_memory)\b/i.test(sql)) return db.query(sql, params);
  if (/SELECT id, title, content, category FROM learnings/.test(sql)) return { rows: [{ id: 'learning-fixture', title: '第07路', content: '确定性输入', category: 'test' }] };
  if (/INSERT INTO memory_stream|UPDATE learnings SET digested|(?:FROM|INTO) synthesis_archive/.test(sql)) return { rows: [] };
  throw new Error('未声明的反刍数据库端口：' + sql);
} };
async function run() { reset(); return runManualRumination(adapter, { force: true }); }
async function suggestions() { return (await db.query('SELECT * FROM suggestions ORDER BY created_at')).rows; }
describe('反刍真实入口建议去重', () => {
  it('首次写入生成真实建议及 64 位 hash', async () => {
    expect((await run()).insights).toEqual([insight]);
    const rows = await suggestions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ content: insight, content_hash: hash, source: 'rumination', status: 'pending', suggestion_type: 'desire_formation' });
  });
  it('24h 内重复入口调用不重复写入', async () => {
    await run();
    expect((await run()).insights).toEqual([]);
    expect(await suggestions()).toHaveLength(1);
  });
  it('建议表独立去重：没有 rumination_output 事件时仍阻止重复建议', async () => {
    await run();
    await db.query("DELETE FROM cecelia_events WHERE event_type='rumination_output'");
    expect((await run()).insights).toEqual([insight]);
    expect(await suggestions()).toHaveLength(1);
  });
  it('25h 前建议与输出事件过期后允许再次写入', async () => {
    await run();
    await db.query("UPDATE suggestions SET created_at=NOW()-INTERVAL '25 hours'");
    await db.query("UPDATE cecelia_events SET created_at=NOW()-INTERVAL '25 hours'");
    expect((await run()).insights).toEqual([insight]);
    const rows = await suggestions();
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.content_hash)).toEqual([hash, hash]);
  });
});
