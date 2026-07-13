/**
 * TDD Red: notion-push-sync step_link Order 属性降级测试
 *
 * 当前 notion-push-sync.js 硬编码 Order: { number: l.step_order } 写 STEP_LINKS_DB。
 * 若 STEP_LINKS_DB 无 Order property → Notion 400 "is not a property"。
 * 修复后应：查 schema → Order 不在 schema → 跳过该字段（不写入 properties）。
 *
 * 这些测试在修复前 FAIL，修复后 PASS。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockNotionReq = vi.fn();

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../recurring-notion-sync.js', () => ({
  notionReq: mockNotionReq,
  getToken: () => 'fake-token',
}));

describe('pushJourneyStepLinks — Order 属性降级 [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('STEP_LINKS_DB schema 无 Order property 时 — Notion 创建页面 properties 不含 Order', async () => {
    const stepLink = {
      id: 'sl-test-1',
      journey_name: 'R4 Journey',
      step_name: 'R4 Step',
      step_order: 3,
      status: 'active',
      journey_notion_id: 'j-notion-1',
      step_notion_id: 's-notion-1',
    };

    // query mock: step_links 有一行待同步
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // journeys (empty)
      .mockResolvedValueOnce({ rows: [] })   // features (empty)
      .mockResolvedValueOnce({ rows: [] })   // issues (empty)
      .mockResolvedValueOnce({ rows: [] })   // skill_registry (empty)
      .mockResolvedValueOnce({ rows: [] })   // journey_steps (empty)
      .mockResolvedValueOnce({ rows: [stepLink] }) // journey_step_links → 1 row
      .mockResolvedValueOnce({ rows: [] })   // decisions (empty)
      .mockResolvedValueOnce({ rows: [] })   // initiative_contracts (empty)
      .mockResolvedValue({ rows: [] });      // UPDATE fallback

    // notionReq mock:
    // 第一次: getDbSchema for STEP_LINKS_DB → schema 无 Order
    // 第二次: create page → success
    mockNotionReq
      .mockResolvedValueOnce({
        properties: {
          Name: { type: 'title' },
          Status: { type: 'select' },
          Journey: { type: 'relation' },
          Step: { type: 'relation' },
          // 注意：没有 'Order' property
        },
      })
      .mockResolvedValueOnce({ id: 'sl-notion-1' });

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    // 找到创建 step_link 页面的 notionReq 调用
    const createCall = mockNotionReq.mock.calls.find(
      (c) => c[2] === 'POST' && c[1] === '/pages'
    );
    expect(createCall).toBeDefined();

    const properties = createCall![3].properties;
    // 关键断言：Order 不在 schema → properties 中不含 Order
    expect(properties).not.toHaveProperty('Order');
    // Name/Status 应存在（schema 中有）
    expect(properties).toHaveProperty('Name');
    expect(properties).toHaveProperty('Status');
  });

  it('STEP_LINKS_DB schema 有 Order property 时 — properties 包含 Order（正常路径）', async () => {
    const stepLink = {
      id: 'sl-test-2',
      journey_name: 'R4 Journey 2',
      step_name: 'R4 Step 2',
      step_order: 5,
      status: 'active',
      journey_notion_id: 'j-notion-2',
      step_notion_id: 's-notion-2',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [stepLink] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });

    // schema 包含 Order property
    mockNotionReq
      .mockResolvedValueOnce({
        properties: {
          Name: { type: 'title' },
          Status: { type: 'select' },
          Order: { type: 'number' }, // schema 中存在
          Journey: { type: 'relation' },
          Step: { type: 'relation' },
        },
      })
      .mockResolvedValueOnce({ id: 'sl-notion-2' });

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    await runNotionPushSync({ query: mockQuery });

    const createCall = mockNotionReq.mock.calls.find(
      (c) => c[2] === 'POST' && c[1] === '/pages'
    );
    expect(createCall).toBeDefined();

    const properties = createCall![3].properties;
    // schema 有 Order → 应写入
    expect(properties).toHaveProperty('Order');
    expect(properties.Order).toEqual({ number: 5 });
  });

  it('step_link 推送时 Notion 400（属性不存在）→ 降级：不抛出，notion_synced_at 保持 NULL', async () => {
    const stepLink = {
      id: 'sl-test-3',
      journey_name: 'R4 Journey 3',
      step_name: 'R4 Step 3',
      step_order: 1,
      status: 'active',
      journey_notion_id: 'j-notion-3',
      step_notion_id: 's-notion-3',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [stepLink] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });

    // schema 查询成功，但 create page 抛出 400（模拟真实 Notion 400 场景）
    const notionError = new Error('Notion POST /pages → 400: is not a property');
    (notionError as any).status = 400;
    mockNotionReq
      .mockResolvedValueOnce({ properties: { Name: { type: 'title' } } }) // schema
      .mockRejectedValueOnce(notionError); // create page 400

    const { runNotionPushSync } = await import('../notion-push-sync.js');
    // 不应抛出（pushJourneyStepLinks 按行 try-catch）
    await expect(runNotionPushSync({ query: mockQuery })).resolves.not.toThrow();

    // notion_synced_at 不应被更新（create 失败，UPDATE 不调用）
    const updateCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE journey_step_links')
    );
    expect(updateCall).toBeUndefined();
  });
});
