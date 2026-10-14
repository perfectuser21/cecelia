import { readFileSync } from 'node:fs';
import { it, expect, vi } from 'vitest';
import { makeEnvelope } from '../commander-v2-contract.js';
import { buildExecSpec, buildTicketSpec, decideLedger } from '../factory-pusher.js';
import { reconcileCommanderTask } from '../commander-v2-control.js';
import { activityBindings, checkFence } from '../commander-v2-store.js';

const sample = JSON.parse(readFileSync(new URL('./fixtures/commander-contract-v1.json', import.meta.url)));
const { task, contract, definition, release } = sample;
const now = () => new Date('2026-10-14T00:00:00Z');
const ledger = { id: 'ledger', workflow_key: task.payload.workflow_key, stage: 3, candidate_version: 'paired@2', blocked_kind: 'none', recent_runs: [], recent_total: 0, recent_pass: 0, window_k: 3 };
const cfg = { device: { node: 'worker', profile: 'private', serial: 'phone' }, agent: 'work-commander', dispatch_via: 'commander', commander: { workflow_definition: definition, workflow_input: task.payload.workflow_input } };

it('工厂新单带v2冻结定义和结构输入，未知输入不降回旧五参数', () => {
  const spec = buildExecSpec({ ledger, cfg, stage: 3, skill: 'paired@2', round: 1, commanderRoute: true });
  expect(spec.payload).toMatchObject({ commander_protocol: 'commander-v2', workflow_definition: definition, workflow_input: task.payload.workflow_input });
  expect(spec.payload.factory_dispatch_condition_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(() => buildExecSpec({ ledger, cfg: { ...cfg, commander: {} }, stage: 3, skill: 'paired@2', round: 2, commanderRoute: true })).toThrow('冻结');
});
it('上线跑stage5同样走v2，不借旧data工单绕开结构输入', () => {
  const spec = buildTicketSpec({ ledger: { ...ledger, stage: 5 }, cfg, stage: 5, kind: 'commander', round: 2, commanderRoute: true });
  expect(spec.task_type).toBe('workflow_dispatch'); expect(spec.payload.commander_protocol).toBe('commander-v2');
  expect(decideLedger({ ledger: { ...ledger, stage: 5 }, cfg: { ...cfg, commander: {} }, commanderRoute: true }).actions.some(a => a.type === 'commander_ticket')).toBe(false);
});

it('放弃旧稿授权必须匹配当前任务、冻结账号与私密验收；缺失默认不授权', () => {
  expect(makeEnvelope(task, definition, contract, null, now()).input.allow_discard_existing_draft).toBe(true);
  for (const mutate of [
    input => { delete input.authorization; },
    input => { input.authorization.object.task_id = 'other'; },
    input => { input.authorization.object.account_ref = 'other'; },
    input => { input.authorization.scope.visibility = 'public'; },
    input => { input.authorization.grant_ref = ''; },
  ]) {
    const bad = structuredClone(task); mutate(bad.payload.workflow_input);
    expect(() => makeEnvelope(bad, definition, contract, null, now())).toThrow('授权');
  }
  const plain = structuredClone(task); delete plain.payload.workflow_input.allow_discard_existing_draft; delete plain.payload.workflow_input.authorization;
  expect(makeEnvelope(plain, definition, contract, null, now()).input.allow_discard_existing_draft).not.toBe(true);
});

it('相同阻断摘要不重建轮；输入实际变化才可恢复', () => {
  const spec = buildExecSpec({ ledger, cfg, stage: 3, skill: 'paired@2', round: 1, commanderRoute: true });
  const lastBlock = { condition_sha256: spec.payload.factory_dispatch_condition_sha256, reason: 'draft_not_authorized' };
  expect(decideLedger({ ledger, cfg, lastBlock, commanderRoute: true, now: new Date('2026-10-14T06:00:00Z') }).actions).toEqual([]);
  const changed = structuredClone(cfg); changed.commander.workflow_input.content_ref = 'different-content';
  expect(decideLedger({ ledger, cfg: changed, lastBlock, commanderRoute: true, now: new Date('2026-10-14T06:00:00Z') }).actions.some(a => a.type === 'dispatch')).toBe(true);
});

it('配套Code/Skill及环境来自冻结release，摘要漂移在起跑前拒绝', () => {
  const bindings = activityBindings(definition, release);
  expect(bindings[0].implementations).toEqual(sample.implementations);
  const forged = structuredClone(release); forged.payload.activities[0].payload.commander_implementations.skill.implementation.digest = 'f'.repeat(64);
  expect(() => activityBindings(definition, forged)).toThrow('实现');
});

function runtimeControl({ stopped = false, cleanup = false, expired = true } = {}) {
  const envelope = makeEnvelope(task, definition, contract, null, now());
  const current = { id: task.id, task_type: 'workflow_dispatch', status: 'in_progress', payload: task.payload,
    result: { workflow_control: { phase: 'running', envelope, last_seq: 0, execution_stopped: false } } };
  const db = { release() {}, query: vi.fn(async (sql, args = []) => {
    if (sql.startsWith('SELECT * FROM tasks')) return { rows: [current] };
    if (sql.includes("jsonb_build_object('workflow_control'")) current.result.workflow_control = JSON.parse(args[1]);
    if (sql.startsWith('UPDATE tasks SET status')) { current.status = 'failed'; return { rows: [current] }; }
    return { rows: [] };
  }) };
  const deps = { now: () => new Date(expired ? envelope.cleanup_deadline_at : envelope.deadline_at),
    fence: vi.fn(async () => ({ execution_fenced: true })),
    status: vi.fn(async () => ({ protocol: envelope.protocol, run_id: envelope.run_id, execution_stopped: stopped, events: [], cleanup: { completed: cleanup, evidence: cleanup ? ['official:cleaned'] : [] } })),
    releaseLease: vi.fn(), releaseLock: vi.fn(), finishRun: vi.fn(), afterTerminal: vi.fn() };
  return { current, envelope, deps, pool: { connect: async () => db, query: db.query } };
}

it('执行期限到后停止接受新业务，但收尾期限内继续读回，不伪报清理成功', async () => {
  const f = runtimeControl({ expired: false }); await reconcileCommanderTask(f.pool, task.id, f.deps);
  expect(f.current.result.workflow_control.phase).toBe('stopping');
  expect(f.current.result.workflow_control.execution_fenced).toBe(true);
  expect(() => checkFence(f.current, f.envelope)).toThrow('隔离');
  expect(f.deps.releaseLock).not.toHaveBeenCalled(); expect(f.current.status).toBe('in_progress');
});

it('收尾期限耗尽且活性未知，原任务收敛failed/INCONCLUSIVE、旧epoch隔离且不放锁', async () => {
  const f = runtimeControl(); f.deps.status.mockRejectedValue(Error('unreachable'));
  await reconcileCommanderTask(f.pool, task.id, f.deps);
  expect(f.current.result.workflow_control).toMatchObject({ phase: 'final', verdict: 'INCONCLUSIVE', terminal_status: 'failed', execution_fenced: true, execution_stopped: false });
  expect(f.current.status).toBe('failed'); expect(f.deps.releaseLock).not.toHaveBeenCalled();
});

it('官方确认已停止但清理未证实，仍不释放设备锁', async () => {
  const f = runtimeControl({ stopped: true }); await reconcileCommanderTask(f.pool, task.id, f.deps);
  expect(f.current.result.workflow_control).toMatchObject({ phase: 'final', verdict: 'INCONCLUSIVE', execution_stopped: true });
  expect(f.deps.releaseLock).not.toHaveBeenCalled();
});
