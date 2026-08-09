import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../notion-capture-ingest.js', () => ({
  notionRequest: vi.fn(),
}));

import { notionRequest } from '../notion-capture-ingest.js';
import { bootstrapNotionDatabases, runNotionTaskCommandIngest, syncNotionEntity } from '../projection/notion.js';

describe('Notion command durable cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTION_API_KEY = 'test-token';
  });

  it('使用数据库 cursor、遍历分页，并仅在整轮成功后持久化新 cursor', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ enabled: true, config: { task_db_id: 'tasks-db', project_db_id: 'projects-db', command_cursor: '2026-08-08T00:00:00.000Z' } }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'queued' }] })
      .mockResolvedValue({ rows: [] });

    notionRequest
      .mockResolvedValueOnce({
        results: [{
          id: 'page-1', last_edited_time: '2026-08-09T00:00:00.000Z',
          properties: {
            'Brain ID': { rich_text: [{ plain_text: 'task-1' }] },
            Status: { select: { name: 'In Progress' } },
            Command: { select: { name: 'None' } },
            Note: { rich_text: [] },
          },
        }],
        has_more: true,
        next_cursor: 'next-page',
      })
      .mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null });

    const result = await runNotionTaskCommandIngest({ query });

    expect(result).toMatchObject({ pages: 1, recorded: 1 });
    expect(notionRequest).toHaveBeenCalledTimes(2);
    expect(notionRequest.mock.calls[0][3].filter.last_edited_time.after).toBe('2026-08-08T00:00:00.000Z');
    expect(notionRequest.mock.calls[1][3].start_cursor).toBe('next-page');
    const cursorWrite = query.mock.calls.find(([sql]) => String(sql).includes('command_cursor'));
    expect(cursorWrite).toBeDefined();
  });

  it('bootstrap 已有可访问数据库时复用配置，避免重复创建整套数据库', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ enabled: true, config: { task_db_id: 'tasks-db', project_db_id: 'projects-db' } }],
    });
    notionRequest.mockResolvedValue({ id: 'existing-db' });

    const result = await bootstrapNotionDatabases({ query }, 'parent-page');

    expect(result).toEqual({ task_db_id: 'tasks-db', project_db_id: 'projects-db', reused: true });
    expect(notionRequest.mock.calls.every(([, , method]) => method === 'GET')).toBe(true);
  });

  it('task 通过 initiative/scope 推导 canonical project relation', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ enabled: true, config: { task_db_id: 'tasks-db', project_db_id: 'projects-db' } }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: '关联任务', status: 'queued', priority: 'P1', task_type: 'dev', canonical_project_id: 'project-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ external_id: 'project-page-1' }] })
      .mockResolvedValue({ rows: [] });
    notionRequest.mockResolvedValue({ id: 'task-page-1' });

    await syncNotionEntity({ query }, { target: 'notion', entity_type: 'tasks', entity_id: 'task-1' });

    const loadSql = String(query.mock.calls[1][0]);
    expect(loadSql).toContain('okr_initiatives');
    expect(loadSql).toContain('canonical_project_id');
    expect(notionRequest.mock.calls[0][3].properties.Project.relation).toEqual([{ id: 'project-page-1' }]);
  });
});
