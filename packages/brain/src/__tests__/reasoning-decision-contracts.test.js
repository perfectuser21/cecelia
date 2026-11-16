import { beforeEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ query: vi.fn(), llm: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../llm-caller.js', () => ({ callLLM: boundary.llm, callLLMStream: boundary.llm }));
import { createCortexFallback, validateCortexDecision } from '../cortex.js';
import { calculateCost, recordTokenUsage, hasDangerousActions } from '../thalamus.js';

beforeEach(() => {
  vi.clearAllMocks();
  boundary.query.mockResolvedValue({ rows: [] });
  boundary.llm.mockImplementation(() => { throw new Error('此合同禁止调用真实模型'); });
});

it('皮层故障产出的降级决策合法且只能请求人工复核', () => {
  const fallback = createCortexFallback({ type: 'task_failed' }, 'fixture timeout');
  expect(validateCortexDecision(fallback)).toEqual({ valid: true, errors: [] });
  expect(fallback).toMatchObject({ level: 2, safety: true, _fallback: true });
  expect(fallback.actions).toEqual([{ type: 'request_human_review', params: {
    reason: 'fixture timeout', event_type: 'task_failed',
  } }]);
  expect(hasDangerousActions(fallback)).toBe(true);
  expect(boundary.query).not.toHaveBeenCalled();
  expect(boundary.llm).not.toHaveBeenCalled();
});

it('皮层非法动作与缺失必要字段不能通过校验', () => {
  const valid = createCortexFallback({ type: 'task_failed' }, 'fixture');
  expect(validateCortexDecision({ ...valid, actions: [{ type: 'execute_arbitrary_shell' }] }))
    .toMatchObject({ valid: false, errors: [expect.stringContaining('not in whitelist')] });
  expect(validateCortexDecision({ ...valid, level: 1, analysis: null }))
    .toMatchObject({ valid: false, errors: expect.arrayContaining([
      'Cortex decision must have level=2', 'Cortex decision must have analysis',
    ]) });
});

it('真实usage及独立model参数计算金额，并把同一金额写入token_usage事件', async () => {
  const usage = { input_tokens: 1000, output_tokens: 500 };
  const model = 'claude-sonnet-4-20250514';
  expect(calculateCost(usage, model)).toBeCloseTo(0.0105, 10);
  await recordTokenUsage('thalamus', model, usage, { event_type: 'fixture' });
  expect(boundary.query).toHaveBeenCalledTimes(1);
  const [sql, [source, raw]] = boundary.query.mock.calls[0];
  expect(sql).toContain("VALUES ('token_usage'");
  expect(source).toBe('thalamus');
  expect(JSON.parse(raw)).toMatchObject({
    model, input_tokens: 1000, output_tokens: 500, total_tokens: 1500,
    cost_usd: 0.0105, event_type: 'fixture',
  });
  expect(boundary.llm).not.toHaveBeenCalled();
});

it('缺usage不产生计费记录，未知模型不会伪造价格', async () => {
  await recordTokenUsage('thalamus', 'fixture', null);
  expect(boundary.query).not.toHaveBeenCalled();
  expect(calculateCost({ input_tokens: 1000 }, 'fixture-unknown-model')).toBe(0);
});
