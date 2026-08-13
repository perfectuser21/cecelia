import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
const mockCreateRoutedTask = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));

let app;

beforeAll(async () => {
  const router = (await import('../capture-atoms.js')).default;
  app = express();
  app.use(express.json());
  app.use('/capture-atoms', router);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('capture atoms routing', () => {
  it('uses the real decisions schema and unified routing boundary', async () => {
    const source = await readFile(new URL('../capture-atoms.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/INSERT INTO decisions\s*\([^)]*title/i);
    expect(source).toContain('createRoutedTask');
  });

  it('loads registered repository facts and propagates the capture routing baseline', async () => {
    const atom = {
      id: 'atom-route-1',
      capture_id: 'capture-route-1',
      content: '修复 Work Router 的 repo 绑定',
      target_type: 'task',
      target_subtype: 'bugfix',
      suggested_area_id: null,
      status: 'pending_review',
      metadata: {
        repo: 'perfectuser21/cecelia',
        map_scope: ['capability:router'],
        branch: 'cp-router-fix',
        base_sha: 'b'.repeat(40),
        change_kind: 'bugfix',
      },
    };
    const client = { query: vi.fn(), release: vi.fn() };
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [atom] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockPool.connect.mockResolvedValueOnce(client);
    mockCreateRoutedTask.mockResolvedValueOnce({ task_id: 'task-route-1' });

    const response = await request(app)
      .patch('/capture-atoms/atom-route-1')
      .send({ action: 'confirm' });

    expect(response.status).toBe(200);
    expect(mockCreateRoutedTask).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        declared_change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia',
        map_scope_hint: ['capability:router'],
        branch: 'cp-router-fix',
        base_sha: 'b'.repeat(40),
      }),
      null,
      { transaction: 'existing' },
    );
  });
});
