import { beforeEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: db }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: vi.fn() }));
import { createRoutedTask } from '../../work-routing-store.js';
import router from '../task-tasks.js';

beforeEach(() => vi.clearAllMocks());

const codingIntent = {
  change_kind: 'bugfix', mutation_intent: 'write', repo_hint: 'perfectuser21/cecelia',
  map_scope_hint: ['F1'], branch: 'cp-retired-intake', base_sha: 'a'.repeat(40),
};

describe('退役 coding workflow API 入口语义', () => {
  it.each([
    { name: '旧CLI仅带类型与标记', body: { task_type: 'coding_workflow', payload: { coding_workflow: true, repo: 'zenithjoy-workspace', acceptance: ['x'] } } },
    { name: '完整编码意图不能恢复旧类型', body: { ...codingIntent, task_type: 'coding_workflow', payload: { executor: 'codex', mode: 'headless' } } },
    { name: '现役类型不能携带旧编排标记', body: { ...codingIntent, task_type: 'codex_dev', payload: { coding_workflow: true, executor: 'codex' } } },
  ])('$name：返回410且不调用路由存储或数据库', async ({ body }) => {
    const app = express();
    app.use(express.json());
    app.use('/tasks', router);
    const res = await request(app).post('/tasks').send({ title: '退役编排入口请求', ...body });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: 'task_type_retired', task_type: body.task_type });
    expect(createRoutedTask).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});
