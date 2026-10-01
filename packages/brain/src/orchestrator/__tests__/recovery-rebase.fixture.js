import { expect, vi } from 'vitest';

export const taskId = '11111111-1111-4111-8111-111111111111';
export const runId = '22222222-2222-4222-8222-222222222222';
export const receiptId = '33333333-3333-4333-8333-333333333333';
export const newReceiptId = '44444444-4444-4444-8444-444444444444';
const oldBase = 'a'.repeat(40);
export const base = 'b'.repeat(40);
const head = 'c'.repeat(40);

export function fixture({ activeRun = null, predecessorTask = taskId } = {}) {
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
      if (/ORDER BY started_at DESC,id DESC LIMIT 1/.test(sql)) return { rows: [{ id: runId }] };
      if (/FROM work_routing_receipts receipt/.test(sql)) {
        return { rows: [{ id: receiptId, task_id: taskId, work_kind: 'coding_mutation',
          pipeline: 'harness', canonical_task_type: 'harness_initiative', change_kind: 'capability_change',
          impact_contract_required: true, repo: 'cecelia', map_scope: ['MJ5'],
          evidence: { branch: 'cp-recovery', base_sha: oldBase }, anchor_generation: 1,
          map_scope_validation_version: 'active-business-node-v1' }] };
      }
      if (/FROM initiative_runs/.test(sql)) return { rows: activeRun ? [activeRun] : [] };
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

