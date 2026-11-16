import { expect, it, vi } from 'vitest';
vi.mock('../actions.js', () => ({ createTask: vi.fn(() => { throw new Error('必须注入建单边界'); }) }));
vi.mock('../db.js', () => ({ default: { query: vi.fn(() => { throw new Error('禁止canonical DB'); }) } }));
import { generateLineLedger } from '../line-dreaming.js';
import { triggerArchReview } from '../daily-review-scheduler.js';

it('夜间账本实际产物进入现役架构巡检任务，不依赖旧规划消费者', async () => {
  let ledger;
  const pool = { query: vi.fn(async (sql, params) => {
    if (/FROM decisions/.test(sql)) return { rows: [{ topic: 'fixture唯一决策', decision: '保留真实回执' }] };
    if (/INSERT INTO design_docs/.test(sql)) {
      ledger = { title: params[0], content: params[1] };
      return { rows: [] };
    }
    if (/SELECT title, content FROM design_docs/.test(sql)) return { rows: ledger ? [ledger] : [] };
    return { rows: [] };
  }) };
  const createTask = vi.fn().mockResolvedValue({ task: { id: 'fixture-arch-task' } });
  await generateLineLedger(pool, 'fixture-line', 'fixture业务线');
  expect(ledger.content).toContain('fixture唯一决策');
  expect(ledger.content).toContain('保留真实回执');
  const result = await triggerArchReview(pool, new Date('2026-11-16T00:01:00Z'), createTask);
  expect(result).toMatchObject({ triggered: true, task_id: 'fixture-arch-task' });
  expect(createTask).toHaveBeenCalledTimes(1);
  const task = createTask.mock.calls[0][0];
  expect(task.db).toBe(pool);
  expect(task.task_type).toBe('arch_review');
  expect(task.payload.prd_summary).toContain(ledger.content);
  expect(task.payload.prd_summary).toContain(ledger.title);
});
