import { describe, it, expect, vi, beforeEach } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query } }));
import { addQuestionToGoal, answerQuestionForGoal, getPendingQuestions } from '../okr-tick.js';
describe('KR人工问答台账', () => {
  beforeEach(() => vi.resetAllMocks());
  it('记录人工问题并能查询原有待答内容', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const saved = await addQuestionToGoal('kr-1', '确认目标值');
    expect(saved).toEqual({ question_id: expect.stringMatching(/^q-\d+$/), goal_id: 'kr-1' });
    const write = query.mock.calls.find(([sql]) => /UPDATE key_results/.test(sql));
    expect(write[1]).toEqual(['kr-1', saved.question_id, '确认目标值', 'needs_info']);
    query.mockResolvedValueOnce({ rows: [{ metadata: { pending_questions: [{ id: 'q-1', question: '确认目标值', answered: false }] } }] });
    expect(await getPendingQuestions('kr-1')).toEqual([{ id: 'q-1', question: '确认目标值', answered: false }]);
  });
  it('回答只修改指定KR的问题，不生成任务或变更目标结构', async () => {
    query.mockResolvedValueOnce({ rows: [{ metadata: { pending_questions: [{ id: 'q-1', question: '目标值？', answered: false }] } }] }).mockResolvedValueOnce({ rows: [] });
    expect(await answerQuestionForGoal('kr-1', 'q-1', '100')).toEqual({ success: true, question_id: 'q-1', goal_id: 'kr-1' });
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('UPDATE key_results');
    expect(params).toEqual(['kr-1', JSON.stringify([{ id: 'q-1', question: '目标值？', answered: true, answer: '100' }])]);
  });
});
