import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: db }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: vi.fn() }));
import router from '../task-tasks.js';

describe('coding workflow API 入口语义', () => {
  it('旧 CLI 只带 task_type 和 payload 标记时 400，不写成 coding_review', async () => {
    const app = express();
    app.use(express.json());
    app.use('/tasks', router);
    const res = await request(app).post('/tasks').send({
      title: '缺失编码意图的真实入口形状', task_type: 'coding_workflow',
      payload: { coding_workflow: true, repo: 'zenithjoy-workspace', acceptance: ['x'] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('change_kind_required');
    expect(db.query).not.toHaveBeenCalled();
  });
});
