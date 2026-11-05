import { beforeEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ llm: vi.fn(), selfModel: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: effects.llm }));
vi.mock('../self-model.js', () => ({ updateSelfModel: effects.selfModel }));
import { runDailyConsolidationIfNeeded } from '../consolidation.js';

const now = new Date('2026-11-05T12:00:00Z');
const summary = { date: '2026-11-05', key_events: ['owned real summary'], self_model_delta: { insight: 'owned insight' } };
beforeEach(() => { effects.llm.mockReset(); effects.selfModel.mockReset().mockResolvedValue('ok'); });

function ownedPool() {
  const writes = [];
  const pool = { query: vi.fn(async (sql, values) => {
    if (sql.includes('SELECT max(created_at)')) return { rows: [{ last_run: null }] };
    if (sql.includes('SELECT content, source_type')) return { rows: [{ content: 'owned memory', source_type: 'chat', importance: 5 }] };
    if (sql.includes('SELECT title, content, category')) return { rows: [] };
    if (sql.includes('SELECT title, task_type, status')) return { rows: [] };
    if (sql.includes('SELECT id FROM daily_logs')) return { rows: [] };
    if (sql.includes('INSERT INTO memory_stream')) { writes.push({ table: 'memory_stream', summary: JSON.parse(values[0]) }); return { rows: [] }; }
    if (sql.includes('INSERT INTO daily_logs')) { writes.push({ table: 'daily_logs', summary: JSON.parse(values[1]) }); return { rows: [] }; }
    throw Error('unexpected owned SQL');
  }) };
  return { pool, writes };
}
async function runWith(response) {
  effects.llm.mockResolvedValue(response);
  const fixture = ownedPool();
  const result = await runDailyConsolidationIfNeeded(fixture.pool, now);
  expect(effects.llm).toHaveBeenCalledOnce();
  expect(effects.llm).toHaveBeenCalledWith('cortex', expect.stringContaining('owned memory'), { maxTokens: 800 });
  return { ...fixture, result };
}
function assertWrites(writes, expected) {
  expect(writes).toEqual([{ table: 'memory_stream', summary: expected }, { table: 'daily_logs', summary: expected }]);
}

it.each([
  ['生产callLLM JSON封套', { text: JSON.stringify(summary), model: 'owned-model', provider: 'openai', elapsed_ms: 3, attempted_fallback: false }],
  ['兼容旧字符串', JSON.stringify(summary)],
])('%s经真实闸门→合并→两类写入→self-model', async (_name, response) => {
  const { pool, writes, result } = await runWith(response);
  expect(result).toEqual({ done: true, summary });
  assertWrites(writes, summary);
  expect(effects.selfModel).toHaveBeenCalledOnce();
  expect(effects.selfModel).toHaveBeenCalledWith('owned insight', pool);
});

it.each([
  ['封套纯文本', { text: 'owned plain note', model: 'owned', provider: 'openai', elapsed_ms: 1 }],
  ['旧纯文本', 'owned plain note'],
])('%s保留非JSON摘要兼容', async (_name, response) => {
  const { result, writes } = await runWith(response);
  const expected = { date: '2026-11-05', note: 'owned plain note' };
  expect(result).toEqual({ done: true, summary: expected });
  assertWrites(writes, expected);
  expect(effects.selfModel).not.toHaveBeenCalled();
});

it.each([null, undefined, {}, { text: 42 }, { text: '{bad json}' }])('非法封套%j保持原失败摘要合同', async response => {
  const { result, writes } = await runWith(response);
  const expected = { date: '2026-11-05', note: 'LLM 调用失败' };
  expect(result).toEqual({ done: true, summary: expected });
  assertWrites(writes, expected);
  expect(effects.selfModel).not.toHaveBeenCalled();
});

it('真实LLM边界reject保留fallback，不触发self-model', async () => {
  effects.llm.mockRejectedValue(Error('owned model unavailable'));
  const { pool, writes } = ownedPool();
  const expected = { date: '2026-11-05', note: 'LLM 调用失败' };
  expect(await runDailyConsolidationIfNeeded(pool, now)).toEqual({ done: true, summary: expected });
  assertWrites(writes, expected);
  expect(effects.selfModel).not.toHaveBeenCalled();
});
