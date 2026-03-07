/**
 * actions.js 单元测试
 * 覆盖所有导出函数：createTask, createInitiative, createProject,
 * updateTask, createGoal, updateGoal, triggerN8n, setMemory, batchUpdateTasks
 * 以及 domain/owner_role 自动推断（role-registry 集成）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock broadcastTaskState
const mockBroadcast = vi.fn().mockResolvedValue(undefined);
vi.mock('../task-updater.js', () => ({ broadcastTaskState: mockBroadcast }));

// Mock fetch (用于 triggerN8n)
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { createTask, createInitiative, createProject, updateTask, createGoal, updateGoal, triggerN8n, setMemory, batchUpdateTasks } = await import('../actions.js');

describe('actions.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== createTask ==========
  describe('createTask', () => {
    it('正常创建任务（含 goal_id）', async () => {
      const fakeTask = { id: 'task-1', title: '测试任务', status: 'queued' };
      // 去重查询 - 无重复
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await createTask({
        title: '测试任务',
        description: '描述',
        priority: 'P0',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      expect(result.success).toBe(true);
      expect(result.task).toEqual(fakeTask);
      expect(result.deduplicated).toBeUndefined();
      expect(mockBroadcast).toHaveBeenCalledWith('task-1');
    });

    it('缺少 goal_id 且非系统任务时抛出错误', async () => {
      await expect(
        createTask({ title: '缺少目标', task_type: 'dev' })
      ).rejects.toThrow('goal_id is required');
    });

    it('系统任务（task_type=research）可以没有 goal_id', async () => {
      const fakeTask = { id: 'task-r', title: '研究', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await createTask({
        title: '研究',
        task_type: 'research',
      });

      expect(result.success).toBe(true);
    });

    it('系统触发源（trigger_source=manual）可以没有 goal_id', async () => {
      const fakeTask = { id: 'task-m', title: '手动', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await createTask({
        title: '手动',
        task_type: 'dev',
        trigger_source: 'manual',
      });

      expect(result.success).toBe(true);
    });

    it('trigger_source=test 可以没有 goal_id', async () => {
      const fakeTask = { id: 'task-t', title: '测试来源', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await createTask({
        title: '测试来源',
        task_type: 'dev',
        trigger_source: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('trigger_source=watchdog 可以没有 goal_id', async () => {
      const fakeTask = { id: 'task-w', title: '看门狗', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await createTask({
        title: '看门狗',
        task_type: 'dev',
        trigger_source: 'watchdog',
      });
      expect(result.success).toBe(true);
    });

    it('trigger_source=circuit_breaker 可以没有 goal_id', async () => {
      const fakeTask = { id: 'task-cb', title: '熔断', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await createTask({
        title: '熔断',
        task_type: 'dev',
        trigger_source: 'circuit_breaker',
      });
      expect(result.success).toBe(true);
    });

    it('去重 - 发现已有相同任务直接返回', async () => {
      const existing = { id: 'task-dup', title: '重复', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [existing] });

      const result = await createTask({
        title: '重复',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(true);
      expect(result.task).toEqual(existing);
      // INSERT 不应该被调用
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('竞态去重 - INSERT 返回空行时回查', async () => {
      const existing = { id: 'task-race', title: '竞态', status: 'queued' };
      // 去重查询 - 无重复
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT ON CONFLICT DO NOTHING - 0 行
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 回查 - 找到已有
      mockQuery.mockResolvedValueOnce({ rows: [existing] });

      const result = await createTask({
        title: '竞态',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(true);
      expect(result.task).toEqual(existing);
    });

    it('使用 context 作为 description 的回退', async () => {
      const fakeTask = { id: 'task-ctx', title: '上下文', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: '上下文',
        context: '旧描述字段',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      // 检查 INSERT 被调用时 description 参数是 context 值
      const insertCall = mockQuery.mock.calls[1];
      const params = insertCall[1];
      expect(params[1]).toBe('旧描述字段'); // description || context || ''
    });

    it('默认值：priority=P1, task_type=dev, trigger_source=brain_auto', async () => {
      const fakeTask = { id: 'task-def', title: '默认值', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: '默认值',
        goal_id: 'goal-1',
      });

      const insertCall = mockQuery.mock.calls[1];
      const params = insertCall[1];
      expect(params[2]).toBe('P1');          // priority
      expect(params[6]).toBe('dev');          // task_type
      expect(params[10]).toBe('brain_auto');  // trigger_source
    });

    it('payload 被 JSON.stringify', async () => {
      const fakeTask = { id: 'task-pay', title: 'payload', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const payload = { initiative_id: 'init-1', kr_goal: 'kr-1' };
      await createTask({
        title: 'payload',
        goal_id: 'goal-1',
        task_type: 'dev',
        payload,
      });

      const insertCall = mockQuery.mock.calls[1];
      const params = insertCall[1];
      expect(params[9]).toBe(JSON.stringify(payload));
    });

    it('payload 为空时传 null', async () => {
      const fakeTask = { id: 'task-np', title: '无payload', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: '无payload',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      const insertCall = mockQuery.mock.calls[1];
      const params = insertCall[1];
      expect(params[9]).toBeNull(); // payload
    });

    it('传 domain 时 SQL 包含 domain 字段，owner_role 自动推断', async () => {
      const fakeTask = { id: 'task-domain', title: 'domain任务', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: 'domain任务',
        goal_id: 'goal-1',
        task_type: 'dev',
        domain: 'coding',
      });

      const insertCall = mockQuery.mock.calls[1];
      const sql = insertCall[0];
      const params = insertCall[1];
      expect(sql).toContain('domain');
      expect(sql).toContain('owner_role');
      expect(params[11]).toBe('coding');    // domain
      expect(params[12]).toBe('cto');       // owner_role 自动推断
    });

    it('同时传 domain 和 owner_role 时使用传入的 owner_role', async () => {
      const fakeTask = { id: 'task-explicit-role', title: '显式角色', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: '显式角色',
        goal_id: 'goal-1',
        task_type: 'dev',
        domain: 'quality',
        owner_role: 'vp_qa',
      });

      const insertCall = mockQuery.mock.calls[1];
      const params = insertCall[1];
      expect(params[11]).toBe('quality');
      expect(params[12]).toBe('vp_qa');
    });

    it('不传 domain 时 domain/owner_role 均为 null', async () => {
      const fakeTask = { id: 'task-nodomain', title: '无领域', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await createTask({
        title: '无领域',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      const insertCall = mockQuery.mock.calls[1];
      const params = insertCall[1];
      expect(params[11]).toBeNull(); // domain
      expect(params[12]).toBeNull(); // owner_role
    });
  });

  // ========== createInitiative ==========
  describe('createInitiative', () => {
    it('正常创建 initiative', async () => {
      const fakeInit = { id: 'init-1', name: '测试初始化', type: 'initiative' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeInit] });

      const result = await createInitiative({
        name: '测试初始化',
        parent_id: 'proj-1',
        kr_id: 'kr-1',
      });

      expect(result.success).toBe(true);
      expect(result.initiative).toEqual(fakeInit);
    });

    it('缺少 name 返回失败', async () => {
      const result = await createInitiative({ parent_id: 'proj-1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('缺少 parent_id 返回失败', async () => {
      const result = await createInitiative({ name: '无父级' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('parent_id');
    });

    it('缺少 name 和 parent_id 返回失败', async () => {
      const result = await createInitiative({});
      expect(result.success).toBe(false);
    });

    it('orchestrated 模式设置 current_phase=plan', async () => {
      const fakeInit = { id: 'init-orch', name: '编排', type: 'initiative' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeInit] });

      await createInitiative({
        name: '编排',
        parent_id: 'proj-1',
        execution_mode: 'orchestrated',
      });

      const params = mockQuery.mock.calls[0][1];
      expect(params[6]).toBe('orchestrated'); // execution_mode
      expect(params[7]).toBe('plan');         // current_phase
    });

    it('非 orchestrated 模式 current_phase=null', async () => {
      const fakeInit = { id: 'init-std', name: '标准', type: 'initiative' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeInit] });

      await createInitiative({
        name: '标准',
        parent_id: 'proj-1',
      });

      const params = mockQuery.mock.calls[0][1];
      expect(params[6]).toBe('cecelia'); // execution_mode 默认
      expect(params[7]).toBeNull();      // current_phase
    });

    it('dod_content 被 JSON.stringify', async () => {
      const fakeInit = { id: 'init-dod', name: 'DoD', type: 'initiative' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeInit] });

      const dod = [{ item: '验收1', checked: false }];
      await createInitiative({
        name: 'DoD',
        parent_id: 'proj-1',
        dod_content: dod,
      });

      const params = mockQuery.mock.calls[0][1];
      expect(params[8]).toBe(JSON.stringify(dod));
    });

    it('默认值：decomposition_mode=known, execution_mode=cecelia', async () => {
      const fakeInit = { id: 'init-defaults', name: '默认', type: 'initiative' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeInit] });

      await createInitiative({
        name: '默认',
        parent_id: 'proj-1',
      });

      const params = mockQuery.mock.calls[0][1];
      expect(params[3]).toBe('known');   // decomposition_mode
      expect(params[6]).toBe('cecelia'); // execution_mode
    });

    it('传 domain 时 SQL 包含 domain 字段，owner_role 自动推断', async () => {
      const fakeInit = { id: 'init-domain', name: 'agent ops init', type: 'initiative' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeInit] });

      await createInitiative({
        name: 'agent ops init',
        parent_id: 'proj-1',
        domain: 'agent_ops',
      });

      const sql = mockQuery.mock.calls[0][0];
      const params = mockQuery.mock.calls[0][1];
      expect(sql).toContain('domain');
      expect(sql).toContain('owner_role');
      expect(params[9]).toBe('agent_ops');      // domain（$10 = index 9）
      expect(params[10]).toBe('vp_agent_ops');  // owner_role 自动推断
    });

    it('不传 domain 时 domain/owner_role 均为 null', async () => {
      const fakeInit = { id: 'init-nodomain', name: '无领域', type: 'initiative' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeInit] });

      await createInitiative({
        name: '无领域',
        parent_id: 'proj-1',
      });

      const params = mockQuery.mock.calls[0][1];
      expect(params[9]).toBeNull();  // domain
      expect(params[10]).toBeNull(); // owner_role
    });
  });

  // ========== createProject ==========
  describe('createProject', () => {
    it('正常创建项目（单仓库）', async () => {
      const fakeProj = { id: 'proj-1', name: '新项目', type: 'project' };
      mockQuery
        .mockResolvedValueOnce({ rows: [fakeProj] })  // INSERT projects
        .mockResolvedValueOnce({ rows: [] });          // INSERT project_repos

      const result = await createProject({
        name: '新项目',
        repo_path: '/home/xx/repo',
      });

      expect(result.success).toBe(true);
      expect(result.project).toEqual(fakeProj);
      // 应该插入 project_repos
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('缺少 name 返回失败', async () => {
      const result = await createProject({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('多仓库项目', async () => {
      const fakeProj = { id: 'proj-multi', name: '多仓库', type: 'project' };
      mockQuery
        .mockResolvedValueOnce({ rows: [fakeProj] })  // INSERT projects
        .mockResolvedValueOnce({ rows: [] })           // INSERT project_repos #1
        .mockResolvedValueOnce({ rows: [] });          // INSERT project_repos #2

      const result = await createProject({
        name: '多仓库',
        repo_paths: ['/repo1', '/repo2'],
      });

      expect(result.success).toBe(true);
      // 1 次 INSERT projects + 2 次 INSERT project_repos
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('关联 KR', async () => {
      const fakeProj = { id: 'proj-kr', name: 'KR项目', type: 'project' };
      mockQuery
        .mockResolvedValueOnce({ rows: [fakeProj] })  // INSERT projects
        .mockResolvedValueOnce({ rows: [] })           // INSERT project_kr_links #1
        .mockResolvedValueOnce({ rows: [] });          // INSERT project_kr_links #2

      const result = await createProject({
        name: 'KR项目',
        kr_ids: ['kr-1', 'kr-2'],
      });

      expect(result.success).toBe(true);
      // 1 次 INSERT projects + 0 次 project_repos (无 repo_path) + 2 次 project_kr_links
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('无仓库无KR只插入 projects 表', async () => {
      const fakeProj = { id: 'proj-min', name: '最小', type: 'project' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeProj] });

      const result = await createProject({ name: '最小' });

      expect(result.success).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('repo_paths 的第一个作为 repo_path 写入 projects 表', async () => {
      const fakeProj = { id: 'proj-rp', name: '路径回退', type: 'project' };
      mockQuery
        .mockResolvedValueOnce({ rows: [fakeProj] })
        .mockResolvedValueOnce({ rows: [] });

      await createProject({
        name: '路径回退',
        repo_paths: ['/first-repo'],
      });

      const insertProjectParams = mockQuery.mock.calls[0][1];
      expect(insertProjectParams[2]).toBe('/first-repo'); // repo_path
    });
  });

  // ========== updateTask ==========
  describe('updateTask', () => {
    it('正常更新 status', async () => {
      const fakeTask = { id: 'task-upd', status: 'completed' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await updateTask({
        task_id: 'task-upd',
        status: 'completed',
      });

      expect(result.success).toBe(true);
      expect(result.task).toEqual(fakeTask);
      expect(mockBroadcast).toHaveBeenCalledWith('task-upd');
    });

    it('正常更新 priority', async () => {
      const fakeTask = { id: 'task-pri', priority: 'P0' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await updateTask({
        task_id: 'task-pri',
        priority: 'P0',
      });

      expect(result.success).toBe(true);
    });

    it('同时更新 status 和 priority', async () => {
      const fakeTask = { id: 'task-both', status: 'completed', priority: 'P0' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await updateTask({
        task_id: 'task-both',
        status: 'completed',
        priority: 'P0',
      });

      expect(result.success).toBe(true);
    });

    it('无更新参数返回失败', async () => {
      const result = await updateTask({ task_id: 'task-empty' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No updates');
    });

    it('任务不存在返回失败', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await updateTask({
        task_id: 'task-404',
        status: 'completed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    it('in_progress 状态有原子守卫（只有 queued 可以转移）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await updateTask({
        task_id: 'task-guard',
        status: 'in_progress',
      });

      // 检查 SQL 包含 AND status = 'queued'
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain("status = 'queued'");
      expect(result.success).toBe(false);
      expect(result.error).toContain('already dispatched');
    });

    it('in_progress 转移成功', async () => {
      const fakeTask = { id: 'task-disp', status: 'in_progress' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await updateTask({
        task_id: 'task-disp',
        status: 'in_progress',
      });

      expect(result.success).toBe(true);
    });

    it('completed 状态设置 completed_at', async () => {
      const fakeTask = { id: 'task-comp', status: 'completed' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await updateTask({
        task_id: 'task-comp',
        status: 'completed',
      });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('completed_at = NOW()');
    });

    it('in_progress 状态设置 started_at', async () => {
      const fakeTask = { id: 'task-start', status: 'in_progress' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await updateTask({
        task_id: 'task-start',
        status: 'in_progress',
      });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('started_at = NOW()');
    });

    it('blocked 状态设置 blocked_at', async () => {
      const fakeTask = { id: 'task-blocked', status: 'blocked' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await updateTask({
        task_id: 'task-blocked',
        status: 'blocked',
        blocked_reason: 'CI failure',
        blocked_by: 'error:ci_failure',
      });

      const sql = mockQuery.mock.calls[0][0];
      const params = mockQuery.mock.calls[0][1];
      expect(sql).toContain('blocked_at = NOW()');
      expect(params).toContain('CI failure');
      expect(params).toContain('error:ci_failure');
      expect(result.success).toBe(true);
    });

    it('queued 状态清除 blocked 字段（解除阻塞）', async () => {
      const fakeTask = { id: 'task-unblock', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      const result = await updateTask({
        task_id: 'task-unblock',
        status: 'queued',
      });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('blocked_reason = NULL');
      expect(sql).toContain('blocked_at = NULL');
      expect(sql).toContain('blocked_by = NULL');
      expect(result.success).toBe(true);
    });

    it('blocked 状态不含 status=queued 守卫（blocked 任务可直接更新）', async () => {
      const fakeTask = { id: 'task-blocked2', status: 'blocked' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await updateTask({
        task_id: 'task-blocked2',
        status: 'blocked',
        blocked_reason: 'dependency not ready',
      });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).not.toContain("AND status = 'queued'");
    });
  });

  // ========== createGoal ==========
  describe('createGoal', () => {
    it('正常创建目标（指定 type）', async () => {
      const fakeGoal = { id: 'goal-1', title: '目标', type: 'area_okr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await createGoal({
        title: '目标',
        type: 'area_okr',
      });

      expect(result.success).toBe(true);
      expect(result.goal).toEqual(fakeGoal);
    });

    it('无 type 无 parent 默认为 mission', async () => {
      const fakeGoal = { id: 'goal-okr', title: '顶级', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '顶级' });

      const params = mockQuery.mock.calls[0][1];
      expect(params[6]).toBe('mission'); // goalType
    });

    it('有 parent_id 时自动推断 type（mission -> global_kr）', async () => {
      // 查询父级 type
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'mission' }] });
      // INSERT
      const fakeGoal = { id: 'goal-child', title: '子级', type: 'global_kr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '子级', parent_id: 'parent-1' });

      const insertParams = mockQuery.mock.calls[1][1];
      expect(insertParams[6]).toBe('global_kr');
    });

    it('有 parent_id 时自动推断 type（vision -> area_kr）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'vision' }] });
      const fakeGoal = { id: 'goal-akr', title: '区域KR', type: 'area_kr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '区域KR', parent_id: 'parent-2' });

      const insertParams = mockQuery.mock.calls[1][1];
      expect(insertParams[6]).toBe('area_kr');
    });

    it('有 parent_id 时自动推断 type（global_kr -> area_okr）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'global_kr' }] });
      const fakeGoal = { id: 'goal-aokr', title: '区域OKR', type: 'area_okr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '区域OKR', parent_id: 'parent-3' });

      const insertParams = mockQuery.mock.calls[1][1];
      expect(insertParams[6]).toBe('area_okr');
    });

    it('有 parent_id 但父级类型未知时默认 area_okr', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ type: 'area_kr' }] });
      const fakeGoal = { id: 'goal-kr', title: '默认KR', type: 'area_okr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '默认KR', parent_id: 'parent-4' });

      const insertParams = mockQuery.mock.calls[1][1];
      expect(insertParams[6]).toBe('area_okr');
    });

    it('有 parent_id 但父级不存在时默认 kr（parent 查询返回空）', async () => {
      // 父级查询返回空 - 不进入 if 分支，goalType 仍为 undefined
      // 但由于 parent_id 存在，代码不走 else if (!goalType) 分支
      // 所以 goalType 保持 undefined
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const fakeGoal = { id: 'goal-orphan', title: '孤儿', type: null };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '孤儿', parent_id: 'parent-gone' });

      // goalType 应该仍然是 undefined（parent not found, no mapping）
      const insertParams = mockQuery.mock.calls[1][1];
      expect(insertParams[6]).toBeUndefined();
    });

    it('指定 type 优先于 parent 推断', async () => {
      const fakeGoal = { id: 'goal-explicit', title: '显式', type: 'global_kr' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({
        title: '显式',
        parent_id: 'parent-5',
        type: 'global_kr',
      });

      // 不应该查询父级
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[6]).toBe('global_kr');
    });

    it('默认值：priority=P1, status=pending, progress=0', async () => {
      const fakeGoal = { id: 'goal-def', title: '默认', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '默认' });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain("'pending'");
      const params = mockQuery.mock.calls[0][1];
      expect(params[2]).toBe('P1'); // priority
    });

    it('传 domain 时 SQL 包含 domain 字段，owner_role 自动推断', async () => {
      const fakeGoal = { id: 'goal-domain', title: 'quality目标', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({
        title: 'quality目标',
        domain: 'quality',
      });

      const sql = mockQuery.mock.calls[0][0];
      const params = mockQuery.mock.calls[0][1];
      expect(sql).toContain('domain');
      expect(sql).toContain('owner_role');
      expect(params[7]).toBe('quality'); // domain（$8 = index 7）
      expect(params[8]).toBe('vp_qa');   // owner_role 自动推断
    });

    it('不传 domain 时 domain/owner_role 均为 null', async () => {
      const fakeGoal = { id: 'goal-nodomain', title: '无领域目标', type: 'mission' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      await createGoal({ title: '无领域目标' });

      const sql = mockQuery.mock.calls[0][0];
      const allParams = mockQuery.mock.calls[0][1];
      expect(sql).toContain('domain');
      expect(allParams[7]).toBeNull(); // domain
      expect(allParams[8]).toBeNull(); // owner_role
    });
  });

  // ========== updateGoal ==========
  describe('updateGoal', () => {
    it('正常更新 status', async () => {
      const fakeGoal = { id: 'goal-upd', status: 'in_progress' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await updateGoal({
        goal_id: 'goal-upd',
        status: 'in_progress',
      });

      expect(result.success).toBe(true);
      expect(result.goal).toEqual(fakeGoal);
    });

    it('正常更新 progress', async () => {
      const fakeGoal = { id: 'goal-prog', progress: 50 };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await updateGoal({
        goal_id: 'goal-prog',
        progress: 50,
      });

      expect(result.success).toBe(true);
    });

    it('progress=0 应该被接受（不被当做 falsy 跳过）', async () => {
      const fakeGoal = { id: 'goal-zero', progress: 0 };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await updateGoal({
        goal_id: 'goal-zero',
        progress: 0,
      });

      expect(result.success).toBe(true);
      // 确认 progress 参数被写入
      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain(0);
    });

    it('无更新参数返回失败', async () => {
      const result = await updateGoal({ goal_id: 'goal-empty' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No updates');
    });

    it('目标不存在返回失败', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await updateGoal({
        goal_id: 'goal-404',
        status: 'completed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Goal not found');
    });

    it('同时更新 status 和 progress', async () => {
      const fakeGoal = { id: 'goal-both', status: 'completed', progress: 100 };
      mockQuery.mockResolvedValueOnce({ rows: [fakeGoal] });

      const result = await updateGoal({
        goal_id: 'goal-both',
        status: 'completed',
        progress: 100,
      });

      expect(result.success).toBe(true);
      // SQL 应包含 updated_at = NOW()
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('updated_at = NOW()');
    });
  });

  // ========== triggerN8n ==========
  describe('triggerN8n', () => {
    it('正常触发 webhook（相对路径）', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      const result = await triggerN8n({
        webhook_path: 'test-hook',
        data: { key: 'value' },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.response).toBe('OK');

      // 检查 URL 拼接
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('/webhook/test-hook');
    });

    it('正常触发 webhook（绝对 URL）', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"result":"ok"}',
      });

      const result = await triggerN8n({
        webhook_path: 'http://custom:8080/hook',
        data: { foo: 'bar' },
      });

      expect(result.success).toBe(true);
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('http://custom:8080/hook');
    });

    it('webhook 返回非 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Error',
      });

      const result = await triggerN8n({
        webhook_path: 'failing-hook',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
    });

    it('网络错误返回失败', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await triggerN8n({
        webhook_path: 'unreachable',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('data 为空时发送空对象', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

      await triggerN8n({ webhook_path: 'empty' });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].body).toBe('{}');
    });
  });

  // ========== setMemory ==========
  describe('setMemory', () => {
    it('正常设置内存', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await setMemory({
        key: 'test_key',
        value: { foo: 'bar' },
      });

      expect(result.success).toBe(true);
      expect(result.key).toBe('test_key');
      expect(result.value).toEqual({ foo: 'bar' });
    });

    it('SQL 使用 UPSERT (ON CONFLICT DO UPDATE)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await setMemory({ key: 'k', value: 'v' });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO UPDATE');
    });

    it('传递正确的参数', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await setMemory({ key: 'my_key', value: 123 });

      const params = mockQuery.mock.calls[0][1];
      expect(params[0]).toBe('my_key');
      expect(params[1]).toBe(123);
    });
  });

  // ========== batchUpdateTasks ==========
  describe('batchUpdateTasks', () => {
    it('按 status 过滤并更新 status', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }], rowCount: 2 });

      const result = await batchUpdateTasks({
        filter: { status: 'queued' },
        update: { status: 'paused' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });

    it('按 priority 过滤并更新 priority', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c' }], rowCount: 1 });

      const result = await batchUpdateTasks({
        filter: { priority: 'P2' },
        update: { priority: 'P1' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    it('按 project_id 过滤', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await batchUpdateTasks({
        filter: { project_id: 'proj-1' },
        update: { status: 'cancelled' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it('多条件过滤', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd' }], rowCount: 1 });

      const result = await batchUpdateTasks({
        filter: { status: 'queued', priority: 'P0', project_id: 'proj-2' },
        update: { status: 'in_progress', priority: 'P1' },
      });

      expect(result.success).toBe(true);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('status =');
      expect(sql).toContain('priority =');
      expect(sql).toContain('project_id =');
    });

    it('无 update 参数返回失败', async () => {
      const result = await batchUpdateTasks({
        filter: { status: 'queued' },
        update: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No updates');
    });

    it('空过滤条件（更新所有任务）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e' }], rowCount: 5 });

      const result = await batchUpdateTasks({
        filter: {},
        update: { status: 'paused' },
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
      const sql = mockQuery.mock.calls[0][0];
      // 没有额外过滤条件，只有 1=1
      expect(sql).toContain('1=1');
    });
  });
});
