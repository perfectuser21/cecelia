/**
 * TDD Red Phase — Notion 属性映射修复
 *
 * 覆盖：
 * 1. notion-property-map.js 导出 NOTION_PROPERTY_MAP + stripUnknownProperties
 * 2. stripUnknownProperties 剔除未知属性并返回 warnings
 * 3. POST /api/brain/notes response 含 warnings 字段（当前不含 → RED）
 * 4. POST /api/brain/notion/task response 含 warnings 字段（当前不含 → RED）
 * 5. POST /api/brain/notes 不再在 Notion payload 中携带 'Initiative ID' 旧属性
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock Notion 依赖 ─────────────────────────────────────────────────────────

const mockNotionReq = vi.fn();
const mockGetToken = vi.fn(() => 'test-notion-token');

vi.mock('../../../packages/brain/src/recurring-notion-sync.js', () => ({
  notionReq: (...args: unknown[]) => mockNotionReq(...args),
  getToken: () => mockGetToken(),
}));

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// ── 1. notion-property-map.js 模块契约 ──────────────────────────────────────

describe('notion-property-map.js 模块契约 [BEHAVIOR]', () => {
  it('导出 NOTION_PROPERTY_MAP 对象', async () => {
    // RED: notion-property-map.js 不存在 → import 失败
    const mod = await import('../../../packages/brain/src/notion-property-map.js');
    expect(typeof mod.NOTION_PROPERTY_MAP).toBe('object');
    expect(mod.NOTION_PROPERTY_MAP).not.toBeNull();
  });

  it('导出 stripUnknownProperties 函数', async () => {
    // RED: notion-property-map.js 不存在 → import 失败
    const mod = await import('../../../packages/brain/src/notion-property-map.js');
    expect(typeof mod.stripUnknownProperties).toBe('function');
  });

  it('stripUnknownProperties: 保留已知属性，剔除未知属性，返回 { props, warnings }', async () => {
    // RED: notion-property-map.js 不存在 → import 失败
    const { stripUnknownProperties } = await import(
      '../../../packages/brain/src/notion-property-map.js'
    );

    const input = {
      'Title':          { title: [{ text: { content: '测试' } }] },
      'Initiative ID':  { rich_text: [{ type: 'text', text: { content: 'init-id' } }] },
      'Type':           { select: { name: 'Note' } },
    };
    const allowed = ['Title', 'Type'];

    const { props, warnings } = (stripUnknownProperties as (
      p: Record<string, unknown>,
      a: string[]
    ) => { props: Record<string, unknown>; warnings: string[] })(input, allowed);

    // 已知属性保留
    expect(props).toHaveProperty('Title');
    expect(props).toHaveProperty('Type');
    // 未知属性剔除
    expect(props).not.toHaveProperty('Initiative ID');
    // warnings 非空，含 Initiative ID
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/Initiative ID/i);
  });

  it('stripUnknownProperties: 全部已知时返回空 warnings', async () => {
    const { stripUnknownProperties } = await import(
      '../../../packages/brain/src/notion-property-map.js'
    );

    const input = { 'Title': { title: [] }, 'Type': { select: { name: 'Note' } } };
    const { props, warnings } = (stripUnknownProperties as (
      p: Record<string, unknown>,
      a: string[]
    ) => { props: Record<string, unknown>; warnings: string[] })(input, ['Title', 'Type']);

    expect(warnings).toHaveLength(0);
    expect(props).toHaveProperty('Title');
    expect(props).toHaveProperty('Type');
  });

  it('NOTION_PROPERTY_MAP.notionTask allowedKeys 不含 Status（风险 R2 — Bug 2 回归保护）', async () => {
    // RED: notion-property-map.js 不存在 → import 失败
    // GREEN 条件：notionTask allowlist 不能包含 Status（Status 在 Tasks DB 中不是 properties 字段，只能写到 children）
    const mod = await import('../../../packages/brain/src/notion-property-map.js');
    const notionTask = (mod.NOTION_PROPERTY_MAP as Record<string, { allowedKeys?: string[] }>).notionTask;
    const keys: string[] = notionTask?.allowedKeys ?? Object.keys(notionTask ?? {});
    expect(keys).not.toContain('Status');
  });
});

// ── 2. POST /api/brain/notes → response 含 warnings 字段 ──────────────────

describe('POST /api/brain/notes response 含 warnings [BEHAVIOR]', () => {
  let app: ReturnType<typeof express>;

  beforeAll(async () => {
    vi.resetModules();
    const mod = await import('../../../packages/brain/src/routes/notes.js');
    const router = mod.default;
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotionReq.mockResolvedValue({ id: 'page-abc', url: 'https://notion.so/page-abc' });
  });

  it('成功路径返回 warnings: [] 空数组', async () => {
    // RED: 当前 notes.js handler 不返回 warnings 字段
    const res = await request(app)
      .post('/api/brain/notes')
      .send({ title: '[test] 修复验证', content: '测试内容', type: 'Note' });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings).toHaveLength(0);
  });

  it('降级路径（带未知属性）返回 warnings 非空', async () => {
    // RED: 当前 handler 不支持剔除逻辑，会把未知属性传 Notion 或忽略但不返回 warnings
    const res = await request(app)
      .post('/api/brain/notes')
      .send({
        title: '[test] 降级路径',
        content: '降级测试',
        type: 'Note',
        fake_unknown_field: '应被剔除',
      });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.length).toBeGreaterThan(0);
  });

  it('Notion payload 不含旧属性 "Initiative ID"（防 400 回归）', async () => {
    // RED: 当前代码硬编码 'Initiative ID' → Notion 400 "Initiative ID is not a property"
    await request(app)
      .post('/api/brain/notes')
      .send({
        title: '[test] initiative 测试',
        content: '测试内容',
        type: 'Note',
        initiative_id: 'test-init-id',
      });

    expect(mockNotionReq).toHaveBeenCalledOnce();
    const notionBody = mockNotionReq.mock.calls[0][3] as {
      properties: Record<string, unknown>;
    };
    // 旧属性名 'Initiative ID' 不应出现在 Notion payload 中
    expect(notionBody.properties).not.toHaveProperty('Initiative ID');
  });
});

// ── 3. POST /api/brain/notion/task → response 含 warnings 字段 ────────────

describe('POST /api/brain/notion/task response 含 warnings [BEHAVIOR]', () => {
  let app: ReturnType<typeof express>;

  beforeAll(async () => {
    vi.resetModules();
    const mod = await import('../../../packages/brain/src/routes/notes.js');
    const router = mod.default;
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotionReq.mockResolvedValue({ id: 'page-xyz', url: 'https://notion.so/page-xyz' });
  });

  it('成功路径返回 warnings: [] 空数组', async () => {
    // RED: 当前 notion/task handler 不返回 warnings 字段
    const res = await request(app)
      .post('/api/brain/notion/task')
      .send({ title: '[test] task 修复', ws_number: 1 });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings).toHaveLength(0);
  });

  it('Notion payload 不含旧属性 "Title"（防 400 回归）', async () => {
    // RED: 当前代码用 Title 属性 → Tasks DB 重构后 "Title is not a property"
    await request(app)
      .post('/api/brain/notion/task')
      .send({ title: '[test] task 属性修复', ws_number: 1 });

    expect(mockNotionReq).toHaveBeenCalledOnce();
    const notionBody = mockNotionReq.mock.calls[0][3] as {
      properties: Record<string, unknown>;
    };
    // 旧 Title 属性不应出现（Tasks DB 已改用 Name 或其他名）
    expect(notionBody.properties).not.toHaveProperty('Title');
  });
});
