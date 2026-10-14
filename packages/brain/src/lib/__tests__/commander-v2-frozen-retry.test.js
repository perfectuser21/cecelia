import { it, expect, vi } from 'vitest';
import { commanderCases, skillFirstCases } from './fixtures/commander-contract-v1.js';
import { prepareCommander } from '../commander-v2-dispatch.js';
import { getRelease } from '../release-index.js';
vi.mock('../release-index.js', () => ({ getRelease: vi.fn() }));
vi.mock('../commander-method-selection.js', () => ({ selectHistoricalMethod: vi.fn(), validateMethodGates: vi.fn() }));
vi.mock('../commander-v2-implementation.js', async importOriginal => ({ ...await importOriginal(), verifySkillPairings: vi.fn() }));
function recovering(kind) {
  const f = kind === 'primary' ? skillFirstCases() : commanderCases();
  if (kind === 'legacy') {
    delete f.release.payload.activities[0].payload.commander_implementations;
    delete f.envelope.activity_bindings[0].implementations;
  }
  const previous = { phase: 'recovering', envelope: f.envelope, failure: { reason: 'verification_failed' } };
  const task = { ...f.task, status: 'in_progress', result: { workflow_control: previous } };
  getRelease.mockResolvedValue(f.release);
  const db = { release() {}, query: vi.fn(async sql => ({ rows: sql.startsWith('SELECT * FROM tasks') ? [task] : [] })) };
  const deps = { target: 'fixture-worker', now: () => new Date(Date.parse(f.envelope.deadline_at) - 1000),
    selectHistoricalMethod: vi.fn(async () => null), startRun: vi.fn(),
    ready: async e => ({ protocol: e.protocol, ready: true, ...e.definition }) };
  return { ...f, previous, deps, pool: { connect: async () => db } };
}
for (const kind of ['primary', 'pair']) it(`冻结${kind}失败只重试原组合，不能触发历史实现选择`, async () => {
  const f = recovering(kind), next = await prepareCommander(f.pool, f.task.id, f.deps);
  expect(f.deps.selectHistoricalMethod).not.toHaveBeenCalled();
  expect(next.recovery_mode).toBe('same_verified_implementation_retry');
  expect(next.envelope.activity_bindings).toEqual(f.envelope.activity_bindings);
  expect(next.envelope.definition.snapshot_sha256).toBe(f.envelope.definition.snapshot_sha256);
  expect(next.envelope.attempt).toBe(2);
  expect(next.envelope.deadline_at).toBe(f.envelope.deadline_at);
  expect(next.envelope.cleanup_deadline_at).toBe(f.envelope.cleanup_deadline_at);
});
it('无冻结声明的legacy恢复仍调用历史方法选择', async () => {
  const f = recovering('legacy'); await prepareCommander(f.pool, f.task.id, f.deps);
  expect(f.deps.selectHistoricalMethod).toHaveBeenCalledTimes(1);
});
