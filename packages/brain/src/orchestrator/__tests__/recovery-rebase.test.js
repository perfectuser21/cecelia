import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createKernelRun } from '../kernel-run-store.js';
import { seedExecutionDirectoryFixture } from '../../__tests__/helpers/execution-directory-fixture.js';

import { fixture, runId, taskId, receiptId, newReceiptId, base } from './recovery-rebase.fixture.js';

const target = { machine: 'xian-mac-m4', provider: 'codex', account: 'team2' };
const emptyProfileHash = createHash('sha256').update('{}').digest('hex');
async function targetFixture() {
  const f = fixture();
  Object.assign(f.request, { execution_target: { ...target }, expected_profile_hash: emptyProfileHash });
  const snapshot = await seedExecutionDirectoryFixture();
  const node = snapshot.nodes.find(n => n.canonical_id === target.machine);
  const grant = node.grants.find(g => g.surface === 'harness' && g.account_id === target.account);
  const client = await f.pool.connect(), query = client.query;
  client.query = async (sql, params) => {
    if (/SELECT v\.\*,n.canonical_id/.test(sql)) return { rows: [node] };
    if (/SELECT \* FROM execution_grants/.test(sql)) return { rows: [grant] };
    return query(sql, params);
  };
  return { ...f, node, grant };
}

describe('恢复冻结已授权执行目标', () => {
  it('同事务冻结Commander和完整阶段链，收据保存目录授权且新run重签', async () => {
    const f = await targetFixture();
    const result = await createKernelRun(f.pool, f.input, f.deps);
    expect(result.created).toBe(true);
    const update = f.calls.find(c => /UPDATE tasks SET payload/.test(c.sql));
    const payload = JSON.parse(update.params[1]);
    expect(payload.commander).toEqual({ primary: target, fallbacks: [] });
    expect(payload.routing).toMatchObject({ preferred_machine: target.machine, strict_affinity: true });
    for (const role of ['planner','proposer','reviewer','generator','evaluator','judge','publisher']) {
      expect(payload.role_assignments[role]).toEqual({ ...target, strict_affinity: true });
    }
    const receipt = f.calls.find(c => /INSERT INTO work_routing_receipts/.test(c.sql));
    expect(JSON.parse(receipt.params[15]).recovery_rebase.execution_profile).toMatchObject({
      target, previous_profile_hash: emptyProfileHash,
      execution_version_id: f.node.id, grant_id: f.grant.id,
    });
    expect(f.calls.find(c => /INSERT INTO initiative_runs/.test(c.sql)).params[15]).toBeNull();
    expect(f.calls.some(c => /UPDATE (initiative_runs|work_routing_receipts|execution_grants)/.test(c.sql))).toBe(false);
  });

  it('旧profile CAS失败时无新增收据', async () => {
    const f = await targetFixture(); f.request.expected_profile_hash = '0'.repeat(64);
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('recovery_rebase_profile_changed');
    expect(f.calls.some(c => /INSERT INTO work_routing_receipts/.test(c.sql))).toBe(false);
  });

  it('拒绝非目录目标且无新增收据', async () => {
    const f = await targetFixture(); f.request.execution_target.machine = 'untrusted-host';
    await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('recovery_rebase_execution_denied');
    expect(f.calls.some(c => /INSERT INTO work_routing_receipts/.test(c.sql))).toBe(false);
  });

  it('目标与hash必须成对提供，拒绝额外target字段和无界名称', async () => {
    for (const mutate of [f => { delete f.request.expected_profile_hash; },
      f => { delete f.request.execution_target; }, f => { f.request.execution_target.url = 'http://unknown'; },
      f => { f.request.execution_target.account = 'a'.repeat(129); }]) {
      const f = await targetFixture(); mutate(f);
      await expect(createKernelRun(f.pool, f.input, f.deps)).rejects.toThrow('recovery_rebase_request_invalid');
      expect(f.calls).toHaveLength(0);
    }
  });

  it('模型URL或遍历必须在事务与授权前拒绝，不写目标payload/收据', async () => {
    for (const model of ['https://example.com/model','ftp://host/model','C:/Users/account/model','vendor/../model']) {
      const f = await targetFixture(); f.request.execution_target.model=model;
      await expect(createKernelRun(f.pool,f.input,f.deps)).rejects.toThrow('recovery_rebase_request_invalid');
      expect(f.calls).toHaveLength(0);
    }
  });
});

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

  it('显式请求仅从planning恢复，拒绝额外payload键及路径穿越', async () => {
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
