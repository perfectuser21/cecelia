import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({
  query: vi.fn(),
  read: vi.fn(() => 'meta: { total: 86, done: 76 }\nbrain: []\n'),
  yaml: vi.fn(() => ({ meta: { total: 86, done: 76 }, brain: [] })),
}));
vi.mock('../../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('fs', async original => ({ ...await original(), readFileSync: boundary.read }));
vi.mock('node:fs', async original => ({ ...await original(), readFileSync: boundary.read }));
vi.mock('js-yaml', () => ({ default: { load: boundary.yaml } }));
import router from '../knowledge.js';

const notionUrl = 'https://app.notion.com/p/770c40c2ba6383ea86d001eba832c218';
const app = express();
app.use('/api/brain/knowledge', router);

beforeEach(() => {
  vi.clearAllMocks();
  boundary.query.mockResolvedValue({ rows: [{ id: 'real-knowledge-query', type: 'learning_rule' }] });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止模型或外部调用'); }));
});
afterEach(() => vi.unstubAllGlobals());

describe('旧知识生成进度API退役，保留真实知识查询', () => {
  it.each(['/modules', '/modules?group=brain&refresh=true'])('%s返回明确410且零旧目录/DB/外部调用', async suffix => {
    const res = await request(app).get('/api/brain/knowledge' + suffix);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: 'knowledge_modules_retired', knowledge_url: notionUrl });
    expect(res.body).not.toHaveProperty('meta');
    expect(res.body).not.toHaveProperty('groups');
    expect(boundary.read).not.toHaveBeenCalled();
    expect(boundary.yaml).not.toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('旧目录不可读也不改变410或触发恢复', async () => {
    boundary.read.mockImplementationOnce(() => { throw new Error('旧YAML目录禁止读取'); });
    const res = await request(app).get('/api/brain/knowledge/modules');
    expect(res.status).toBe(410);
    expect(boundary.read).not.toHaveBeenCalled();
    expect(boundary.yaml).not.toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
  });

  it('原GET /knowledge仍到真实SQL查询边界，过滤与结果保持', async () => {
    const res = await request(app).get('/api/brain/knowledge?type=learning_rule&limit=3');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'real-knowledge-query', type: 'learning_rule' }]);
    expect(boundary.query).toHaveBeenCalledTimes(1);
    expect(boundary.query.mock.calls[0][1]).toEqual(['learning_rule', 3]);
    expect(boundary.read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
