/**
 * TDD Red: POST /api/brain/notes Initiative ID 降级测试
 *
 * 当前 notes.js 硬编码 'Initiative ID' 属性，不查 Notion DB schema。
 * 修复后应：查 schema → 属性缺失 → 跳过 + response.warnings 数组留痕。
 *
 * 这些测试在修复前 FAIL（RED），修复后 PASS（GREEN）。
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockNotionReq = vi.fn();
const mockGetToken = vi.fn(() => 'test-token');
const mockPoolQuery = vi.fn();

vi.mock('../../../packages/brain/src/recurring-notion-sync.js', () => ({
  notionReq: (...args: unknown[]) => mockNotionReq(...args),
  getToken: () => mockGetToken(),
}));

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

let router: express.Router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../../packages/brain/src/routes/notes.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('POST /notes — Initiative ID 降级 [BEHAVIOR]', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it('Initiative ID 不在 schema 时 — notionReq 创建页面时 properties 不含 Initiative ID', async () => {
    // 第一次调用: getDbProperties 返回无 'Initiative ID' 的 schema
    mockNotionReq
      .mockResolvedValueOnce({ properties: { Title: { type: 'title' }, Type: { type: 'select' } } })
      // 第二次调用: 创建页面成功
      .mockResolvedValueOnce({ id: 'page-init-1', url: 'https://notion.so/page-init-1' });

    const res = await request(app).post('/notes').send({
      title: 'Test Note',
      content: 'Test content',
      initiative_id: 'r4-test-init-123',
    });

    expect(res.status).toBe(201);

    // 找到创建页面的 notionReq 调用（POST /pages）
    const createCall = mockNotionReq.mock.calls.find(
      (c) => c[2] === 'POST' && c[1] === '/pages'
    );
    expect(createCall).toBeDefined();

    // 关键断言：properties 中不应含 'Initiative ID'（schema 无此属性）
    const properties = createCall![3].properties;
    expect(properties).not.toHaveProperty('Initiative ID');
  });

  it('Initiative ID 不在 schema 时 — response.warnings 数组包含跳过说明', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ properties: { Title: { type: 'title' }, Type: { type: 'select' } } })
      .mockResolvedValueOnce({ id: 'page-warn-1', url: 'https://notion.so/page-warn-1' });

    const res = await request(app).post('/notes').send({
      title: 'Test Note Warn',
      content: 'content',
      initiative_id: 'r4-warn-init',
    });

    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeDefined();
    expect(Array.isArray(res.body.warnings)).toBe(true);
    // warnings 中应描述 Initiative ID 被跳过
    expect(res.body.warnings.some((w: string) => w.includes('Initiative ID'))).toBe(true);
  });

  it('Initiative ID 在 schema 中时 — properties 包含该字段（正常路径）', async () => {
    mockNotionReq
      .mockResolvedValueOnce({
        properties: {
          Title: { type: 'title' },
          Type: { type: 'select' },
          'Initiative ID': { type: 'rich_text' }, // schema 中存在
        },
      })
      .mockResolvedValueOnce({ id: 'page-has-init', url: 'https://notion.so/page-has-init' });

    const res = await request(app).post('/notes').send({
      title: 'Test Note Has Init',
      content: 'content',
      initiative_id: 'r4-has-init',
    });

    expect(res.status).toBe(201);
    // Initiative ID 在 schema 中 → 应写入
    const createCall = mockNotionReq.mock.calls.find(
      (c) => c[2] === 'POST' && c[1] === '/pages'
    );
    expect(createCall![3].properties).toHaveProperty('Initiative ID');
    // 无需 warnings（或 warnings 为空数组）
    if (res.body.warnings) {
      expect(
        res.body.warnings.some((w: string) => w.includes('Initiative ID'))
      ).toBe(false);
    }
  });

  it('warnings 字段类型必须为 array（禁用 warning 单数字段）', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ properties: { Title: { type: 'title' } } })
      .mockResolvedValueOnce({ id: 'page-arr', url: 'https://notion.so/page-arr' });

    const res = await request(app).post('/notes').send({
      title: 'Array type check',
      content: 'content',
      initiative_id: 'arr-check',
    });

    expect(res.status).toBe(201);
    // 禁用字段：单数 warning
    expect(res.body).not.toHaveProperty('warning');
    // warnings 必须是数组（如果存在）
    if (res.body.warnings !== undefined) {
      expect(Array.isArray(res.body.warnings)).toBe(true);
    }
  });
});
