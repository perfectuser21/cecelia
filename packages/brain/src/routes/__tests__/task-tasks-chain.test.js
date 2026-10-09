/**
 * GET /tasks/:id/chain — project_id 路径（棒1，任务 9e785997，决策 ee4842a6/3feeae3e）
 * 任务挂了 project_id → children/log 按 project_id 取（而不是旧的 parent_task_id）。
 * 无 project_id 的任务走原有祖先链逻辑不受影响（相关既有覆盖见 relay-chain.test.js / handoff.test.js）。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../task-tasks.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/tasks', router);
  return app;
}

const PROJECT_ID = '66666666-6666-4666-8666-666666666666';
const LEAF = '33333333-3333-4333-8333-333333333333';

describe('GET /tasks/:id/chain — project_id 路径', () => {
  it('root.kind=project 时按 project_id 取 children 与 log（不查 parent_task_id）', async () => {
    mockPool.query.mockReset();
    let call = 0;
    mockPool.query.mockImplementation(async (sql) => {
      call += 1;
      if (/WITH RECURSIVE up/.test(sql)) {
        return { rows: [{ id: LEAF, parent_task_id: null, title: 'leaf', description: null, task_type: 'dev', status: 'queued', sequence_no: 1, project_id: PROJECT_ID, depth: 0 }] };
      }
      if (/FROM projects WHERE id/.test(sql)) {
        return { rows: [{ id: PROJECT_ID, name: '项目名', description: '目标', status: 'active', kr_id: null, brief: {} }] };
      }
      if (/count\(\*\)::int AS total FROM tasks WHERE project_id/.test(sql)) return { rows: [{ total: 1 }] };
      if (/FROM tasks t\s+WHERE t\.project_id.*handoff/s.test(sql)) return { rows: [] };
      if (/FROM tasks WHERE project_id = \$1::uuid AND task_type <> 'project'\s+ORDER BY sequence_no/.test(sql)) {
        return { rows: [{ id: 'c1', title: 'child', status: 'completed', task_type: 'dev', sequence_no: 1, completed_at: null, verdict: 'PASS', last_done: 'done', next_steps: [] }] };
      }
      if (/jsonb_array_elements.*project_id = \$1::uuid/s.test(sql)) return { rows: [] };
      if (/WHERE parent_task_id = \$1::uuid/.test(sql)) throw new Error('不应该走旧的 parent_task_id 查询');
      return { rows: [] };
    });
    const res = await request(createApp()).get(`/tasks/${LEAF}/chain`);
    expect(res.status).toBe(200);
    expect(res.body.root.kind).toBe('project');
    expect(res.body.root.id).toBe(PROJECT_ID);
    expect(res.body.children).toHaveLength(1);
    expect(res.body.children[0].title).toBe('child');
  });
});
