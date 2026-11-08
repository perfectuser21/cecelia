// Canonical proposal contract; grouped without copying product implementations.
import { describe, it, expect, beforeEach } from 'vitest';
import { resetProposalMocks, mockQuery } from './helpers/proposal-fixture.js';
const { rollbackProposal, rejectProposal, getProposal, listProposals, ALLOWED_CHANGE_TYPES, ALLOWED_TASK_FIELDS, BULK_THRESHOLD } = await import('../proposal.js');
describe('proposal', () => {
  beforeEach(resetProposalMocks);
describe('getProposal', () => {
    it('找到提案时返回提案对象', async () => {
      const proposal = { id: 'p1', title: '测试', status: 'pending_review' };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] });

      const result = await getProposal('p1');
      expect(result).toEqual(proposal);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM proposals'),
        ['p1']
      );
    });

    it('未找到时返回 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getProposal('nonexistent');
      expect(result).toBeNull();
    });
  });

describe('listProposals', () => {
    it('无筛选条件时返回所有提案', async () => {
      const proposals = [
        { id: 'p1', title: '提案1' },
        { id: 'p2', title: '提案2' },
      ];
      mockQuery.mockResolvedValueOnce({ rows: proposals });

      const result = await listProposals();
      expect(result).toEqual(proposals);
      // 查询不含 WHERE，默认 limit 20
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).not.toContain('WHERE');
      expect(sql).toContain('LIMIT');
      expect(mockQuery.mock.calls[0][1]).toEqual([20]);
    });

    it('按状态筛选', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });

      await listProposals({ status: 'applied' });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('WHERE status = $1');
      expect(mockQuery.mock.calls[0][1][0]).toBe('applied');
    });

    it('自定义 limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await listProposals({ limit: 5 });
      const params = mockQuery.mock.calls[0][1];
      expect(params[params.length - 1]).toBe(5);
    });

    it('同时指定 status 和 limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await listProposals({ status: 'pending_review', limit: 10 });
      expect(mockQuery.mock.calls[0][1]).toEqual(['pending_review', 10]);
    });

    it('无参数调用使用默认值', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await listProposals();
      expect(mockQuery.mock.calls[0][1]).toEqual([20]);
    });
  });

describe('rollbackProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(rollbackProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能回滚非 applied 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'pending_review' }],
      });

      await expect(rollbackProposal('p1')).rejects.toThrow('Cannot rollback proposal in status "pending_review"');
    });

    it('成功回滚带任务快照的提案', async () => {
      const proposal = {
        id: 'p1',
        status: 'applied',
        snapshot: {
          tasks: {
            't1': { priority: 'P1', status: 'queued', payload: {} },
          },
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE task (restore)
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals (rolled_back)

      const result = await rollbackProposal('p1');
      expect(result.status).toBe('rolled_back');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].task_id).toBe('t1');
      expect(result.results[0].restored).toBe(true);
    });

    it('回滚带 focus 快照的提案（恢复到非 null focus）', async () => {
      const proposal = {
        id: 'p2',
        status: 'applied',
        snapshot: {
          tasks: {},
          focus: { objective_id: 'old-obj' },
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPSERT working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p2');
      expect(result.status).toBe('rolled_back');
      expect(result.results).toContainEqual({ focus: 'restored' });
    });

    it('回滚带 focus 快照的提案（恢复到 null — 删除 focus）', async () => {
      const proposal = {
        id: 'p3',
        status: 'applied',
        snapshot: {
          tasks: {},
          focus: null,
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p3');
      expect(result.results).toContainEqual({ focus: 'restored' });
      // 检查 DELETE 语句
      const deleteCall = mockQuery.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE FROM working_memory');
    });

    it('回滚时删除 create_task 创建的任务', async () => {
      const proposal = {
        id: 'p4',
        status: 'applied',
        snapshot: { tasks: {} },
        changes: [
          { type: 'create_task', title: '任务' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'created-t1' }] }); // 查找 proposal 创建的任务
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'created-t1' }], rowCount: 1 }); // actual DELETE RETURNING
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p4');
      expect(result.results).toContainEqual({ task_id: 'created-t1', deleted: true });
    });

    it('任务恢复失败时记录错误', async () => {
      const proposal = {
        id: 'p5',
        status: 'applied',
        snapshot: {
          tasks: {
            't1': { priority: 'P1', status: 'queued', payload: {} },
          },
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockRejectedValueOnce(new Error('恢复失败')); // UPDATE task 失败
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p5');
      expect(result.results[0].restored).toBe(false);
      expect(result.results[0].error).toBe('恢复失败');
    });

    it('空快照时正常回滚', async () => {
      const proposal = {
        id: 'p6',
        status: 'applied',
        snapshot: null,
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p6');
      expect(result.status).toBe('rolled_back');
      expect(result.results).toHaveLength(0);
    });
  });

describe('rejectProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(rejectProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能拒绝已 applied 的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'applied' }],
      });

      await expect(rejectProposal('p1')).rejects.toThrow('Cannot reject proposal in status "applied"');
    });

    it('成功拒绝 pending_review 提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'pending_review' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

      const result = await rejectProposal('p1', '不符合要求');
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('不符合要求');
      expect(result.proposal_id).toBe('p1');
    });

    it('成功拒绝 draft 提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p2', status: 'draft' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await rejectProposal('p2');
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe(''); // 默认空原因
    });

    it('不能拒绝已 rolled_back 的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p3', status: 'rolled_back' }],
      });

      await expect(rejectProposal('p3')).rejects.toThrow('Cannot reject proposal');
    });
  });

describe('常量导出', () => {
    it('ALLOWED_CHANGE_TYPES 包含所有预期类型', () => {
      const expected = ['create_task', 'update_task', 'set_focus', 'add_dependency', 'remove_dependency', 'split_task', 'merge_tasks'];
      for (const t of expected) {
        expect(ALLOWED_CHANGE_TYPES.has(t)).toBe(true);
      }
      expect(ALLOWED_CHANGE_TYPES.size).toBe(7);
    });

    it('ALLOWED_CHANGE_TYPES 不包含危险类型', () => {
      expect(ALLOWED_CHANGE_TYPES.has('drop_table')).toBe(false);
      expect(ALLOWED_CHANGE_TYPES.has('delete_all')).toBe(false);
      expect(ALLOWED_CHANGE_TYPES.has('delete_database')).toBe(false);
    });

    it('ALLOWED_TASK_FIELDS 包含所有允许的字段', () => {
      const expected = ['priority', 'next_run_at', 'scheduled_for', 'title', 'description', 'goal_id', 'project_id', 'task_type', 'status'];
      for (const f of expected) {
        expect(ALLOWED_TASK_FIELDS.has(f)).toBe(true);
      }
      expect(ALLOWED_TASK_FIELDS.size).toBe(9);
    });

    it('ALLOWED_TASK_FIELDS 不包含敏感字段', () => {
      expect(ALLOWED_TASK_FIELDS.has('payload')).toBe(false);
      expect(ALLOWED_TASK_FIELDS.has('id')).toBe(false);
      expect(ALLOWED_TASK_FIELDS.has('created_at')).toBe(false);
    });

    it('BULK_THRESHOLD 等于 5', () => {
      expect(BULK_THRESHOLD).toBe(5);
    });
  });
});
