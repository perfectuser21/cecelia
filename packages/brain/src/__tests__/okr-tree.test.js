/**
 * OKR /tree 端点单元测试
 * 验证 7 层嵌套查询逻辑（Vision→Objective→KR→Project→Scope→Initiative→Task）
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db pool
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

describe('GET /api/brain/okr/tree', () => {
  let app;

  beforeAll(async () => {
    vi.resetModules();
    const { default: router } = await import('../routes/okr-hierarchy.js');
    app = express();
    app.use('/api/brain/okr', router);
  });

  it('应返回完整 7 层嵌套结构', async () => {
    // Mock 每层查询返回
    mockQuery
      // visions
      .mockResolvedValueOnce({ rows: [{ id: 'v1', title: 'Vision', status: 'active' }] })
      // objectives
      .mockResolvedValueOnce({ rows: [{ id: 'o1', title: 'Obj', status: 'active', vision_id: 'v1' }] })
      // key_results
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR', status: 'active', objective_id: 'o1' }] })
      // okr_projects
      .mockResolvedValueOnce({ rows: [{ id: 'p1', title: 'Project', status: 'active', kr_id: 'kr1' }] })
      // okr_scopes
      .mockResolvedValueOnce({ rows: [{ id: 's1', title: 'Scope', status: 'active', project_id: 'p1' }] })
      // okr_initiatives
      .mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Initiative', status: 'active', scope_id: 's1' }] })
      // tasks
      .mockResolvedValueOnce({ rows: [{ id: 't1', title: 'Task', status: 'in_progress', priority: 'high', created_at: '2026-01-01', completed_at: null }] });

    const res = await request(app).get('/api/brain/okr/tree');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tree).toHaveLength(1);

    const vision = res.body.tree[0];
    expect(vision.objectives).toHaveLength(1);

    const obj = vision.objectives[0];
    expect(obj.key_results).toHaveLength(1);

    const kr = obj.key_results[0];
    expect(kr.okr_projects).toHaveLength(1);

    const proj = kr.okr_projects[0];
    expect(proj.okr_scopes).toHaveLength(1);

    const scope = proj.okr_scopes[0];
    expect(scope.okr_initiatives).toHaveLength(1);

    const init = scope.okr_initiatives[0];
    expect(init.tasks).toHaveLength(1);
    expect(init.tasks[0].id).toBe('t1');
  });

  it('空数据时应返回空数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/okr/tree');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tree).toHaveLength(0);
  });
});
