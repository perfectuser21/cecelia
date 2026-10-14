import { it, expect, vi } from 'vitest';
import { commanderCases } from './fixtures/commander-contract-v1.js';
import { launchCommander } from '../commander-v2-dispatch.js';
function prepared(proof = null) {
  const f = commanderCases(), c = { phase: 'prepared', launch_state: 'pending', envelope: f.envelope };
  const task = { ...f.task, status: 'in_progress', result: { workflow_control: c } };
  const db = { release() {}, query: vi.fn(async (sql, args = []) => ({ rows: sql.startsWith('SELECT * FROM tasks') ? (args[0] === task.id ? [task] : proof ? [proof] : []) : [] })) };
  const deps = { target: 'fixture-worker', ready: vi.fn(async e => ({ protocol: e.protocol, ready: true, ...e.definition })),
    lockGate: vi.fn(async () => ({ pass: true })), setLease: vi.fn(), sshDispatch: vi.fn(async () => 'DISPATCHED') };
  return { ...f, pool: { connect: async () => db }, deps };
}
it('声明verification_ref不等于正式独立Skill资格，缺proof在锁/起跑前拒绝', async () => {
  const f = prepared();
  await expect(launchCommander(f.pool, f.task.id, f.deps)).rejects.toThrow('Skill独立核验');
  expect(f.deps.lockGate).not.toHaveBeenCalled(); expect(f.deps.sshDispatch).not.toHaveBeenCalled();
});
it('自报PASS或Code救场proof均不能授权配套Skill', async () => {
  const f = prepared({ status: 'completed', result: { workflow_verification: { verdict: 'PASS' } } });
  await expect(launchCommander(f.pool, f.task.id, f.deps)).rejects.toThrow('Skill独立核验');
  expect(f.deps.sshDispatch).not.toHaveBeenCalled();
});
