import { beforeEach, describe, it, expect, vi } from 'vitest';
const b = vi.hoisted(() => ({
  query: vi.fn(),
  events: [],
  count: 0,
  observed: 'in_progress',
  readError: false,
  restoreError: false,
  proposal: null
}));
vi.mock('../db.js', () => ({
  default: {
    query: b.query
  }
}));
vi.mock('../actions.js', () => ({
  createTask: () => {
    throw Error('receipt tests forbid creation');
  }
}));
vi.mock('../lib/task-dependencies.js', () => ({
  addTaskDependency: () => {
    throw Error('no dependency writes');
  },
  removeTaskDependency: () => {
    throw Error('no dependency writes');
  }
}));
import { rollbackProposal } from '../proposal.js';
const PID = 'c1000000-0000-4000-8000-000000000001',
  TID = 'd1000000-0000-4000-8000-000000000001';
beforeEach(() => {
  b.events = [];
  b.count = 0;
  b.observed = 'in_progress';
  b.readError = false;
  b.restoreError = false;
  b.proposal = {
    id: PID,
    status: 'applied',
    snapshot: {
      tasks: {}
    },
    changes: [{
      type: 'create_task',
      title: 'owned'
    }]
  };
  b.query.mockReset().mockImplementation(async (sql, params) => {
    const q = sql.trim().replace(/\s+/g, ' ');
    b.events.push({
      sql: q,
      params
    });
    if (q === 'SELECT * FROM proposals WHERE id = $1') return {
      rows: [b.proposal],
      rowCount: 1
    };
    if (q === "SELECT id FROM tasks WHERE payload->>'proposal_id' = $1") return {
      rows: [{
        id: TID
      }],
      rowCount: 1
    };
    if (q.startsWith('DELETE FROM tasks WHERE id = $1')) return {
      rows: b.count === 1 && q.includes('RETURNING') ? [{
        id: TID
      }] : [],
      rowCount: b.count
    };
    if (q === 'SELECT status FROM tasks WHERE id = $1') {
      if (b.readError) throw Error('owned status read failure');
      return {
        rows: b.observed === null ? [] : [{
          status: b.observed
        }],
        rowCount: b.observed === null ? 0 : 1
      };
    }
    if (q.startsWith('UPDATE tasks SET')) {
      if (b.restoreError) throw Error('owned restore failure');
      return {
        rows: [],
        rowCount: 1
      };
    }
    if (q.startsWith("UPDATE proposals SET status = 'rolled_back'")) return {
      rows: [],
      rowCount: 1
    };
    throw Error('unexpected receipt SQL: ' + q);
  });
});
function deletionSQL() {
  return b.events.find(e => e.sql.startsWith('DELETE FROM tasks'));
}
describe('真实rollbackProposal删除回执', () => {
  it('queued实际删除一行才报deleted:true，保旧成功封套', async () => {
    b.count = 1;
    b.observed = null;
    const result = await rollbackProposal(PID);
    expect(result).toEqual({
      proposal_id: PID,
      status: 'rolled_back',
      results: [{
        task_id: TID,
        deleted: true
      }]
    });
    expect(deletionSQL()).toEqual({
      sql: "DELETE FROM tasks WHERE id = $1 AND status = 'queued' RETURNING id",
      params: [TID]
    });
    expect(b.events.some(e => e.sql === 'SELECT status FROM tasks WHERE id = $1')).toBe(false);
  });
  it.each(['in_progress', 'completed'])('%s零行删除必须明确未删及当前状态', async status => {
    b.observed = status;
    const result = await rollbackProposal(PID);
    expect(result.results).toContainEqual({
      task_id: TID,
      deleted: false,
      status,
      reason: 'not_queued'
    });
    expect(result.partial).toBe(true);
    expect(result.warnings).toContainEqual({
      kind: 'task_not_deleted',
      task_id: TID,
      status,
      reason: 'not_queued'
    });
    expect(deletionSQL()).toEqual({
      sql: "DELETE FROM tasks WHERE id = $1 AND status = 'queued' RETURNING id",
      params: [TID]
    });
    expect(b.events.at(-1).sql).toContain("status = 'rolled_back'");
  });
  it('并发消失只能报告删除尝试后不存在，不能冒领删除成功', async () => {
    b.observed = null;
    const result = await rollbackProposal(PID);
    expect(result.results).toContainEqual({
      task_id: TID,
      deleted: false,
      status: null,
      reason: 'not_found_after_delete_attempt'
    });
    expect(result.partial).toBe(true);
  });
  it('零行后再次观察queued仍保守未删，不推断曾删除', async () => {
    b.observed = 'queued';
    const result = await rollbackProposal(PID);
    expect(result.results).toContainEqual({
      task_id: TID,
      deleted: false,
      status: 'queued',
      reason: 'not_deleted'
    });
  });
  it('缺少rowCount失败关闭，不能把未知效果当成功', async () => {
    b.count = undefined;
    const result = await rollbackProposal(PID);
    expect(result.results).toContainEqual({
      task_id: TID,
      deleted: false,
      status: 'in_progress',
      reason: 'delete_result_unknown'
    });
    expect(result.partial).toBe(true);
  });
  it('未删后的状态读失败保持明确未知，不改变删除资格', async () => {
    b.readError = true;
    const result = await rollbackProposal(PID);
    expect(result.results).toContainEqual({
      task_id: TID,
      deleted: false,
      status: null,
      reason: 'status_read_failed'
    });
    expect(result.partial).toBe(true);
  });
  it('保留已有best-effort恢复错误并明确partial，不虚称全量成功', async () => {
    b.proposal.changes = [];
    b.proposal.snapshot.tasks = {
      [TID]: {
        priority: 'P1',
        status: 'queued',
        payload: {}
      }
    };
    b.restoreError = true;
    const result = await rollbackProposal(PID);
    expect(result.status).toBe('rolled_back');
    expect(result.results).toEqual([{
      task_id: TID,
      restored: false,
      error: 'owned restore failure'
    }]);
    expect(result.partial).toBe(true);
    expect(result.warnings).toContainEqual({
      kind: 'task_restore_failed',
      task_id: TID
    });
  });
});
