import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { IMPACT_REPO } from '../../../__tests__/fixtures/implementation-impact-db.js';
import { withLegacyNames } from '../../../__tests__/fixtures/minimum-definition-schema.js';
import { sample } from '../fixtures/commander-contract-v1.js';
import { digest } from '../../commander-v2-contract.js';
import { commanderBusinessContract, freezeCommanderDeclarations } from '../../definition-commander-bindings.js';
import { createRelease, recordReleaseObservation, getReleaseGate } from '../../release-index.js';
import { dispatchCommanderV2 } from '../../commander-v2-dispatch.js';
import { receiveCommanderEvent } from '../../commander-v2-feedback.js';
import { reconcileCommanderTask } from '../../commander-v2-control.js';
import { verifySkillPairings } from '../../commander-v2-implementation.js';
let f, taskId, deps;
const code = sample.implementations.code, skill = sample.implementations.skill;
const bindings = [code, skill].map(b => ({ kind: b.implementation.kind, repo: IMPACT_REPO, path: b.path,
  revision: 'b'.repeat(40), version: b.implementation.version, ...(b.implementation.kind === 'skill' ? { name: b.implementation.id } : {}) }));
function configure(docs) {
  for (const doc of Object.values(docs)) {
    doc.activities = doc.activities.filter(a => a.key === 'preflight' || a.ref === 'keyword_acquisition.preflight');
    doc.environment = sample.contract.environment; doc.resources = {}; doc.execution_profile = 'codex_agent';
    doc.input_schema = { type: 'object' }; doc.recovery = { max_attempts: 1, total_timeout_sec: 600, cleanup_timeout_sec: 60 };
    for (const a of doc.activities.filter(a => !a.ref)) {
      a.by = 'agent'; a.implementation_bindings = bindings;
      a.commander_implementation = { ...skill, business_requirement_sha256: digest(commanderBusinessContract(a)) };
    }
  }
}
beforeEach(async () => {
  f = await releaseEvidenceDatabase({ configureContracts: configure, commanderBindings: bindings,
    commanderEdges: [[code.path, 'src/shared-lock.js']],
    readBinding: async b => sample.source_files[b.path] ?? 'export const controller=true;\n' });
  await f.db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id uuid,ADD COLUMN IF NOT EXISTS description text,ADD COLUMN IF NOT EXISTS result jsonb,
    ADD COLUMN IF NOT EXISTS task_type text,ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS claimed_at timestamptz,ADD COLUMN IF NOT EXISTS executor_kind text,ADD COLUMN IF NOT EXISTS priority text`);
  await f.db.query(readFileSync(new URL('../../../../migrations/268_task_events.sql', import.meta.url), 'utf8'));
  await f.db.query(readFileSync(new URL('../../../../migrations/553_task_leases_device_pools.sql', import.meta.url), 'utf8').split('CREATE TABLE IF NOT EXISTS device_pools')[0]);
  await f.db.query('DROP TABLE spans CASCADE');
  for (const file of ['495_vs_model_spans.sql', '514_span_occurrences.sql', '516_span_definition_provenance.sql'])
    await withLegacyNames(f.db, () => f.db.query(readFileSync(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8')));
  expect(f.releaseInput.ci_evidence[0].report.gaps).toEqual([]);
  const release = (await createRelease(f.db, f.releaseInput)).release;
  const observation = (await recordReleaseObservation(f.db, release.id, f.observationInput, { trustedCollector: 'fixture-collector' })).observation;
  expect((await getReleaseGate(f.db, release.id)).verification.gaps).toEqual([]);
  const workflow = f.workflows.find(w => w.workflow_id === f.ids.keyword), definition = f.runInput(release, observation, workflow);
  delete definition.source_kind; delete definition.external_origin;
  taskId = randomUUID();
  await f.db.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,'独立Skill验证','queued','workflow_dispatch',$2)", [taskId,
    { commander_protocol: 'commander-v2', workflow_key: workflow.payload.contract.workflow, workflow_input: { content_ref: 'scratch-work' }, workflow_definition: definition }]);
  deps = { target: 'fixture-host', ready: async e => ({ protocol: e.protocol, ready: true, ...e.definition }), sshDispatch: vi.fn(async () => 'DISPATCHED'),
    setLease: vi.fn(), releaseLease: vi.fn(), releaseLock: vi.fn(), afterTerminal: vi.fn(), createVerify: async (db, spec) => {
      const id = randomUUID(); await db.query("INSERT INTO tasks(id,title,status,task_type,payload,parent_task_id) VALUES($1,$2,'queued','research',$3,$4)", [id, spec.title, spec.metadata, taskId]); return { task: { id } };
    } };
});
afterEach(async () => { await f?.close(); f = null; });
const state = async () => (await f.db.query('SELECT * FROM tasks WHERE id=$1', [taskId])).rows[0];
it('共享v1真实source冻结→Skill primary事实→正式独立核验→配套资格读回；旧epoch/错实现零事实', async () => {
  await dispatchCommanderV2(f.db, taskId, deps);
  let c = (await state()).result.workflow_control, e = c.envelope;
  expect(e.activity_bindings.every(b => b.primary_implementation?.implementation.kind === 'skill')).toBe(true);
  expect(f.activities.every(a => !a.payload.contract.commander_implementation && a.payload.commander_implementation)).toBe(true);
  let seq = 0;
  const event = (path, evidence) => ({ protocol: e.protocol, run_id: e.run_id, attempt: e.attempt, owner_epoch: e.owner_epoch,
    seq: seq + 1, type: 'activity_completed', data: { ...path, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), outcome: 'pass', evidence } });
  const evidence = { implementation: skill.implementation, execution_role: 'primary', environment: sample.contract.environment, observed: { value: 1 } };
  const old = { ...event(e.definition.expected_path[0], evidence), owner_epoch: 0 };
  await expect(receiveCommanderEvent(f.db, taskId, old)).rejects.toThrow('过期反馈');
  await expect(receiveCommanderEvent(f.db, taskId, event(e.definition.expected_path[0], { ...evidence, implementation: code.implementation }))).rejects.toThrow('归属');
  for (const path of e.definition.expected_path) { await receiveCommanderEvent(f.db, taskId, event(path, evidence)); seq += 1; }
  const delivery = { ...e, status: 'completed', outputs: {}, evidence: ['scratch:real-source-byte-readback'], effects: [], cleanup: { completed: true, evidence: ['scratch:official-child-ended'] } };
  await receiveCommanderEvent(f.db, taskId, { protocol: e.protocol, run_id: e.run_id, attempt: e.attempt, owner_epoch: e.owner_epoch, seq: ++seq, type: 'delivery', data: delivery });
  await reconcileCommanderTask(f.db, taskId, { ...deps, status: async () => ({ protocol: e.protocol, run_id: e.run_id, execution_stopped: true }) });
  c = (await state()).result.workflow_control;
  const vt = (await f.db.query('SELECT * FROM tasks WHERE id=$1', [c.verify_task_id])).rows[0];
  const v = { task_id: taskId, run_id: e.run_id, attempt: e.attempt, definition_sha256: e.definition.snapshot_sha256,
    verdict: 'PASS', implementation: skill.implementation, environment: sample.contract.environment, execution_role: 'primary',
    assertions: [{ name: 'cleanup', pass: true }, { name: 'source_bytes_and_output', pass: true }], evidence: ['scratch:independent-readback'] };
  await f.db.query("UPDATE tasks SET status='completed',result=$2 WHERE id=$1", [vt.id, { workflow_verification: v,
    receipt: { verification_runtime: { provider: 'openai', model: 'gpt-6.1-sol', logical_run_id: vt.payload.run_id, official_run_id: 'scratch-official-receipt', rerouted: false } } }]);
  await reconcileCommanderTask(f.db, taskId, deps); c = (await state()).result.workflow_control;
  expect((await state()).status).toBe('completed'); expect(c.execution_outcome).toBe('skill_independent_success');
  const sourceActivity = f.activities.find(a => a.activity_id === e.activity_bindings[0].activity_id);
  const pairs = { business_requirement_sha256: digest(sourceActivity.payload.contract), code, skill: { ...skill,
    verification_ref: { task_id: vt.id, run_id: e.run_id, definition_sha256: e.definition.snapshot_sha256 } } };
  const frozen = freezeCommanderDeclarations({ ...sourceActivity.payload.contract, commander_implementations: pairs }, sourceActivity.payload.implementation_bindings);
  const candidate = { ...e, activity_bindings: [{ ...e.activity_bindings[0], implementations: frozen.commander_implementations }] };
  await expect(verifySkillPairings(f.db, candidate)).resolves.toBeUndefined();
  await f.db.query("UPDATE tasks SET result=jsonb_set(result,'{workflow_verification,execution_role}','\"rescue\"') WHERE id=$1", [vt.id]);
  await expect(verifySkillPairings(f.db, candidate)).rejects.toThrow('Skill独立核验');
  const spans = (await f.db.query('SELECT * FROM spans WHERE run_id=$1', [e.run_id])).rows;
  expect(spans).toHaveLength(e.definition.expected_path.length); expect(spans.every(s => s.evidence.implementation.kind === 'skill')).toBe(true);
});
