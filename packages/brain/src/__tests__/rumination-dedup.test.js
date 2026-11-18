/** 真 runManualRumination + 真 PG suggestions/events；模型与非目标副作用为显式边界。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDebt07Fixture } from './helpers/debt-07-pg.js';
vi.mock('../db.js', () => ({ default: { query() { throw new Error('禁止默认池'); } } }));
const insight = '第07路真实反刍去重合同：相同洞察在一天内只记录一次输出事件，过期以后允许再次记录，避免重复消化相同知识。';
vi.mock('../notebook-adapter.js', () => ({ queryNotebook: vi.fn(async () => ({ ok: true, text: insight })), addTextSource: vi.fn(async () => {}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(async () => ({ text: '' })) }));
vi.mock('../memory-retriever.js', () => ({ buildMemoryContext: vi.fn(async () => ({ block: '' })) }));
vi.mock('../self-model.js', () => ({ updateSelfModel: vi.fn() }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(async () => {}), EVENT_TYPES: { RUMINATION_RESULT: 'rumination_result' } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn(() => { throw new Error('禁止建单'); }) }));
let fixture, db, runManualRumination, reset;
const hash = createHash('sha256').update(insight).digest('hex').slice(0, 32);
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
async function outputHashes() {
  const { rows } = await db.query(`
    SELECT payload->>'content_hash' AS hash FROM cecelia_events
    WHERE event_type='rumination_output' AND source='rumination' ORDER BY created_at
  `);
  return rows.map(row => row.hash);
}

describe('反刍真实入口输出去重', () => {
  it('首次写入记录对应洞察的摘要', async () => {
    expect((await run()).insights).toEqual([insight]);
    expect(await outputHashes()).toEqual([hash]);
  });
  it('23 小时后的相同洞察复用已有输出', async () => {
    await run();
    await db.query("UPDATE cecelia_events SET created_at=NOW()-INTERVAL '23 hours' WHERE event_type='rumination_output'");
    expect((await run()).insights).toEqual([]);
    expect(await outputHashes()).toEqual([hash]);
  });
  it('记录洞察后建议队列仍为空', async () => {
    expect((await run()).insights).toEqual([insight]);
    expect(await outputHashes()).toEqual([hash]);
    expect((await db.query('SELECT id FROM suggestions')).rows).toEqual([]);
  });
  it('25 小时后的相同洞察再次写入输出事件', async () => {
    await run();
    await db.query("UPDATE cecelia_events SET created_at=NOW()-INTERVAL '25 hours' WHERE event_type='rumination_output'");
    expect((await run()).insights).toEqual([insight]);
    expect(await outputHashes()).toEqual([hash, hash]);
  });
});
