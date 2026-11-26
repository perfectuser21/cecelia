import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { foundationHttpFixture } from '../fixtures/workflow-foundation-http.js';
import { createFoundationTask } from '../../workflow-foundation/registry.js';
import { digest } from '../../orchestrator/commander-decision.js';

const machine = 'us-mac-m4';
const serial = 'fixture-physical-phone';
const sourceCommit = 'b'.repeat(40);
let fixture;
afterEach(async () => { await fixture?.close(); fixture = null; });

async function blocked101() {
  const workflowKey = 'douyin_video_discovery';
  fixture = await foundationHttpFixture({ workflowKey, releaseTarget: 'mmv', directInput: true });
  const { registration, release } = await fixture.publish();
  const submit = async () => {
    const notionPageId = randomUUID();
    return (await createFoundationTask(fixture.pool, {
      workflow_id: registration.workflow_id, release_id: release.id,
      input: { binding_key: 'fixture', business: { keyword: '验收', max_candidates: 1 } },
      idempotency_key: `notion-101:${notionPageId}`,
    }, { notionPageId, notionTenantId: randomUUID(), notionWorkflowKey: workflowKey })).task;
  };
  const task = await submit();
  const claim = () => fixture.request('/workflow-foundation/standalone/claim', { machine_id: machine });
  const { job } = (await claim()).body;
  const start = await fixture.request(`/runs/${job.run_id}/start-skill`, {
    task_id: task.id, claimer: job.claimer, claimed_at: job.claimed_at,
    definition: { ...job.definition, attempt_key: task.id+':1', actor: job.claimer },
    standalone: {
      scope: { workflow_key: workflowKey, source_commit: sourceCommit, approved_keywords: ['验收'], limit: 1,
        serial, company: { company_id: randomUUID(), tenant_id: task.tenant_id, version: 1, policy_id: 'fixture' } },
      skill: { name: 'douyin-leadgen-direct', version: '1.0.0', source_commit: sourceCommit, path: 'skill/SKILL.md', sha256: 'b'.repeat(64) },
    },
  });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  const state = async () => (await fixture.pool.query('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0];
  const current = await state();
  const binding = start.body.binding;
  const { scope, skill } = current.payload;
  const identity = {
    protocol: 'codex-exec-v1', task_id: task.id, run_id: job.run_id, machine_id: machine, claimer: job.claimer, claimed_at: job.claimed_at,
    profile_sha256: 'a'.repeat(64), skill, company: scope.company, approved_keywords: scope.approved_keywords,
    task_run_id: start.body.task_run_id, scope_sha256: digest({ ...scope, task_id: task.id }),
    run_binding: { run_binding_id: binding.id, workflow_id: binding.workflow_id, workflow_definition_version_id: binding.workflow_definition_version_id,
      attempt_key: binding.attempt_key, activities: Object.fromEntries(release.payload.workflows[0].payload.activities.map(activity => [activity.slot_key, {
        reference_id: activity.reference_id, activity_id: activity.activity_id, activity_definition_version_id: activity.activity_version_id,
      }])) },
  };
  expect((await fixture.request('/workflow-foundation/standalone/attest', { machine_id: machine, identity })).body).toEqual({ attested: true });
  const scopeProof = { task_id: task.id, run_id: job.run_id, task_run_id: identity.task_run_id,
    run_binding_id: binding.id, source_commit: sourceCommit, snapshot_sha256: 'd'.repeat(64) };
  const revokedAt = new Date().toISOString();
  const receipt = { task_id: task.id, run_id: job.run_id, status: 'needs_review', evidence: [], reason: 'standalone_start_unconfirmed' };
  const finish = () => fixture.request('/workflow-foundation/standalone/finish', { machine_id: machine, receipt });
  expect((await finish()).body).toEqual({ status: 'blocked' });
  await fixture.pool.query('INSERT INTO device_locks(device_name) VALUES($1)',[serial]);
  const blocked = await state();
  const body = { task_id: task.id, machine_id: machine, blocked_at: blocked.blocked_at.toISOString(),
    expected_receipt_sha256: digest(receipt), expected_attestation_sha256: digest(identity), review: {
      protocol: 'standalone-pre-native-review/v1', observed_at: new Date().toISOString(), evidence_sha256: 'e'.repeat(64),
      admission_code: 'EPOCH_ADMISSION_SCOPE', host_process_exited: true, native_operations: 0, business_effects: 0,
      local_lock: { owner: job.run_id, review_required: true },
      host_proof: { protocol:'standalone-skill-host-proof/v1', ...scopeProof, run_directory: `/fixture/${job.run_id}`,
        process_identity: { pid: 3, pgid: 3, ppid: 1, start_identity: 'fixture-birth', uid: 501 } },
      revocation: { protocol:'standalone-skill-host-revocation/v1', ...scopeProof, pid: 3, reason: 'ADMISSION_REJECTED', observed_at: revokedAt },
    } };
  const reconcile = (input=body, options) => fixture.request(`/runs/${job.run_id}/standalone-start-reconciliation`,input,options);
  const run = async () => (await fixture.pool.query('SELECT * FROM task_runs WHERE run_id=$1',[job.run_id])).rows[0];
  return { task, job, binding, receipt, claim, finish, submit, reconcile, body, state, run };
}

it('原单被确认拦于原生准入前，原子失败结算、并发幂等且保留原回执', async () => {
  const f = await blocked101();
  expect((await f.reconcile(f.body,{auth:false})).status).toBe(401);
  expect((await f.claim()).body).toEqual({job:null});
  const replies = await Promise.all([f.reconcile(),f.reconcile()]);
  expect(replies.map(r=>r.status)).toEqual([200,200]);
  expect(replies.map(r=>r.body.replayed).sort()).toEqual([false,true]);
  const task = await f.state(), run = await f.run();
  expect(task).toMatchObject({ status:'failed', claimed_by:null, result:{standalone_receipt:f.receipt} });
  expect(run).toMatchObject({ status:'failed', result:{standalone_start_review:task.result.standalone_start_review} });
  expect(run.ended_at).toBeTruthy();
  expect(task.result.standalone_start_review).toMatchObject({ retry_safe:false, source:'authenticated-operator', evidence_sha256:f.body.review.evidence_sha256 });
  expect((await f.finish()).body).toEqual({status:'blocked'});
  expect((await f.state()).status).toBe('failed');
  expect((await f.reconcile({...f.body,review:{...f.body.review,evidence_sha256:'f'.repeat(64)}})).status).toBe(409);
  expect((await fixture.pool.query('SELECT run_id FROM task_runs WHERE task_id=$1',[task.id])).rows).toEqual([{run_id:f.job.run_id}]);
  expect((await f.claim()).body).toEqual({job:null});
  const newApprovedTask = await f.submit();
  expect((await f.claim()).body.job.task_id).toBe(newApprovedTask.id);
},30000);

it('拒绝他机、过期、漂移、原生效果及存活 holder/计划；末段失败回滚原 TaskRun', async () => {
  const f = await blocked101();
  for (const change of [
    {...f.body,machine_id:'other'}, {...f.body,expected_attestation_sha256:'0'.repeat(64)},
    {...f.body,expected_receipt_sha256:'0'.repeat(64)}, {...f.body,blocked_at:f.job.claimed_at},
    {...f.body,review:{...f.body.review,observed_at:'2020-01-01T00:00:00.000Z'}},
    {...f.body,review:{...f.body.review,native_operations:1}},
    {...f.body,review:{...f.body.review,revocation:{...f.body.review.revocation,task_run_id:randomUUID()}}},
    {...f.body,review:{...f.body.review,revocation:{...f.body.review.revocation,reason:'STARTUP_UNKNOWN'}}},
  ]) expect([400,409]).toContain((await f.reconcile(change)).status);
  const oldReceipt = f.receipt;
  await fixture.pool.query("UPDATE tasks SET result=result||jsonb_build_object('standalone_receipt',$2::jsonb) WHERE id=$1", [f.task.id,{...oldReceipt,reason:'standalone_cleanup_unknown'}]);
  expect((await f.reconcile()).status).toBe(409);
  await fixture.pool.query("UPDATE tasks SET result=result||jsonb_build_object('standalone_receipt',$2::jsonb) WHERE id=$1",[f.task.id,oldReceipt]);
  await fixture.pool.query('UPDATE device_locks SET locked_by=$2 WHERE device_name=$1',[serial,randomUUID()]);
  expect((await f.reconcile()).status).toBe(409);
  await fixture.pool.query('UPDATE device_locks SET locked_by=NULL WHERE device_name=$1',[serial]);
  const pending = (await fixture.pool.query("INSERT INTO pending_actions(action_type,params) VALUES('owner_decision',$1) RETURNING id",[{device_name:serial}])).rows[0];
  expect((await f.reconcile()).status).toBe(409);
  await fixture.pool.query('DELETE FROM pending_actions WHERE id=$1',[pending.id]);
  await fixture.pool.query("INSERT INTO spans(run_id,activity_id,started_at,executor_kind,outcome) VALUES($1,$2,NOW(),'code','unknown')",
    [f.job.run_id,f.binding.expected_path[0].activity_id]);
  expect((await f.reconcile()).status).toBe(409);
  await fixture.pool.query('DELETE FROM spans WHERE run_id=$1',[f.job.run_id]);
  const action = 'f'.repeat(64);
  await fixture.pool.query("INSERT INTO commander_activity_actions(action_id,run_id,activity_key,identity,state,deadline_ms) VALUES($1,$2,'preflight','{}','reserved',1)",[action,f.job.run_id]);
  expect((await f.reconcile()).status).toBe(409);
  await fixture.pool.query('DELETE FROM commander_activity_actions WHERE action_id=$1',[action]);
  await fixture.pool.query(`CREATE FUNCTION reject_fixture_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status='failed' THEN RAISE EXCEPTION 'fixture final write rejected'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_fixture_review BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION reject_fixture_review()`);
  expect((await f.reconcile()).status).toBe(503);
  expect(await f.state()).toMatchObject({status:'blocked',result:{standalone_receipt:oldReceipt}});
  expect(await f.run()).toMatchObject({status:'running',ended_at:null});
},30000);
