/** HTTP 与队列路径都执行真实共享结果处理；隔离数据库及外部副作用。 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callbackPoolResponse, mockClient, mockPool, mockReqRes } from './helpers/callback-atomic-fixture.js';
import { writeReviewResult } from '../lib/callback-postprocess.js';
import { processExecutionCallback } from '../callback-processor.js';

const realPostprocess = await vi.importActual('../lib/callback-postprocess.js');

describe('审核结论的两个真实回调入口', () => {
  const task = { task_type: 'spec_review', status: 'in_progress', payload: { parent_task_id: 'parent' } };
  let writes;
  beforeEach(() => {
    vi.clearAllMocks();
    writes = [];
    vi.mocked(writeReviewResult).mockImplementation(realPostprocess.writeReviewResult);
    mockClient.query.mockImplementation(async sql => {
      if (String(sql).includes('UPDATE tasks')) return { rows: [task], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mockPool.query.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.startsWith('UPDATE tasks SET review_result')) {
        writes.push({ target: params[1], text: params[0] });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT task_type, payload FROM tasks') || text.includes("payload->>'failure_class' AS failure_class")) return { rows: [task] };
      if (text.includes('SELECT status FROM tasks')) return { rows: [{ status: 'in_progress' }] };
      return callbackPoolResponse(sql);
    });
  });
  afterEach(() => { vi.mocked(writeReviewResult).mockReset(); });

  it.each([
    ['http', {}, null],
    ['queue', {}, null],
    ['http', { verdict: 'rejected' }, 'rejected'],
    ['queue', { verdict: 'rejected' }, 'rejected'],
  ])('%s 回执 %j 按实际结论处理展示字段', async (kind, result, expected) => {
    const body = { task_id: 'child', run_id: 'owned-run', status: 'AI Done', result };
    if (kind === 'http') {
      const response = await mockReqRes('POST', '/execution-callback', body);
      expect(response.statusCode).toBe(200);
    } else {
      const response = await processExecutionCallback(body, mockPool);
      expect(response.success).toBe(true);
    }
    expect(writeReviewResult).toHaveBeenCalled();
    if (!expected) return expect(writes).toEqual([]);
    expect(writes.map(w => w.target)).toEqual(['child', 'parent']);
    for (const write of writes) {
      expect(write.text).toContain(`决定: ${expected}`);
      expect(write.text).not.toContain('决定: PASS');
    }
  });

});
