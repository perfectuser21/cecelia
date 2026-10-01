import { describe, expect, it, vi } from 'vitest';
import { createKernelRun } from '../kernel-run-store.js';

const taskId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const receiptId = '33333333-3333-4333-8333-333333333333';
const newReceiptId = '44444444-4444-4444-8444-444444444444';
const oldBase = 'a'.repeat(40);
const base = 'b'.repeat(40);
const head = 'c'.repeat(40);

function fixture({ activeRun = null, predecessorTask = taskId } = {}) {
  const calls = [];
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM tasks.*|FROM tasks\s/s.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ id: taskId, task_type: 'harness_initiative', status: 'failed',
          payload: { routing_receipt_id: receiptId, branch: 'cp-recovery', base_sha: oldBase }, metadata: {} }] };
      }
      if (/FROM initiative_runs predecessor/.test(sql)) {
        return { rows: [{ id: runId, initiative_id: taskId, current_task_id: predecessorTask,
          phase: 'failed', record_trust_status: 'trusted', contract_id: null }] };
      }
      if (/FROM initiative_runs/.test(sql)) return { rows: activeRun ? [activeRun] : [] };
      if (/FROM work_routing_receipts receipt/.test(sql)) {
        return { rows: [{ id: receiptId, task_id: taskId, work_kind: 'coding_mutation',
          pipeline: 'harness', canonical_task_type: 'harness_initiative', change_kind: 'capability_change',
          impact_contract_required: true, repo: 'cecelia', map_scope: ['MJ5'],
          evidence: { branch: 'cp-recovery', base_sha: oldBase }, anchor_generation: 1,
          map_scope_validation_version: 'active-business-node-v1' }] };
      }
      if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: newReceiptId }] };
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [{ id: '55555555-5555-4555-8555-555555555555', phase: 'planning',
          predecessor_run_id: runId, controller_session_id: params.at(-2), controller_generation: 1 }] };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  const request = { expected_receipt_id: receiptId, base_sha: base, head_sha: head,
    actor: 'session:recovery-operator', reason: '租约过期后已重新同步分支', sprint_dir: 'sprints' };
  const input = { taskId, initiativeId: taskId, phase: 'planning', host: 'foreground',
    deadlineHours: 6, createdSource: 'explicit_recovery', predecessorRunId: runId, recoveryRebase: request };
  const map = { freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: base } } },
    manifest_version_id: 'manifest', projection_run_id: 'projection' };
  const deps = {
    recoveryRebaseDeps: { readMap: async () => map, resolveScopeKey: async () => 'cecelia',
      lockMapProjectionAuthority: async () => ({}), resolveBranchHead: async () => head,
      resolveCommitDiff: async () => ({ isAncestor: true, changedFiles: [] }) },
    ensureMapImpactPreflight: vi.fn(async (_client, { task, receipt }) => {
      expect(task.payload.base_sha).toBe(base);
      expect(receipt.evidence.base_sha).toBe(base);
      return { contract: { id: '66666666-6666-4666-8666-666666666666', status: 'active' } };
    }),
  };
  return { pool: { connect: async () => client }, input, deps, calls, request };
}

describe('未封存失败任务的受控再基恢复', () => {
  it('同任务追加新收据并重新签发controller；旧run和旧收据保持不变', async () => {
    const f = fixture();
    const result = await createKernelRun(f.pool, f.input, f.deps);
    expect(result.created).toBe(true);
    expect(result.run.predecessor_run_id).toBe(runId);
    expect(result.run.phase).toBe('planning');
    expect(result.run.controller_session_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(f.calls.filter(c => /INSERT INTO work_routing_receipts/.test(c.sql))).toHaveLength(1);
    expect(f.calls.some(c => /UPDATE (initiative_runs|work_routing_receipts)/.test(c.sql))).toBe(false);
    expect(f.calls.some(c => /INSERT INTO task_events/.test(c.sql))).toBe(true);
    expect(f.calls.some(c => /INSERT INTO cecelia_events/.test(c.sql))).toBe(true);
    expect(f.calls.at(-1).sql).toBe('COMMIT');
  });

  it('没有显式再基请求的未封存前任仍拒绝', async () => {
    const f = fixture(); delete f.input.recoveryRebase;
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('explicit recovery predecessor is invalid');
    expect(f.calls.at(-1).sql).toBe('ROLLBACK');
  });

  it('拒绝另一任务的前任，不产生接班收据', async () => {
    const f = fixture({ predecessorTask: receiptId });
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('explicit recovery predecessor is invalid');
    expect(f.calls.some(c => /INSERT INTO work_routing_receipts/.test(c.sql))).toBe(false);
  });

  it('候选head必须是同分支实际head且包含新base', async () => {
    const f = fixture(); f.deps.recoveryRebaseDeps.resolveCommitDiff = async () => ({ isAncestor: false });
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('recovery_rebase_lineage_invalid');
    expect(f.calls.some(c => /INSERT INTO work_routing_receipts/.test(c.sql))).toBe(false);
  });

  it('旧收据期望不匹配时不恢复', async () => {
    const f = fixture(); f.request.expected_receipt_id = newReceiptId;
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('recovery_rebase_receipt_changed');
  });

  it('正常preflight失败使新增收据和恢复操作同事务回滚', async () => {
    const f = fixture(); f.deps.ensureMapImpactPreflight = async () => { throw new Error('map_projection_changed'); };
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('map_projection_changed');
    expect(f.calls.some(c => /INSERT INTO work_routing_receipts/.test(c.sql))).toBe(true);
    expect(f.calls.at(-1).sql).toBe('ROLLBACK');
  });
});
