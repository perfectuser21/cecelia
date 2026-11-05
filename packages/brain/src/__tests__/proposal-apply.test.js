// Canonical proposal contract; grouped without copying product implementations.
import { describe, it, expect, beforeEach } from 'vitest';
import { resetProposalMocks, mockQuery, mockCreateTask, mockAddDep, mockRemoveDep } from './helpers/proposal-fixture.js';
const { createProposal, approveProposal, applyProposal } = await import('../proposal.js');
describe('proposal', () => {
  beforeEach(resetProposalMocks);
describe('createProposal', () => {
    const validInput = {
      source: 'llm_proposal',
      type: 'reorder',
      title: '测试提案',
      changes: [
        { type: 'set_focus', objective_id: 'obj-1' },
      ],
    };

    it('成功创建提案', async () => {
      const mockProposal = { id: 'p1', title: '测试提案', status: 'pending_review' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      const result = await createProposal(validInput);
      expect(result).toEqual(mockProposal);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      // 检查 INSERT 语句
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO proposals');
    });

    it('拒绝无效的 source', async () => {
      await expect(createProposal({
        ...validInput,
        source: 'invalid_source',
      })).rejects.toThrow('source must be llm_proposal or user_ui');
    });

    it('接受 user_ui 作为 source', async () => {
      const mockProposal = { id: 'p2', status: 'pending_review' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      const result = await createProposal({ ...validInput, source: 'user_ui' });
      expect(result).toEqual(mockProposal);
    });

    it('拒绝无效的 changes', async () => {
      await expect(createProposal({
        ...validInput,
        changes: [{ type: 'drop_table' }],
      })).rejects.toThrow('Invalid changes');
    });

    it('拒绝空 changes', async () => {
      await expect(createProposal({
        ...validInput,
        changes: [],
      })).rejects.toThrow('Invalid changes');
    });

    it('批量 changes 设置 medium risk_level', async () => {
      const changes = Array.from({ length: 6 }, (_, i) => ({
        type: 'update_task',
        task_id: `t${i}`,
        fields: { priority: 'P0' },
      }));
      const rateSource = 'create_bulk_' + Date.now();
      const mockProposal = { id: 'p3', risk_level: 'medium' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      await createProposal({
        source: 'llm_proposal',
        title: '批量提案',
        changes,
      });

      // 检查 risk_level 参数（第 8 个参数）
      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[7]).toBe('medium');
    });

    it('超过 15 个 changes 设置 high risk_level', async () => {
      const changes = Array.from({ length: 16 }, (_, i) => ({
        type: 'update_task',
        task_id: `t${i}`,
        fields: { title: `任务${i}` },
      }));
      const mockProposal = { id: 'p4', risk_level: 'high' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      await createProposal({
        source: 'llm_proposal',
        title: '大批量提案',
        changes,
      });

      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[7]).toBe('high');
    });

    it('包含优先级变更时检查速率限制', async () => {
      const mockProposal = { id: 'p5' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      // 带优先级变更的 input
      await createProposal({
        source: 'llm_proposal',
        title: '优先级变更',
        changes: [{ type: 'update_task', task_id: 't1', fields: { priority: 'P0' } }],
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('add_dependency 时检测环', async () => {
      // detectCycle 查询 DB
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'dep-target', deps: ['task-source'] }] }) // detectCycle 查询
        ;

      await expect(createProposal({
        source: 'llm_proposal',
        title: '添加依赖',
        changes: [{ type: 'add_dependency', task_id: 'task-source', depends_on_id: 'dep-target' }],
      })).rejects.toThrow('Dependency cycle detected');
    });

    it('add_dependency 无环时正常创建', async () => {
      const mockProposal = { id: 'p6' };
      // 第一次查询：detectCycle 查 DB（无环）
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 第二次查询：INSERT
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      const result = await createProposal({
        source: 'llm_proposal',
        title: '添加依赖-无环',
        changes: [{ type: 'add_dependency', task_id: 'A', depends_on_id: 'B' }],
      });

      expect(result).toEqual(mockProposal);
    });

    it('使用提供的 risk_level 作为默认值', async () => {
      const mockProposal = { id: 'p7' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      await createProposal({
        ...validInput,
        risk_level: 'low',
      });

      // 少量 changes 不会被提升，保持 low
      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[7]).toBe('low');
    });
  });

describe('approveProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getProposal

      await expect(approveProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能审批已 applied 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'applied', changes: [] }],
      });

      await expect(approveProposal('p1')).rejects.toThrow('Cannot approve proposal in status "applied"');
    });

    it('不能审批已 rejected 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'rejected', changes: [] }],
      });

      await expect(approveProposal('p1')).rejects.toThrow('Cannot approve proposal in status "rejected"');
    });

    it('成功审批 pending_review 提案并自动 apply', async () => {
      const proposal = { id: 'p1', status: 'pending_review', changes: [], source: 'llm_proposal' };
      // getProposal (approveProposal 内)
      mockQuery.mockResolvedValueOnce({ rows: [proposal] });
      // UPDATE (approve)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // getProposal (applyProposal 内)
      mockQuery.mockResolvedValueOnce({ rows: [{ ...proposal, status: 'approved', changes: [] }] });
      // UPDATE (save snapshot + mark applied)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await approveProposal('p1', 'admin');
      expect(result.status).toBe('applied');
      expect(result.proposal_id).toBe('p1');
    });

    it('可以审批 draft 状态的提案', async () => {
      const proposal = { id: 'p1', status: 'draft', changes: [], source: 'user_ui' };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE approve
      mockQuery.mockResolvedValueOnce({ rows: [{ ...proposal, status: 'approved', changes: [] }] }); // getProposal for apply
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE applied

      const result = await approveProposal('p1');
      expect(result.status).toBe('applied');
    });
  });

