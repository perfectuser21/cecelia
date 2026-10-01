import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const { pool } = vi.hoisted(() => ({ pool: { query: vi.fn() } }));
vi.mock('../../db.js', () => ({ default: pool }));
import router from '../intent-match.js';
const app = express();
app.use(express.json());
app.use('/api/brain/intent', router);

beforeEach(() => { pool.query.mockReset(); });
describe('意图匹配读取 projects 真身', () => {
  it('仅 name 匹配的新项目通过真实 HTTP 返回并推断 project 层', async () => {
    pool.query.mockImplementation(async sql => {
      if (/okr_(projects|scopes|initiatives)/.test(sql)) throw new Error('冻结层不可读');
      if (sql.includes('FROM projects')) {
        expect(sql).toContain('name ILIKE');
        expect(sql).toContain('ORDER BY name_rank');
        return { rows: [{ id: 'project-new', name: '接力项目', status: 'active', name_rank: 0 }] };
      }
      return { rows: [] };
    });
    const response = await request(app).post('/api/brain/intent/match').send({ query: '接力' });
    expect(response.status).toBe(200);
    expect(response.body.layer_guess).toBe('project');
    expect(response.body.matched_projects).toEqual([expect.objectContaining({ id: 'project-new', name: '接力项目', score: 0.9 })]);
  });
});
