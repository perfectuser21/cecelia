/**
 * Knowledge Modules API Route Tests
 *
 * GET /api/brain/knowledge/modules
 * 从 BACKLOG.yaml 读取知识模块清单
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock fs and js-yaml before importing routes
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('js-yaml', () => ({
  default: {
    load: vi.fn(),
  },
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

const MOCK_BACKLOG = {
  meta: { total: 4, done: 3, last_updated: '2026-03-17' },
  brain: [
    {
      id: 'brain-tick-loop',
      title: '心跳系统（Tick Loop）',
      desc: '5秒循环检查',
      priority: 'P0',
      status: 'done',
      output: 'knowledge/brain/tick-loop.html',
      source_files: ['packages/brain/src/tick.js'],
      completed: '2026-03-15',
    },
  ],
  engine: [
    {
      id: 'engine-dev-workflow',
      title: '/dev 开发工作流',
      desc: '完整6步开发流程',
      priority: 'P0',
      status: 'done',
      output: 'knowledge/engine/dev-workflow.html',
      source_files: [],
      completed: '2026-03-16',
    },
  ],
  workflows: [],
  system: [
    {
      id: 'system-task-lifecycle',
      title: '任务生命周期',
      desc: '从说话到代码上线',
      priority: 'P1',
      status: 'todo',
      output: null,
      source_files: [],
      completed: null,
    },
  ],
};

describe('GET /api/brain/knowledge/modules', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { readFileSync } = await import('fs');
    const yaml = await import('js-yaml');

    readFileSync.mockReturnValue('mocked yaml content');
    yaml.default.load.mockReturnValue(MOCK_BACKLOG);

    const knowledgeRoutes = (await import('../routes/knowledge.js')).default;
    app = express();
    app.use('/api/brain/knowledge', knowledgeRoutes);
  });

  it('返回 groups 和 meta', async () => {
    const res = await request(app).get('/api/brain/knowledge/modules');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('groups');
    expect(res.body.meta.total).toBe(4);
  });

  it('groups 包含四个分组（过滤空数组）', async () => {
    const res = await request(app).get('/api/brain/knowledge/modules');
    // workflows 为空数组，但仍保留（filter 只过滤非数组）
    expect(Array.isArray(res.body.groups)).toBe(true);
    const groupIds = res.body.groups.map((g) => g.id);
    expect(groupIds).toContain('brain');
    expect(groupIds).toContain('engine');
    expect(groupIds).toContain('system');
  });

  it('每个 group 包含正确字段', async () => {
    const res = await request(app).get('/api/brain/knowledge/modules');
    const brainGroup = res.body.groups.find((g) => g.id === 'brain');
    expect(brainGroup).toBeDefined();
    expect(brainGroup.label).toBe('Brain 后端');
    expect(Array.isArray(brainGroup.items)).toBe(true);
    expect(brainGroup.items[0].id).toBe('brain-tick-loop');
    expect(brainGroup.items[0].title).toBe('心跳系统（Tick Loop）');
  });

  it('模块条目包含所有必要字段', async () => {
    const res = await request(app).get('/api/brain/knowledge/modules');
    const item = res.body.groups.find((g) => g.id === 'brain').items[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('title');
    expect(item).toHaveProperty('desc');
    expect(item).toHaveProperty('priority');
    expect(item).toHaveProperty('status');
    expect(item).toHaveProperty('output_url');
    expect(item).toHaveProperty('source_files');
    expect(item).toHaveProperty('completed');
  });

  it('output_url 优先取 output_url 字段，其次 output', async () => {
    const res = await request(app).get('/api/brain/knowledge/modules');
    const item = res.body.groups.find((g) => g.id === 'brain').items[0];
    // MOCK 中只有 output 字段
    expect(item.output_url).toBe('knowledge/brain/tick-loop.html');
  });

  it('status:todo 的模块 output_url 为 null', async () => {
    const res = await request(app).get('/api/brain/knowledge/modules');
    const sysGroup = res.body.groups.find((g) => g.id === 'system');
    expect(sysGroup.items[0].output_url).toBeNull();
  });
});
