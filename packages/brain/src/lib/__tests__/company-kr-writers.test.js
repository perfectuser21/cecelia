import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { recalculateKrProgress } from '../kr-recalculate-progress.js';
import { updateKrProgress } from '../../kr-progress.js';
const sharedPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: sharedPool }));
import { writeProgressToKR } from '../../kr3-progress-calculator.js';
import { updateGoal } from '../../actions.js';
import { answerQuestionForGoal } from '../../okr-tick.js';

describe('company-kr-writers 公司经营KR不接受项目任务比例覆盖', () => {
  it('重算与callback helper直接返回经营指标，不查询或写项目比例', async () => {
    const row = { id: 'company', progress: 0, current_value: '2.00', target_value: '8.00', metadata: { metric_mode: 'company_formula_v1', company_metric: { current: '2', target: '8', ratio: 0.25 } }, custom_props: { company_notion: { page_id: 'source' } } };
    for (const handler of [recalculateKrProgress, updateKrProgress]) {
      const pool = { query: vi.fn(async () => ({ rows: [row] })) };
      const result = await handler(pool, row.id);
      expect(result).toMatchObject({ skipped: true, reason: 'company_metric' });
      expect(pool.query).toHaveBeenCalledOnce();
    }
  });
  it('三条legacy Current writer必须在实际UPDATE处守住双身份字段', () => {
    for (const file of ['callback-processor.js', 'routes/execution.js', 'routes/tasks.js']) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      const writes = source.match(/(?:'|`)(UPDATE key_results SET current_value[^'`]*)(?:'|`)/g) || [];
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every(sql => sql.includes('COMPANY_KR_SQL_GUARD'))).toBe(true);
    }
  });
  it('旧KR3标题批写必须拒绝公司同号KR，通用action不得改公司progress', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 0 })) };
    await writeProgressToKR(pool, 99);
    expect(pool.query.mock.calls[0][0]).toContain('company_notion');
    sharedPool.query.mockImplementation(async sql => sql.includes('SELECT') && sql.includes('key_results') ? { rows: [{ metadata: { metric_mode: 'company_formula_v1' }, custom_props: { company_notion: {} } }] } : { rows: [], rowCount: 0 });
    expect(await updateGoal({ goal_id: 'company', progress: 99 })).toMatchObject({ success: false, error: expect.stringContaining('公司') });
    expect(sharedPool.query.mock.calls.every(([sql]) => !sql.includes('UPDATE key_results'))).toBe(true);
  });
  it('回答问题只改pending_questions，禁止旧metadata全量快照覆盖新观察', async () => {
    sharedPool.query.mockReset();
    sharedPool.query.mockResolvedValue({ rows: [{ metadata: { pending_questions: [{ id: 'q' }], metric_mode: 'company_formula_v1', company_metric: { current: '2.345' } } }] });
    await answerQuestionForGoal('company', 'q', '回答');
    const update = sharedPool.query.mock.calls.find(([sql]) => sql.includes('UPDATE key_results'));
    expect(update[0]).toContain('jsonb_set');
    expect(update[0]).toContain('pending_questions');
    expect(Array.isArray(typeof update[1][1] === 'string' ? JSON.parse(update[1][1]) : update[1][1])).toBe(true);
  });
});
