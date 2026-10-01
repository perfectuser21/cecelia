import { describe, expect, it, vi } from 'vitest';
import { createKernelRun } from '../kernel-run-store.js';

import { fixture, runId, taskId, receiptId, newReceiptId, base } from './recovery-rebase.fixture.js';

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
    expect(f.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
    expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(false);
  });

  it('显式请求不能恢复已封存或非planning，也不能夹带额外payload键', async () => {
    for (const mutate of [f => { f.input.phase = 'evaluate'; },
      f => { f.request.password = 'credential'; }, f => { f.request.sprint_dir = 'sprints/../escape'; }]) {
      const f = fixture(); mutate(f);
      await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('recovery_rebase_request_invalid');
      expect(f.calls).toHaveLength(0);
    }
  });

  it('已有非本次恢复的活run保持不变，不能冒充幂等成功', async () => {
    const f = fixture({ activeRun: { id: newReceiptId, predecessor_run_id: receiptId } });
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('recovery_rebase_active_run');
    expect(f.calls.some(c => /^\s*(INSERT|UPDATE)/.test(c.sql))).toBe(false);
  });
});
