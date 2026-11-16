import { describe, it, expect } from 'vitest';
import { runFactoryCycle, runFactoryPusher } from '../factory-cycle.js';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';
const ledger = { id: '1b5a0be0-f0b2-4960-af44-f09790a039c1', workflow_key: 'douyin_video_publish.android', stage: 3,
  candidate_version: 'candidate@1', recent_runs: [], recent_pass: 0, recent_total: 0, window_k: 3, blocked_kind: 'none' };
function fixture(tasks = []) {
  const created = [], written = [], runs = [];
  const db = { query: async () => ({ rows: [] }) };
  const deps = { force: true, now: () => new Date('2026-10-11T06:00:00Z'), env: {}, log: () => {},
    judgeStore: { listCandidates: async () => tasks, findLedger: async () => ledger,
      writeJudge: async (id, value) => written.push({ id, value }), getTask: async () => null },
    pusherStore: { listLedgers: async () => [ledger], inFlight: async () => null, countRounds: async () => 0,
      consecutiveFails: async () => 0, tickets: async () => ({ done: 0, total: 0 }) },
    resolveConfig: resolveWorkflowConfig,
    createTask: async spec => { created.push(spec); return { task: { id: 'verification-task' } }; },
    recordRun: async (id, value) => { runs.push({ id, value }); return { duplicate: false }; } };
  return { db, deps, created, written, runs };
}
describe('明确任务边界', () => {
  it('只有可执行台账且零Task时周期不建执行单或开发单', async () => {
    const f = fixture();
    const result = await runFactoryCycle(f.db, f.deps);
    expect(f.created).toEqual([]);
    expect(result.judge).toEqual([]);
  });
  it('明确Task完成后仍建同源核验单，不受旧推进器开关影响', async () => {
    const task = { id: '11111111-1111-4111-8111-111111111111', status: 'completed', task_type: 'skill_factory_run',
      payload: { factory_dispatch: true, factory_ledger_id: ledger.id, factory: { stage: '3', workflow_key: ledger.workflow_key, skill: 'candidate@1', device: { serial: 'test' } } },
      result: { delivery: { run_id: 'explicit-run', claimed_result: 'success', lock_released: true, final_evidence: ['evidence.png'], side_effects: [] } } };
    const f = fixture([task]);
    f.deps.env.FACTORY_PUSHER_ENABLED = 'false';
    f.deps.resolveConfig = () => ({ visual_verify: true, expected_outward: 0 });
    const result = await runFactoryCycle(f.db, f.deps);
    expect(f.created).toHaveLength(1);
    expect(f.created[0].payload).toMatchObject({ factory_verify_of: task.id, source_task_id: task.id, factory_verify_run_id: 'explicit-run', skill: 'run-verify' });
    expect(f.written).toEqual([{ id: task.id, value: expect.objectContaining({ state: 'awaiting_verify', verify_task_id: 'verification-task' }) }]);
    expect(result.judge).toEqual([{ task_id: task.id, state: 'awaiting_verify', verify_task_id: 'verification-task' }]);
    task.result.factory_judge = f.written[0].value;
    f.deps.judgeStore.getTask = async () => ({ id: 'verification-task', status: 'completed', result: { verification: { run_id: 'explicit-run', verdict: 'pass' } } });
    const final = await runFactoryCycle(f.db, f.deps);
    expect(final.judge[0]).toMatchObject({ task_id: task.id, state: 'final', verdict: 'pass', recorded: true });
    expect(f.runs).toEqual([{ id: ledger.id, value: { run_id: 'explicit-run', pass: true, degraded: false, safe_stop: false, source_task_id: task.id } }]);
    expect(f.created).toHaveLength(1);

  });
  it('CLI直接调用旧台账推进器明确拒绝且不建单', async () => {
    const f = fixture();
    await expect(runFactoryPusher(f.db, { ...f.deps, store: f.deps.pusherStore })).rejects.toMatchObject({ status: 410, code: 'FACTORY_PUSHER_RETIRED' });
    expect(f.created).toEqual([]);
  });
});
