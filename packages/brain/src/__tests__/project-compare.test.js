/**
 * project-compare 单元测试
 * 覆盖：正常路径（JSON/Markdown）、输入验证、项目不存在
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

import { generateCompareReport, markdownToBlocks, exportToNotion } from '../project-compare.js';

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

const TASK_STATS_A = {
  project_id: PROJECT_A.id,
  total: '10',
  completed: '7',
  in_progress: '2',
  queued: '1',
  failed: '0',
  quarantined: '0',
  p0_in_progress: '1',
  recent_active: '3',
};

const TASK_STATS_B = {
  project_id: PROJECT_B.id,
  total: '5',
  completed: '1',
  in_progress: '0',
  queued: '4',
  failed: '1',
  quarantined: '0',
  p0_in_progress: '0',
  recent_active: '0',
};

describe('generateCompareReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回正确的 JSON 对比报告', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })  // projects query
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] }); // tasks query

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    expect(report.format).toBe('json');
    expect(report.generated_at).toBeTruthy();
    expect(report.projects).toHaveLength(2);
    expect(report.summary).toBeTruthy();
    expect(report.markdown).toBeUndefined();

    const alpha = report.projects.find(p => p.id === PROJECT_A.id);
    expect(alpha).toBeTruthy();
    expect(alpha.task_stats.total).toBe(10);
    expect(alpha.task_stats.completion_rate).toBe(0.7);
    expect(alpha.score).toBeGreaterThan(0);
    expect(alpha.strengths).toBeInstanceOf(Array);
    expect(alpha.weaknesses).toBeInstanceOf(Array);
  });

  it('format=markdown 时返回 markdown 字段', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
      format: 'markdown',
    });

    expect(report.format).toBe('markdown');
    expect(report.markdown).toBeTruthy();
    expect(report.markdown).toContain('# 项目对比报告');
    expect(report.markdown).toContain('Project Alpha');
    expect(report.markdown).toContain('## 总结');
  });

  it('project_ids 少于 2 个时抛出 400 错误', async () => {
    await expect(
      generateCompareReport({ project_ids: ['only-one-id'] })
    ).rejects.toMatchObject({
      message: expect.stringContaining('at least 2'),
      status: 400,
    });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('project_ids 为空数组时抛出 400 错误', async () => {
    await expect(
      generateCompareReport({ project_ids: [] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('project_ids 不是数组时抛出 400 错误', async () => {
    await expect(
      generateCompareReport({ project_ids: null })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('不存在的 project_id 时抛出 400 错误', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [PROJECT_A], // 只返回 A，B 不存在
    });

    await expect(
      generateCompareReport({
        project_ids: [PROJECT_A.id, 'nonexistent-uuid'],
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('not found'),
      status: 400,
    });
  });

  it('无任务的项目评分为 40 分（无失败/隔离加 20 分，其余 0）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [] }); // 无任务统计

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    for (const p of report.projects) {
      expect(p.score).toBe(20); // total=0 → completion 0分，no blocker 20分，p0 0分，activity 0分
    }
  });

  it('结果按评分降序排列', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_B, PROJECT_A] }) // B 先返回
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    // Alpha 分数高，应排第一
    expect(report.projects[0].score).toBeGreaterThanOrEqual(report.projects[1].score);
  });

  it('summary 提到最高分项目', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    expect(report.summary).toContain(report.projects[0].name);
  });
});

describe('markdownToBlocks', () => {
  it('将 # 标题转换为 heading_1', () => {
    const blocks = markdownToBlocks('# 标题一');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('heading_1');
    expect(blocks[0].heading_1.rich_text[0].text.content).toBe('标题一');
  });

  it('将 ## 标题转换为 heading_2', () => {
    const blocks = markdownToBlocks('## 第二节');
    expect(blocks[0].type).toBe('heading_2');
    expect(blocks[0].heading_2.rich_text[0].text.content).toBe('第二节');
  });

  it('将 ### 标题转换为 heading_3', () => {
    const blocks = markdownToBlocks('### 小节');
    expect(blocks[0].type).toBe('heading_3');
  });

  it('普通文本转换为 paragraph', () => {
    const blocks = markdownToBlocks('普通段落');
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].paragraph.rich_text[0].text.content).toBe('普通段落');
  });

  it('空行被跳过', () => {
    const blocks = markdownToBlocks('# 标题\n\n段落');
    expect(blocks).toHaveLength(2);
  });

  it('超长内容截断到 2000 字符', () => {
    const longText = 'a'.repeat(3000);
    const blocks = markdownToBlocks(longText);
    expect(blocks[0].paragraph.rich_text[0].text.content).toHaveLength(2000);
  });
});

describe('exportToNotion', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('NOTION_API_KEY 未配置时抛出错误', async () => {
    delete process.env.NOTION_API_KEY;
    await expect(exportToNotion({ generated_at: 'now', projects: [], summary: '' }))
      .rejects.toThrow('NOTION_API_KEY');
  });

  it('NOTION_REPORTS_PAGE_ID 未配置时抛出错误', async () => {
    process.env.NOTION_API_KEY = 'test-token';
    delete process.env.NOTION_REPORTS_PAGE_ID;
    await expect(exportToNotion({ generated_at: 'now', projects: [], summary: '' }))
      .rejects.toThrow('NOTION_REPORTS_PAGE_ID');
  });

  it('成功创建 Notion Page 并返回 URL', async () => {
    process.env.NOTION_API_KEY = 'test-token';
    process.env.NOTION_REPORTS_PAGE_ID = 'parent-page-id';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://notion.so/test-page' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const report = {
      generated_at: '2026-03-10T00:00:00.000Z',
      projects: [],
      summary: '测试摘要',
      markdown: '# 测试报告\n\n测试内容',
    };

    const url = await exportToNotion(report);
    expect(url).toBe('https://notion.so/test-page');
    expect(mockFetch).toHaveBeenCalledOnce();

    const [fetchUrl, fetchOpts] = mockFetch.mock.calls[0];
    expect(fetchUrl).toContain('/pages');
    expect(fetchOpts.method).toBe('POST');

    const body = JSON.parse(fetchOpts.body);
    expect(body.parent.page_id).toBe('parent-page-id');
    expect(body.properties.title.title[0].text.content).toContain('项目对比报告');

    vi.unstubAllGlobals();
  });

  it('Notion API 失败时抛出错误', async () => {
    process.env.NOTION_API_KEY = 'test-token';
    process.env.NOTION_REPORTS_PAGE_ID = 'parent-page-id';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(exportToNotion({
      generated_at: '2026-03-10T00:00:00.000Z',
      projects: [],
      summary: '',
      markdown: '# 报告',
    })).rejects.toThrow('401');

    vi.unstubAllGlobals();
  });
});

describe('generateCompareReport - Notion 导出', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('export=notion 时调用 exportToNotion，返回 notion_url', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    process.env.NOTION_API_KEY = 'test-token';
    process.env.NOTION_REPORTS_PAGE_ID = 'parent-page-id';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://notion.so/report-page' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
      export: 'notion',
    });

    expect(report.notion_url).toBe('https://notion.so/report-page');
    expect(report.notion_export_error).toBeUndefined();

    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_REPORTS_PAGE_ID;
    vi.unstubAllGlobals();
  });

  it('Notion 导出失败时主报告仍正常返回，携带 notion_export_error', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    delete process.env.NOTION_API_KEY;

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
      export: 'notion',
    });

    expect(report.projects).toHaveLength(2);
    expect(report.notion_export_error).toBeTruthy();
    expect(report.notion_url).toBeUndefined();
  });
});
