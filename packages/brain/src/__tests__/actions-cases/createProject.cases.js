import { describe, it, expect } from 'vitest';
import { mockQuery, createProject } from './fixture.js';

export function registerCreateProject() {
describe('createProject', () => {
    it('正常创建项目（单仓库）——写入 projects 表', async () => {
      const fakeProj = { id: 'proj-1', name: '新项目', type: 'project' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProj] }); // INSERT projects

      const result = await createProject({
        name: '新项目',
        repo_path: '/home/xx/repo',
      });

      expect(result.success).toBe(true);
      expect(result.project.id).toBe('proj-1');
      // 只有 1 次 INSERT（无 project_repos 表）
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO projects');
    });

    it('缺少 name 返回失败', async () => {
      const result = await createProject({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('多仓库项目', async () => {
      const fakeProj = { id: 'proj-multi', name: '多仓库', type: 'project' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProj] }); // INSERT projects

      const result = await createProject({
        name: '多仓库',
        repo_paths: ['/repo1', '/repo2'],
      });

      expect(result.success).toBe(true);
      // 只有 1 次 INSERT（repo_path 存真身表自己的列，无 project_repos）
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('关联 KR', async () => {
      const fakeProj = { id: 'proj-kr', name: 'KR项目', type: 'project' };
      mockQuery
        .mockResolvedValueOnce({ rows: [fakeProj] })  // INSERT projects
        .mockResolvedValueOnce({ rows: [] });          // UPDATE projects SET kr_id

      const result = await createProject({
        name: 'KR项目',
        kr_ids: ['kr-1', 'kr-2'],
      });

      expect(result.success).toBe(true);
      // 1 次 INSERT + 1 次 UPDATE kr_id (只链接第一个 KR)
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1][0]).toContain('UPDATE projects');
    });

    it('无仓库无KR只插入 projects 表', async () => {
      const fakeProj = { id: 'proj-min', name: '最小', type: 'project' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProj] });

      const result = await createProject({ name: '最小' });

      expect(result.success).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('repo_paths 的第一个作为 repo_path 写入真身表的 repo_path 列（不再是 metadata）', async () => {
      const fakeProj = { id: 'proj-rp', name: '路径回退', repo_path: '/first-repo' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProj] });

      const result = await createProject({
        name: '路径回退',
        repo_paths: ['/first-repo'],
      });

      // 新表 projects: params = [name, desc, owner_role, repo_path, metaJson]
      const insertProjectParams = mockQuery.mock.calls[0][1];
      expect(insertProjectParams[3]).toBe('/first-repo');
      expect(result.project.repo_path).toBe('/first-repo');
    });
  });
}
