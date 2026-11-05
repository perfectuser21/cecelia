import { describe, it, expect, vi } from 'vitest';
import { mockQuery, mockCreateRoutedTask, mockBroadcast, createTask } from './fixture.js';

export function registerCreateTask() {
describe('createTask', () => {
    it('正常创建任务（含 goal_id）', async () => {
      const fakeTask = { id: 'task-1', title: '测试任务', status: 'queued' };
      // 去重查询 - 无重复
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // record-only writer result
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

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

    it.each([
      'scope_plan', 'initiative_plan', 'project_plan',
      'okr_scope_plan', 'okr_initiative_plan', 'okr_project_plan',
    ])('task_type=%s（层已退役，决策 ee4842a6）→ 立即返回 layer_retired，不查库', async (task_type) => {
      const result = await createTask({ title: `退役类型 ${task_type}`, task_type, goal_id: 'goal-1' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('layer_retired');
      expect(result.decision).toBe('ee4842a6');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('系统任务（task_type=research）可以没有 goal_id', async () => {
      const fakeTask = { id: 'task-r', title: '研究', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      const result = await createTask({
        title: '研究',
        task_type: 'research',
      });

      expect(result.success).toBe(true);
    });

    it('系统触发源（trigger_source=manual）可以没有 goal_id', async () => {
      const fakeTask = { id: 'task-m', title: '手动', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

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
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

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
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

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
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

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
      // 去重在writer委托前返回，不额外查询
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('统一 writer 自己承担竞态幂等，不在 actions 二次写 tasks', async () => {
      const existing = { id: 'task-race', title: '竞态', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: existing, deduplicated: true });

      const result = await createTask({
        title: '竞态',
        goal_id: 'goal-1',
        task_type: 'research',
      });

      expect(result.success).toBe(true);
      expect(result.task).toEqual(existing);
      expect(mockCreateRoutedTask).toHaveBeenCalledOnce();
      expect(mockQuery).toHaveBeenCalledOnce();
    });

    it('explicit routing identity bypasses legacy title dedup and always receives a receipt', async () => {
      mockCreateRoutedTask.mockResolvedValueOnce({
        task: { id: 'task-routed', title: 'same title', status: 'queued' },
      });

      const result = await createTask({
        source: 'scheduler',
        source_id: 'scheduler:job:1',
        title: 'same title',
        task_type: 'research',
      });

      expect(result.task.id).toBe('task-routed');
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockCreateRoutedTask).toHaveBeenCalledOnce();
    });

    it('injected Pool keeps routed task and receipt in an owned transaction', async () => {
      const injectedPool = {
        connect: vi.fn(),
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      mockCreateRoutedTask.mockResolvedValueOnce({
        task: { id: 'task-pool', title: 'pool task', status: 'queued' },
      });

      await createTask({
        db: injectedPool,
        title: 'pool task',
        task_type: 'research',
      });

      expect(mockCreateRoutedTask).toHaveBeenCalledWith(
        injectedPool,
        expect.any(Object),
        null,
        {},
      );
    });

    it('injected transaction Client reuses the caller transaction', async () => {
      const injectedClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      mockCreateRoutedTask.mockResolvedValueOnce({
        task: { id: 'task-client', title: 'client task', status: 'queued' },
      });

      await createTask({
        db: injectedClient,
        title: 'client task',
        task_type: 'research',
      });

      expect(mockCreateRoutedTask).toHaveBeenCalledWith(
        injectedClient,
        expect.any(Object),
        null,
        { transaction: 'existing' },
      );
    });

    it('preserves scheduler metadata at the routed task boundary', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({
        task: { id: 'task-meta', title: 'metadata task', status: 'queued' },
      });

      await createTask({
        title: 'metadata task',
        task_type: 'research',
        created_by: 'scheduler-a',
        dept: 'agent_ops',
        phase: 'review',
        executor_kind: 'system',
        location: 'cn',
        status: 'blocked',
        area_id: 'area-1',
        okr_initiative_id: 'initiative-1',
        ability_id: 'ability-1',
        blocked_at: '2026-08-13T00:00:00.000Z',
      });

      expect(mockCreateRoutedTask).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          task: expect.objectContaining({
            created_by: 'scheduler-a',
            dept: 'agent_ops',
            phase: 'review',
            executor_kind: 'system',
            location: 'cn',
            status: 'blocked',
            area_id: 'area-1',
            okr_initiative_id: 'initiative-1',
            ability_id: 'ability-1',
            blocked_at: '2026-08-13T00:00:00.000Z',
          }),
        }),
        null,
        expect.anything(),
      );
    });

    it('使用 context 作为 description 的回退', async () => {
      const fakeTask = { id: 'task-ctx', title: '上下文', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      await createTask({
        title: '上下文',
        context: '旧描述字段',
        goal_id: 'goal-1',
        task_type: 'dev',
      });
      const request = mockCreateRoutedTask.mock.calls[0][1];
      expect(request.description).toBe('旧描述字段'); // description || context || ''
    });

    it('默认值：priority=P1, task_type=dev, trigger_source=brain_auto', async () => {
      const fakeTask = { id: 'task-def', title: '默认值', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      await createTask({
        title: '默认值',
        goal_id: 'goal-1',
      });

      const request = mockCreateRoutedTask.mock.calls[0][1];
      expect(request.task.priority).toBe('P1');          // priority
      expect(request.requested_task_type).toBe('dev');          // task_type
      expect(request.task.trigger_source).toBe('brain_auto');  // trigger_source
    });

    it('payload 原样作为writer metadata委托', async () => {
      const fakeTask = { id: 'task-pay', title: 'payload', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      const payload = { initiative_id: 'init-1', kr_goal: 'kr-1' };
      await createTask({
        title: 'payload',
        goal_id: 'goal-1',
        task_type: 'dev',
        payload,
      });

      const request = mockCreateRoutedTask.mock.calls[0][1];
      expect(request.metadata).toEqual(payload);
    });

    it('payload 为空时委托空metadata', async () => {
      const fakeTask = { id: 'task-np', title: '无payload', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      await createTask({
        title: '无payload',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      const request = mockCreateRoutedTask.mock.calls[0][1];
      expect(request.metadata).toEqual({}); // metadata
    });

    it('domain与自动owner_role委托真实writer边界', async () => {
      const fakeTask = { id: 'task-domain', title: 'domain任务', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      await createTask({
        title: 'domain任务',
        goal_id: 'goal-1',
        task_type: 'dev',
        domain: 'coding',
      });

      const request = mockCreateRoutedTask.mock.calls[0][1];
      expect(request.task.domain).toBe('coding');    // domain
      expect(request.task.owner_role).toBe('cto');       // owner_role 自动推断
      expect(request.task.delivery_type).toBe('code-only'); // delivery_type default
    });

    it('同时传 domain 和 owner_role 时使用传入的 owner_role', async () => {
      const fakeTask = { id: 'task-explicit-role', title: '显式角色', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      await createTask({
        title: '显式角色',
        goal_id: 'goal-1',
        task_type: 'dev',
        domain: 'quality',
        owner_role: 'vp_qa',
      });

      const request = mockCreateRoutedTask.mock.calls[0][1];
      expect(request.task.domain).toBe('quality');
      expect(request.task.owner_role).toBe('vp_qa');
      expect(request.task.delivery_type).toBe('code-only'); // delivery_type default
    });

    it('无匹配关键词时domain与owner_role为null并保留delivery缺省', async () => {
      const fakeTask = { id: 'task-nodomain', title: '无领域', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateRoutedTask.mockResolvedValueOnce({ task: fakeTask });

      await createTask({
        title: '无领域',
        goal_id: 'goal-1',
        task_type: 'dev',
      });

      const request = mockCreateRoutedTask.mock.calls[0][1];
      expect(request.task.owner_role).toBeNull();
      expect(request.task.domain).toBeNull(); // domain is null when undetected
      expect(request.task.delivery_type).toBe('code-only'); // delivery_type default
    });
  });
}
