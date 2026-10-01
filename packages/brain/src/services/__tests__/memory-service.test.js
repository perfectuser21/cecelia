import { describe, expect, it, vi } from 'vitest';
import MemoryService from '../memory-service.js';

describe('Project 详情真身解析', () => {
  it('同 ID 旧根不能遮蔽 Project，名称来自 projects', async () => {
    const pool = { query: vi.fn(async sql => {
      if (sql.includes('FROM tasks')) {
        return { rows: sql.includes("task_type <> 'project'") ? [] : [{ id: 'shared', level: 'task', title: '旧根' }] };
      }
      if (sql.includes('FROM projects')) return { rows: [{ id: 'shared', level: 'project', title: '真实项目', status: 'active' }] };
      return { rows: [] };
    }) };
    expect(await new MemoryService(pool).getDetail('shared')).toMatchObject({ level: 'project', title: '真实项目' });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('不存在实体继续保留显式错误', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(new MemoryService(pool).getDetail('missing')).rejects.toThrow('Entity not found');
  });
});
