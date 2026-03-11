/**
 * project-compare-push 单元测试
 * 覆盖：pushCompareReportToNotion 正常路径 + 各类错误路径
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

import { pushCompareReportToNotion } from '../project-compare.js';

const PROJECT_A = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Project Alpha',
  type: 'initiative',
  status: 'active',
  created_at: new Date(),
  updated_at: new Date(),
};
const PROJECT_B = {
  id: 'bbbbbbbb-0000-0000-0000-000000000002',
  name: 'Project Beta',
  type: 'project',
  status: 'active',
  created_at: new Date(),
  updated_at: new Date(),
};

const MOCK_PAGE_ID = 'page-id-11111111-2222-3333-4444-555555555555';
const MOCK_NOTION_URL = `https://notion.so/${MOCK_PAGE_ID.replace(/-/g, '')}`;

function setupSuccessfulDbMocks() {
  mockPool.query
    .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
    .mockResolvedValueOnce({ rows: [] });
}

function mockFetchSuccess() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: MOCK_PAGE_ID }),
  }));
}

describe('pushCompareReportToNotion', () => {
  const SAVED_ENV = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // 保存并清除相关环境变量
    SAVED_ENV.NOTION_API_KEY = process.env.NOTION_API_KEY;
    SAVED_ENV.NOTION_COMPARE_PARENT_ID = process.env.NOTION_COMPARE_PARENT_ID;
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_COMPARE_PARENT_ID;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // 还原环境变量
    if (SAVED_ENV.NOTION_API_KEY !== undefined) {
      process.env.NOTION_API_KEY = SAVED_ENV.NOTION_API_KEY;
    } else {
      delete process.env.NOTION_API_KEY;
    }
    if (SAVED_ENV.NOTION_COMPARE_PARENT_ID !== undefined) {
      process.env.NOTION_COMPARE_PARENT_ID = SAVED_ENV.NOTION_COMPARE_PARENT_ID;
    } else {
      delete process.env.NOTION_COMPARE_PARENT_ID;
    }
  });

  it('正常路径：创建 Notion 页面，返回 success/notion_url/page_id', async () => {
    process.env.NOTION_API_KEY = 'secret-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'parent-page-abc';
    setupSuccessfulDbMocks();
    mockFetchSuccess();

    const result = await pushCompareReportToNotion({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    expect(result.success).toBe(true);
    expect(result.page_id).toBe(MOCK_PAGE_ID);
    expect(result.notion_url).toBe(MOCK_NOTION_URL);
  });

  it('notion_parent_id 从参数传入时优先于环境变量', async () => {
    process.env.NOTION_API_KEY = 'secret-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'env-parent';
    setupSuccessfulDbMocks();

    let capturedBody;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: MOCK_PAGE_ID }) };
    }));

    await pushCompareReportToNotion({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
      notion_parent_id: 'param-parent',
    });

    expect(capturedBody.parent.page_id).toBe('param-parent');
  });

  it('NOTION_API_KEY 缺失时抛出 status:400 code:NOTION_CONFIG_MISSING', async () => {
    await expect(
      pushCompareReportToNotion({
        project_ids: [PROJECT_A.id, PROJECT_B.id],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'NOTION_CONFIG_MISSING',
    });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('notion_parent_id 两者均缺失时抛出 status:400', async () => {
    process.env.NOTION_API_KEY = 'secret-key';

    await expect(
      pushCompareReportToNotion({
        project_ids: [PROJECT_A.id, PROJECT_B.id],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('project_ids 少于 2 时抛出 status:400', async () => {
    process.env.NOTION_API_KEY = 'secret-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'parent-page';

    await expect(
      pushCompareReportToNotion({
        project_ids: [PROJECT_A.id],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('Notion API 返回错误时透传 error.message', async () => {
    process.env.NOTION_API_KEY = 'secret-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'parent-page';
    setupSuccessfulDbMocks();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Insufficient permissions' }),
    }));

    await expect(
      pushCompareReportToNotion({
        project_ids: [PROJECT_A.id, PROJECT_B.id],
      })
    ).rejects.toMatchObject({
      message: 'Insufficient permissions',
      status: 502,
    });
  });
});
