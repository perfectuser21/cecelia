/**
 * actions.js domain/owner_role 自动填充测试
 * 验证 createTask/createGoal/createProject 通过 domain-detector.js 自动填充 domain
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

const mockBroadcast = vi.fn().mockResolvedValue(undefined);
vi.mock('../task-updater.js', () => ({ broadcastTaskState: mockBroadcast }));

const { createTask, createGoal, createProject } = await import('../actions.js');

describe('actions.js - domain 自动填充', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== createTask =====
  describe('createTask - domain 填充', () => {
    it('传入 domain=coding 时 INSERT 包含该 domain', async () => {
      const fakeTask = { id: 'task-1', title: '测试', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] }); // dedup
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] }); // INSERT

      await createTask({
        title: '测试任务',
        goal_id: 'goal-1',
        task_type: 'dev',
        domain: 'coding',
      });

      const insertCall = mockQuery.mock.calls[1];
      const sql = insertCall[0];
      const params = insertCall[1];

      expect(sql).toContain('domain');
      expect(params).toContain('coding');
    });

    it('不传 domain 时，从 title+description 自动检测 domain', async () => {
      const fakeTask = { id: 'task-2', title: 'fix bug', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: 'fix bug in API',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      const params = mockQuery.mock.calls[1][1];
      // 最后一个参数是 domain，应自动检测为 coding（含 "bug", "fix", "api" 关键词）
      const domainParam = params[params.length - 1];
      expect(domainParam).toBe('coding');
    });

    it('传入 domain=product 时 INSERT 包含 product', async () => {
      const fakeTask = { id: 'task-3', title: '产品', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: '产品功能',
        goal_id: 'goal-1',
        task_type: 'dev',
        domain: 'product',
      });

      const params = mockQuery.mock.calls[1][1];
      expect(params).toContain('product');
    });
  });

  // ===== createGoal =====
  describe('createGoal - domain/owner_role 填充', () => {
    it('传入 domain=quality, owner_role=vp_qa 时 INSERT 包含两个字段', async () => {
      const fakeGoal = { id: 'goal-x', title: '质量保障目标', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({
        title: '质量保障目标',
        domain: 'quality',
        owner_role: 'vp_qa',
      });

      const insertCall = mockQuery.mock.calls[0];
      const sql = insertCall[0];
      const params = insertCall[1];

      expect(sql).toContain('domain');
      expect(sql).toContain('owner_role');
      expect(params).toContain('quality');
      expect(params).toContain('vp_qa');
    });

    it('不传 domain 时从 title 自动检测 domain/owner_role', async () => {
      const fakeGoal = { id: 'goal-y', title: 'agent OKR', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: 'Brain agent dispatch OKR' });

      const params = mockQuery.mock.calls[0][1];
      // domain 和 owner_role 是最后两个参数（$8, $9）
      const domainParam = params[params.length - 2];
      const ownerRoleParam = params[params.length - 1];
      expect(domainParam).toBe('agent_ops');
      expect(ownerRoleParam).toBe('vp_agent_ops');
    });
  });

  // ===== createProject =====
  describe('createProject - domain/owner_role 填充', () => {
    it('传入 domain=growth 时 INSERT 包含 domain=growth, owner_role=cmo', async () => {
      const fakeProject = { id: 'proj-1', name: '增长项目' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProject] });

      await createProject({
        name: '增长项目',
        domain: 'growth',
      });

      const insertCall = mockQuery.mock.calls[0];
      const sql = insertCall[0];
      const params = insertCall[1];

      expect(sql).toContain('domain');
      expect(sql).toContain('owner_role');
      expect(params).toContain('growth');
      expect(params).toContain('cmo');
    });

    it('不传 domain 时从 name+description 自动检测', async () => {
      const fakeProject = { id: 'proj-2', name: 'QA 覆盖项目' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProject] });

      await createProject({ name: 'QA quality regression coverage 项目' });

      const params = mockQuery.mock.calls[0][1];
      // $4 = domain, $5 = owner_role
      expect(params[3]).toBe('quality');
      expect(params[4]).toBe('vp_qa');
    });
  });
});
