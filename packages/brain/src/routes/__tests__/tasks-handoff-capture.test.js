import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn() }));
import { registerTaskStatusRoutes } from '../tasks-status.js';
let server;
afterEach(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

it('现役PATCH交接真实写入capture/atom并保留原任务路由身份', async () => {
  const taskId = '831d6cba-5ee6-40d9-99a3-ebf2eb4be115';
  boundary.query.mockImplementation(async sql => {
    if (/SELECT[\s\S]*FROM tasks/.test(sql)) return { rows: [{ id: taskId, status: 'queued', task_type: 'research' }] };
    if (/UPDATE tasks SET/.test(sql)) return { rows: [{ status: 'queued', updated_at: '2026-11-16' }] };
    if (/INSERT INTO captures/.test(sql)) return { rows: [{ id: 'fixture-capture', inserted: true }] };
    if (/INSERT INTO capture_atoms/.test(sql)) return { rows: [{ id: 'fixture-atom' }] };
    throw new Error('未声明的数据库操作');
  });
  const app = express(); app.use(express.json());
  const router = express.Router(); registerTaskStatusRoutes(router); app.use('/api/brain', router);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const response = await request(server).patch(`/api/brain/tasks/${taskId}`).send({ result: {
    handoff: { title: 'fixture交接', verdict: 'PASS', done: ['已验证'], next_steps: [] },
  } });
  expect(response.status).toBe(200);
  const envelope = boundary.query.mock.calls.find(([sql]) => /INSERT INTO captures/.test(sql));
  const atom = boundary.query.mock.calls.find(([sql]) => /INSERT INTO capture_atoms/.test(sql));
  expect(envelope).toBeDefined(); expect(atom).toBeDefined();
  expect(envelope[1][0]).toContain('fixture交接');
  expect(envelope[1][2]).toBe('handoff');
  expect(atom[1]).toEqual(['fixture-capture', expect.stringContaining('已验证'), 'handoff', 'PASS', 'tasks', taskId, null, '{}']);
});
