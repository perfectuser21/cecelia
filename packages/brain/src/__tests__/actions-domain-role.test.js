/**
 * actions.js domain/owner_role 自动填充测试
 * 验证 createTask/createGoal/createProject 通过 domain-detector.js 自动填充 domain
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// hoisted 确保 actions.js 加载时获得同一 pool 实例
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

const mockBroadcast = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../task-updater.js', () => ({ broadcastTaskState: mockBroadcast }));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let createTask, createGoal, createProject;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../actions.js');
  createTask = mod.createTask;
  createGoal = mod.createGoal;
  createProject = mod.createProject;
});

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

    it('不传 domain 时标题无匹配关键词则 domain 写 NULL', async () => {
      const fakeTask = { id: 'task-2', title: '随机任务', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: '随机任务名称无关键词',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      const params = mockQuery.mock.calls[1][1];
      // 标题无 domain 关键词时 detectDomain confidence=0，domain 写 null
      // params 结构：[...commonParams(11), domain($12), delivery_type($13)]
      const domainParam = params[params.length - 2];
      expect(domainParam).toBeNull();
      expect(params[params.length - 1]).toBe('code-only'); // delivery_type 默认值
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

      // domain 现在存入 metadata JSON，owner_role 仍是直接列
      expect(sql).toContain('owner_role');
      expect(sql).toContain('metadata');
      expect(params).toContain('vp_qa');
      // domain 在 metadata JSON 中
      const metaParam = params.find(p => typeof p === 'string' && p.includes('"domain"'));
      expect(metaParam).toBeTruthy();
      expect(JSON.parse(metaParam).domain).toBe('quality');
    });

    it('不传 domain 时标题无匹配关键词则 domain/owner_role 写 NULL', async () => {
      const fakeGoal = { id: 'goal-y', title: '通用规划', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '通用年度规划目标' });

      const params = mockQuery.mock.calls[0][1];
      // visions 表: params = [title, desc, owner_role, end_date, metaJson]
      // owner_role 为 null，domain 在 metadata 中为 null
      expect(params[2]).toBeNull(); // owner_role
      const metaParam = params[params.length - 1];
      expect(JSON.parse(metaParam).domain).toBeNull();
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

      // domain 存入 metadata JSON，owner_role 仍是直接列
      // okr_projects: params = [title, desc, owner_role, metaJson]
      expect(sql).toContain('owner_role');
      expect(sql).toContain('metadata');
      expect(params).toContain('cmo');
      const metaParam = params.find(p => typeof p === 'string' && p.includes('"domain"'));
      expect(metaParam).toBeTruthy();
      expect(JSON.parse(metaParam).domain).toBe('growth');
    });

    it('不传 domain 时从 name+description 自动检测', async () => {
      const fakeProject = { id: 'proj-2', name: 'QA 覆盖项目' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProject] });

      await createProject({ name: 'QA quality regression coverage 项目' });

      const params = mockQuery.mock.calls[0][1];
      // okr_projects: params = [title, desc, owner_role, metaJson]
      // $3 = owner_role, $4 = metaJson (domain in JSON)
      expect(params[2]).toBe('vp_qa'); // owner_role
      expect(JSON.parse(params[3]).domain).toBe('quality');
    });
  });
});
