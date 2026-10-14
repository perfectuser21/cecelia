import { it, expect, vi } from 'vitest';
import { commanderCases, skillFirstCases } from './fixtures/commander-contract-v1.js';
import { verifySkillPairings } from '../commander-v2-implementation.js';
import { getRunDefinitionBinding } from '../run-definition-binding.js';
vi.mock('../run-definition-binding.js', () => ({ getRunDefinitionBinding: vi.fn() }));
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

for (const selection of ['missing', 'code_primary', 'wrong_skill']) it(`正式Skill primary证明的source实际${selection}不能授予配套资格`, async () => {
  const f = commanderCases(), single = skillFirstCases();
  const selected = f.envelope.activity_bindings[0].implementations.skill, ref = selected.verification_ref;
  const source = structuredClone(single.release);
  if (selection === 'missing') delete source.payload.activities[0].payload.commander_implementation;
  if (selection === 'code_primary') source.payload.activities[0].payload.commander_implementation = { ...f.implementations.code, business_requirement_sha256: single.skill_first.primary_implementation.business_requirement_sha256 };
  if (selection === 'wrong_skill') source.payload.activities[0].payload.commander_implementation.implementation.id = 'unselected-skill';
  getRunDefinitionBinding.mockResolvedValue({ binding: { task_run_id: 'source-run' }, workflow: { payload_sha256: ref.definition_sha256, payload: { contract: f.contract } }, activities: source.payload.activities });
  const proof = { status: 'completed', task_type: 'research', parent_task_id: 'source-task', payload: { verification_transport: 'openclaw-agent-v1', run_id: 'verify-run' }, result: {
    receipt: { verification_runtime: { provider: 'openai', model: 'gpt-6.1-sol', rerouted: false, logical_run_id: 'verify-run', official_run_id: 'official' } },
    workflow_verification: { ...single.verification, task_id: 'source-task', run_id: ref.run_id, definition_sha256: ref.definition_sha256 } } };
  const db = { query: vi.fn(async sql => ({ rows: sql.startsWith('SELECT * FROM tasks') ? [proof] : [{ task_id: 'source-task', status: 'success' }] })) };
  await expect(verifySkillPairings(db, f.envelope)).rejects.toThrow('冻结来源不匹配');
});
