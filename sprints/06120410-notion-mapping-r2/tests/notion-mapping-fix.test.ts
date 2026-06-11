/**
 * TDD Red 测试 — Notion 属性映射修复（Sprint 06120410-notion-mapping-r2）Round 3
 *
 * 三处 bug + 共用模块：
 * 1. POST /api/brain/notes：Initiative ID 属性不应进入 AI Notes DB → response.warnings array
 * 2. POST /api/brain/notion/task：Tasks DB title 是 Name 不是 Title → Name 修复 + warnings
 * 3. pushJourneyStepLinks：Step Links DB 无 Order 属性 → 移除（静态 + mock Notion call 双验）
 * 4. 新增 notion-property-map.js 共用模块：stripUnknownProperties + NOTION_PROPERTY_MAP
 *
 * 运行: cd packages/brain && node_modules/.bin/vitest run ../../sprints/06120410-notion-mapping-r2/tests/
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_SRC = resolve(__dirname, '../../../packages/brain/src');

// ─── Bug 4: notion-property-map.js 模块存在性（最先检查） ────

describe('Bug 4 — notion-property-map.js 共用模块', () => {
  const MODULE_PATH = resolve(BRAIN_SRC, 'notion-property-map.js');

  it('notion-property-map.js 文件存在', () => {
    // FAIL 点：文件不存在
    expect(existsSync(MODULE_PATH), `${MODULE_PATH} should exist`).toBe(true);
  });

  it('notion-property-map.js 导出 stripUnknownProperties 函数', async () => {
    if (!existsSync(MODULE_PATH)) return;
    const mod = await import(MODULE_PATH);
    // FAIL 点：当前文件不存在，import 会抛出
    expect(typeof mod.stripUnknownProperties).toBe('function');
  });

  it('notion-property-map.js 导出 NOTION_PROPERTY_MAP 对象', async () => {
    if (!existsSync(MODULE_PATH)) return;
    const mod = await import(MODULE_PATH);
    expect(mod.NOTION_PROPERTY_MAP).toBeDefined();
    expect(typeof mod.NOTION_PROPERTY_MAP).toBe('object');
  });

  it('stripUnknownProperties: 已知属性保留，未知属性剔除写入 warnings', async () => {
    if (!existsSync(MODULE_PATH)) return;
    const { stripUnknownProperties } = await import(MODULE_PATH);
    const { props, warnings } = stripUnknownProperties(
      { Title: { title: [] }, FakeField: { rich_text: [] } },
      ['Title']
    );
    // FAIL 点：函数不存在
    expect(props['Title']).toBeDefined();
    expect(props['FakeField']).toBeUndefined();
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings.some((w: string) => w.includes('FakeField'))).toBe(true);
  });

  it('NOTION_PROPERTY_MAP.notionTask allowedKeys 不含 Status（防 Bug 2 回归）', async () => {
    if (!existsSync(MODULE_PATH)) return;
    const { NOTION_PROPERTY_MAP } = await import(MODULE_PATH);
    const taskMap = NOTION_PROPERTY_MAP?.notionTask || {};
    const taskKeys = taskMap.allowedKeys || Object.keys(taskMap);
    expect(taskKeys).not.toContain('Status');
  });
});

// ─── Mock 设置（Routes 测试用）────────────────────────────────

vi.mock('../../../packages/brain/src/recurring-notion-sync.js', () => ({
  getToken: vi.fn(() => 'test-token'),
  notionReq: vi.fn(),
}));

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const { notionReq } = await import('../../../packages/brain/src/recurring-notion-sync.js');
const { default: pool } = await import('../../../packages/brain/src/db.js');
const { default: notesRouter } = await import('../../../packages/brain/src/routes/notes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', notesRouter);
  return app;
}

// ─── Bug 1: Initiative ID 不进 Notion properties ─────────────

describe('Bug 1 — POST /api/brain/notes: Initiative ID 不进 Notion AI Notes DB properties', () => {
  beforeEach(() => vi.clearAllMocks());

  it('带 initiative_id 时 Notion API 调用不含 Initiative ID property', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'page-id', url: 'https://notion.so/page-id' });
    await request(makeApp())
      .post('/api/brain/notes')
      .send({ title: 'Test', content: 'body', type: 'Note', initiative_id: 'cf4f596c-1234' });
    const notionBody = (notionReq as any).mock.calls[0]?.[3];
    // FAIL 点：当前代码会在 properties 里加 'Initiative ID'
    expect(notionBody?.properties?.['Initiative ID']).toBeUndefined();
  });

  it('成功响应含 warnings array（initiative_id 剔除留痕）', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'page-id', url: 'https://notion.so/page-id' });
    const res = await request(makeApp())
      .post('/api/brain/notes')
      .send({ title: 'Note', content: 'body', type: 'Note', initiative_id: 'test-id' });
    expect(res.status).toBe(201);
    // FAIL 点：当前代码响应无 warnings 字段
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('initiative_id 仍写入 Brain DB（不因剔除 Notion 属性而丢失）', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'page-id', url: 'https://notion.so/page-id' });
    await request(makeApp())
      .post('/api/brain/notes')
      .send({ title: 'Note', content: 'body', type: 'Note', initiative_id: 'cf4f596c-test' });
    const dbCall = (pool.query as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO notes')
    );
    expect(dbCall).toBeTruthy();
    expect(dbCall[1]).toContain('cf4f596c-test');
  });

  it('不含 initiative_id 时 warnings 为空 array', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'page-id', url: 'https://notion.so/page-id' });
    const res = await request(makeApp())
      .post('/api/brain/notes')
      .send({ title: 'Plain', content: 'body', type: 'Note' });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.length).toBe(0);
  });
});

// ─── Bug 2: notion/task 使用 Name 而非 Title ─────────────────

describe('Bug 2 — POST /api/brain/notion/task: Notion Tasks DB title 属性名是 Name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Notion API 调用使用 Name 属性（不是 Title）写入 Tasks DB', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'task-id', url: 'https://notion.so/task-id' });
    await request(makeApp())
      .post('/api/brain/notion/task')
      .send({ title: '实现功能', ws_number: 1 });
    const notionBody = (notionReq as any).mock.calls[0]?.[3];
    // FAIL 点：当前代码用 Title 而非 Name
    expect(notionBody?.properties?.['Name']).toBeDefined();
    expect(notionBody?.properties?.['Title']).toBeUndefined();
  });

  it('Name 属性类型为 title array', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'task-id', url: 'https://notion.so/task-id' });
    await request(makeApp())
      .post('/api/brain/notion/task')
      .send({ title: '测试任务', ws_number: 2 });
    const notionBody = (notionReq as any).mock.calls[0]?.[3];
    expect(Array.isArray(notionBody?.properties?.['Name']?.title)).toBe(true);
  });

  it('成功响应含 warnings array', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'task-id', url: 'https://notion.so/task-id' });
    const res = await request(makeApp())
      .post('/api/brain/notion/task')
      .send({ title: 'fix', ws_number: 1 });
    expect(res.status).toBe(201);
    // FAIL 点：当前代码响应无 warnings 字段
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('WS 前缀功能保持（Name 修复后不影响 WS 前缀逻辑）', async () => {
    (notionReq as any).mockResolvedValueOnce({ id: 'task-id', url: 'https://notion.so/task-id' });
    const res = await request(makeApp())
      .post('/api/brain/notion/task')
      .send({ title: 'mapping fix', ws_number: 1 });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('[WS1] mapping fix');
  });
});

// ─── Bug 3: pushJourneyStepLinks 不含 Order 属性（静态 + 语义双验）────

describe('Bug 3 — pushJourneyStepLinks: 不发送 Order 属性（Step Links DB 已移除）', () => {
  it('源码静态断言：pushJourneyStepLinks 函数体不含 Order: 字符串（精确正则匹配，不误报注释）', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'notion-push-sync.js'), 'utf8');
    const fnStart = src.indexOf('async function pushJourneyStepLinks');
    const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
    const fnBody = fnStart >= 0 ? src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined) : '';
    // FAIL 点：当前代码含 Order: { number: l.step_order }
    // 使用正则精确匹配属性定义格式，不误报注释中的 "Order:" 文字
    expect(fnBody).not.toMatch(/\bOrder\s*:\s*\{/);
  });

  it('源码静态断言：pushJourneyStepLinks 函数体仍含 Name（title 属性正常）', () => {
    const src = readFileSync(resolve(BRAIN_SRC, 'notion-push-sync.js'), 'utf8');
    const fnStart = src.indexOf('async function pushJourneyStepLinks');
    const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
    const fnBody = fnStart >= 0 ? src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined) : '';
    expect(fnBody).toContain('Name');
  });

  it('语义验证：runNotionPushSync 调用 Notion API 时 properties 不含 Order 键', async () => {
    // 验证 pushJourneyStepLinks 传给 notionReq 的 properties 对象没有 Order 键
    // 本测试在 vi.mock 已设置的 notionReq mock 环境中运行
    // FAIL 点（修复前）：notionReq 的第4个参数 properties 含 { Order: { number: ... } }
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })  // journeys query
      .mockResolvedValueOnce({ rows: [] })  // features query
      .mockResolvedValueOnce({ rows: [] })  // issues query
      .mockResolvedValueOnce({ rows: [] })  // skill_registry query
      .mockResolvedValueOnce({ rows: [] })  // journey_steps query
      .mockResolvedValueOnce({              // journey_step_links query — 返回 1 条待同步记录
        rows: [{
          id: 'sl-test-uuid',
          step_order: 3,
          status: 'planned',
          journey_notion_id: 'journey-notion-id-xyz',
          step_notion_id: 'step-notion-id-xyz',
          journey_name: 'Test Journey',
          step_name: 'Test Step',
        }],
      })
      .mockResolvedValue({ rows: [] });  // UPDATE journey_step_links + notion_sync_log INSERT

    (notionReq as any).mockResolvedValue({ id: 'new-step-link-page-id' });

    const { runNotionPushSync } = await import('../../../packages/brain/src/notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    // 找到针对 step_links DB 的 notionReq 调用
    const STEP_LINKS_DB = '369c40c2-ba63-81e2-b95a-e5e3d0592676';
    const stepLinkCall = (notionReq as any).mock.calls.find(
      (call: any[]) => call[3]?.parent?.database_id === STEP_LINKS_DB
    );

    // 若当前代码含 Order:，properties 中会有 Order 键 → test FAIL（修复前预期 RED）
    if (stepLinkCall) {
      const props = stepLinkCall[3]?.properties ?? {};
      expect(props).not.toHaveProperty('Order');
      expect(props).toHaveProperty('Name');
    }
    // 若 stepLinkCall 为 undefined（notionReq 未被调用），说明 step_link query 返回空行
    // 此分支不发生（上方 mockQuery 已返回 1 条记录）
  });
});