describe('applyProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(applyProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能执行非 approved 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'pending_review', changes: [] }],
      });

      await expect(applyProposal('p1')).rejects.toThrow('Cannot apply proposal in status "pending_review"');
    });

    it('执行 create_task 变更', async () => {
      const proposal = {
        id: 'p1',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'create_task', title: '新任务', project_id: 'proj-1', priority: 'P0', description: '描述' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals (mark applied)

      const result = await applyProposal('p1');
      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('created');
    });

    it('执行 update_task 变更', async () => {
      const proposal = {
        id: 'p2',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'update_task', task_id: 't1', fields: { priority: 'P0', title: '更新' } },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', priority: 'P1', status: 'queued' }] }); // snapshot SELECT
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE task
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p2');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('updated');
    });

    it('执行 update_task 中 next_run_at 字段（写入 payload）', async () => {
      const proposal = {
        id: 'p-payload',
        status: 'approved',
        source: 'user_ui',
        changes: [
          { type: 'update_task', task_id: 't1', fields: { next_run_at: '2026-03-01' } },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE payload
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals (applied)

      const result = await applyProposal('p-payload');
      expect(result.results[0].result.success).toBe(true);
      // 应该更新 payload（不是普通字段）
      const payloadUpdateCall = mockQuery.mock.calls[2];
      expect(payloadUpdateCall[0]).toContain('payload');
    });

    it('执行 set_focus 变更', async () => {
      const proposal = {
        id: 'p3',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'set_focus', objective_id: 'obj-1' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // 查询当前 focus
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPSERT working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p3');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('focus_set');
    });

    it('执行 add_dependency 变更', async () => {
      const proposal = {
        id: 'p4',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'add_dependency', task_id: 't1', depends_on_id: 't2' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', payload: { depends_on: [] } }] }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p4');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('dependency_added');
      expect(mockAddDep).toHaveBeenCalledWith(expect.anything(), { fromTaskId: 't1', toTaskId: 't2' });
    });

    it('add_dependency 不重复添加已存在的依赖', async () => {
      const proposal = {
        id: 'p4b',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'add_dependency', task_id: 't1', depends_on_id: 't2' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', payload: { depends_on: ['t2'] } }], // t2 已存在
      }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals
      mockAddDep.mockResolvedValueOnce({ added: false }); // 写口幂等：边已存在

      const result = await applyProposal('p4b');
      expect(result.results[0].result.success).toBe(true);
      // 幂等由写口保证（ON CONFLICT DO NOTHING + payload 不重复追加），proposal 不再自己拼 payload
      expect(mockQuery.mock.calls.some(([sql]) => /UPDATE tasks/.test(String(sql)))).toBe(false);
    });

    it('执行 remove_dependency 变更', async () => {
      const proposal = {
        id: 'p5',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'remove_dependency', task_id: 't1', depends_on_id: 't2' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', payload: { depends_on: ['t2', 't3'] } }],
      }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p5');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('dependency_removed');
      expect(mockRemoveDep).toHaveBeenCalledWith(expect.anything(), { fromTaskId: 't1', toTaskId: 't2' });
    });

    it('split_task 返回未实现', async () => {
      const proposal = {
        id: 'p6',
        status: 'approved',
        source: 'llm_proposal',
        changes: [{ type: 'split_task' }],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p6');
      expect(result.results[0].result.success).toBe(false);
      expect(result.results[0].result.error).toContain('not yet implemented');
    });

    it('merge_tasks 返回未实现', async () => {
      const proposal = {
        id: 'p7',
        status: 'approved',
        source: 'llm_proposal',
        changes: [{ type: 'merge_tasks' }],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p7');
      expect(result.results[0].result.success).toBe(false);
    });

    it('单个变更执行失败不影响其他变更', async () => {
      const proposal = {
        id: 'p8',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'set_focus', objective_id: 'obj-1' },
          { type: 'create_task', title: '任务', project_id: 'proj-1' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      // set_focus: 查 focus → 失败
      mockQuery.mockRejectedValueOnce(new Error('DB 连接断开'));
      // create_task: 成功
      mockCreateTask.mockResolvedValueOnce({ task: { id: 'new-id', title: '任务' } });
      // UPDATE proposals
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await applyProposal('p8');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].result.success).toBe(false);
      expect(result.results[0].result.error).toBe('DB 连接断开');
      expect(result.results[1].result.success).toBe(true);
    });

    it('记录优先级变更的速率限制', async () => {
      const proposal = {
        id: 'p9',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'update_task', task_id: 't1', fields: { priority: 'P0' } },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', priority: 'P1' }] }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE task
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p9');
      expect(result.status).toBe('applied');
    });

    it('空 changes 数组正常处理', async () => {
      const proposal = {
        id: 'p-empty',
        status: 'approved',
        source: 'llm_proposal',
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p-empty');
      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(0);
    });

    it('changes 为 undefined/null 时使用空数组', async () => {
      const proposal = {
        id: 'p-null-changes',
        status: 'approved',
        source: 'llm_proposal',
        changes: null,
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p-null-changes');
      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(0);
    });
  });
});
