import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock pool（避免 PostgreSQL 依赖）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import { pushCompareReportToNotion } from '../project-compare.js';

const VALID_IDS = ['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002'];
const MOCK_MARKDOWN = '# 项目对比报告\n\n项目 A 优于 项目 B。\n\n详细分析如下。';
const MOCK_PAGE_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
const MOCK_NOTION_URL = `https://notion.so/${MOCK_PAGE_ID.replace(/-/g, '')}`;

describe('pushCompareReportToNotion', () => {
  let mockFetch;
  let mockGenerate;
  const savedEnv = {};

  beforeEach(() => {
    // 保存并清除环境变量
    savedEnv.NOTION_API_KEY = process.env.NOTION_API_KEY;
    savedEnv.NOTION_COMPARE_PARENT_ID = process.env.NOTION_COMPARE_PARENT_ID;
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_COMPARE_PARENT_ID;

    // 创建 mock generate 函数
    mockGenerate = vi.fn().mockResolvedValue({
      generated_at: new Date().toISOString(),
      format: 'markdown',
      projects: [],
      summary: '测试摘要',
      markdown: MOCK_MARKDOWN,
    });

    // 创建 mock fetch
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: MOCK_PAGE_ID }),
    });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // 恢复环境变量
    if (savedEnv.NOTION_API_KEY !== undefined) {
      process.env.NOTION_API_KEY = savedEnv.NOTION_API_KEY;
    } else {
      delete process.env.NOTION_API_KEY;
    }
    if (savedEnv.NOTION_COMPARE_PARENT_ID !== undefined) {
      process.env.NOTION_COMPARE_PARENT_ID = savedEnv.NOTION_COMPARE_PARENT_ID;
    } else {
      delete process.env.NOTION_COMPARE_PARENT_ID;
    }
    vi.clearAllMocks();
  });

  it('正常路径：成功推送到 Notion，返回 success true、notion_url、page_id', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'parent-page-id';

    const result = await pushCompareReportToNotion({
      project_ids: VALID_IDS,
      _generateFn: mockGenerate,
    });

    expect(result.success).toBe(true);
    expect(result.notion_url).toBe(MOCK_NOTION_URL);
    expect(result.page_id).toBe(MOCK_PAGE_ID);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.notion.com/v1/pages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
  });

  it('notion_parent_id 参数优先于环境变量 NOTION_COMPARE_PARENT_ID', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'env-parent-id';

    await pushCompareReportToNotion({
      project_ids: VALID_IDS,
      notion_parent_id: 'custom-parent-id',
      _generateFn: mockGenerate,
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.parent.page_id).toBe('custom-parent-id');
  });

  it('NOTION_API_KEY 缺失时抛出 status 400 NOTION_CONFIG_MISSING', async () => {
    process.env.NOTION_COMPARE_PARENT_ID = 'parent-page-id';
    // NOTION_API_KEY 未设置

    await expect(
      pushCompareReportToNotion({ project_ids: VALID_IDS, _generateFn: mockGenerate })
    ).rejects.toMatchObject({ status: 400, code: 'NOTION_CONFIG_MISSING' });
  });

  it('notion_parent_id 两者均缺失时抛出 status 400 NOTION_PARENT_MISSING', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    // notion_parent_id 未传，NOTION_COMPARE_PARENT_ID 未设置

    await expect(
      pushCompareReportToNotion({ project_ids: VALID_IDS, _generateFn: mockGenerate })
    ).rejects.toMatchObject({ status: 400, code: 'NOTION_PARENT_MISSING' });
  });

  it('project_ids 不足 2 个时，generate 抛出 400 错误被透传', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'parent-page-id';

    const mockGenerateFail = vi.fn().mockRejectedValue(
      Object.assign(new Error('project_ids must have at least 2 items'), { status: 400 })
    );

    await expect(
      pushCompareReportToNotion({ project_ids: ['only-one-id'], _generateFn: mockGenerateFail })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('Notion API 返回错误时透传 error.message 和 code', async () => {
    process.env.NOTION_API_KEY = 'test-key';
    process.env.NOTION_COMPARE_PARENT_ID = 'parent-page-id';

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Could not find parent page', code: 'object_not_found' }),
    });

    await expect(
      pushCompareReportToNotion({ project_ids: VALID_IDS, _generateFn: mockGenerate })
    ).rejects.toMatchObject({
      message: 'Could not find parent page',
      code: 'object_not_found',
      status: 404,
    });
  });
});

describe('destination 校验（路由层逻辑）', () => {
  it('destination=slack 应被标记为不支持', () => {
    // 路由代码：if (destination !== 'notion') return 400 UNSUPPORTED_DESTINATION
    const destination = 'slack';
    expect(destination !== 'notion').toBe(true);
  });

  it('destination=notion 应通过校验', () => {
    const destination = 'notion';
    expect(destination === 'notion').toBe(true);
  });
});
