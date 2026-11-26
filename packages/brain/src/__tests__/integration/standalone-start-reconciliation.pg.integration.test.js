import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { foundationHttpFixture } from '../fixtures/workflow-foundation-http.js';
import { createFoundationTask } from '../../workflow-foundation/registry.js';
import { digest } from '../../orchestrator/commander-decision.js';

const machine = 'us-mac-m4';
const serial = 'fixture-physical-phone';
const sourceCommit = 'b'.repeat(40);
let fixture;
afterEach(async () => { await fixture?.close(); fixture = null; });

async function blocked101({reason = 'standalone_start_unconfirmed', holdDevice = false} = {}) {
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
  const receipt = { task_id: task.id, run_id: job.run_id, status: 'needs_review', evidence: [], reason };
  const finish = () => fixture.request('/workflow-foundation/standalone/finish', { machine_id: machine, receipt });
  expect((await finish()).body).toEqual({ status: 'blocked' });
  if (holdDevice) {
    await fixture.pool.query("INSERT INTO device_locks(device_name,locked_by,locked_at,expires_at) VALUES($1,$2,NOW(),NOW()+INTERVAL '5 minutes')",[serial,task.id]);
  } else {
    await fixture.pool.query('INSERT INTO device_locks(device_name) VALUES($1)',[serial]);
  }
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

it('仅接受与原 TaskRun 同一窗口的首次硬件诊断超时原件，结算仍不重试', async () => {
  const f = await blocked101();
  const startedAt = (await f.run()).started_at.toISOString();
  const finishedAt = f.body.review.revocation.observed_at;
  const digestValue = 'a'.repeat(64);
  const hardware = {
    protocol: 'device-epoch-fence-diagnostic/v1', query: 'hardware_serial',
    scope: { endpoint: 'tcp:127.0.0.1:5045', serial: '127.0.0.1:15555', maintenance_task_id: f.task.id },
    source: Object.fromEntries(['device-epoch-fence-diagnostics.mjs','adb-shell-v2-protocol.mjs','device-epoch-fence-reference.mjs'].map(key=>[key,digestValue])),
    started_at: startedAt, finished_at: finishedAt,
    events: [startedAt, finishedAt].flatMap((at,index)=>[
      { index, event:'eof', at }, { index, event:'close', had_error:false, peer_eof:true, at },
    ]),
    files: Object.fromEntries(['socket-0.raw','socket-1.raw','stdout.raw','stderr.raw'].map(key=>[key,digestValue])),
    wire_complete: false, exit_code: 0, error_code: 'DIAGNOSTIC_DEADLINE', pending: 0, open_sockets: 0,
    original_execution_stopped: false, remote_quiescence: 'unknown', resource_authority: 'not_attested',
  };
  const input = (value, overrides = {}) => {
    const raw = JSON.stringify(value)+'\n';
    return {...f.body,review:{...f.body.review, admission_code:'EPOCH_DEVICE_IDENTITY',
      hardware_diagnostic:{stage:'initial_hardware_serial',raw,sha256:createHash('sha256').update(raw).digest('hex'),...overrides}}};
  };
  for (const invalid of [
    {...f.body,review:{...f.body.review,admission_code:'EPOCH_DEVICE_IDENTITY'}},
    input(hardware,{sha256:'c'.repeat(64)}), input(hardware,{stage:'later_hardware_serial'}),
    input({...hardware,scope:{...hardware.scope,maintenance_task_id:randomUUID()}}),
    input({...hardware,started_at:'2020-01-01T00:00:00.000Z'}),
    input({...hardware,finished_at:new Date(Date.parse(finishedAt)+1000).toISOString()}),
    input({...hardware,query:'foreground'}), input({...hardware,exit_code:1}),
    input({...hardware,wire_complete:true}), input({...hardware,error_code:'DIAGNOSTIC_UNKNOWN'}),
    input({...hardware,open_sockets:1}), input({...hardware,pending:1}),
    input({...hardware,events:hardware.events.slice(0,3)}),
    input({...hardware,events:hardware.events.map(event=>event.event==='close'?{...event,peer_eof:false}:event)}),
    {...input(hardware),review:{...input(hardware).review,admission_code:'EPOCH_ADMISSION_SCOPE'}},
  ]) expect([400,409]).toContain((await f.reconcile(invalid)).status);
  const attempt = input(hardware);
  expect(await f.reconcile(attempt)).toMatchObject({status:200,body:{status:'failed',retry_safe:false,replayed:false}});
  expect(await f.reconcile(attempt)).toMatchObject({status:200,body:{replayed:true}});
  expect((await f.state()).result).toMatchObject({standalone_receipt:f.receipt, standalone_start_review:{
    admission_code:'EPOCH_DEVICE_IDENTITY', hardware_diagnostic_sha256:attempt.review.hardware_diagnostic.sha256,
    task_run_id:(await f.run()).id, retry_safe:false,
  }});
  expect((await f.run()).status).toBe('failed');
  expect((await f.claim()).body).toEqual({job:null});
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

async function desktopCleanupReview(holdDevice = true) {
  const f = await blocked101({reason:'standalone_cleanup_unconfirmed',holdDevice});
  const now = new Date();
  const readOnly = [['version'],['version'],['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555','get-state']];
  const makeLeaf = (args,index) => {
    const at = +now + index;
    return {sequence:index+1,argv_sha256:createHash('sha256').update(JSON.stringify(args)).digest('hex'),
      intent_at:at,started_at:at,ended_at:at,boundary:'darwin-sandbox-deny-process-fork-v1',pid:40+index,
      code:0,signal:null,tainted:false,dump_crash_returned:false,request_returned:true};
  };
  const cleanup = {task_id:f.task.id,run_id:f.job.run_id,execution_mode:'codex-direct',
    native_return_unknown:true,quarantine_verified:true,local_released:false,central_released:false,desktop:null,
    leaves:{complete:true,empty_complete:false,requests_returned:true,empty_requests_returned:false,epoch_fence_lost:false,
      ledger:f.body.review.host_proof.run_directory+'/standalone-leaves/collection-leaves-abc123.jsonl',
      leaves:readOnly.map(makeLeaf)}};
  const readLock = async () => (await fixture.pool.query("SELECT device_name,locked_by,xmin::text AS version FROM device_locks WHERE device_name=$1",[serial])).rows[0];
  const lock = await readLock();
  // Fixture can freeze all observations at one instant. Production requires the original leaves before revocation.
  const cutoff = new Date(+now + readOnly.length).toISOString();
  const touched = await fixture.pool.query('UPDATE tasks SET blocked_at=$2 WHERE id=$1 RETURNING blocked_at',[f.task.id,cutoff]);
  Object.assign(f.body,{blocked_at:touched.rows[0].blocked_at.toISOString()});
  Object.assign(f.body.review,{protocol:'standalone-pre-native-cleanup-review/v1',admission_code:'DESKTOP_UNKNOWN',
    observed_at:cutoff,revocation:{...f.body.review.revocation,reason:'DESKTOP_UNKNOWN',observed_at:cutoff}});
  const seal = raw => ({raw,sha256:createHash('sha256').update(raw).digest('hex')});
  f.body.review.cleanup_diagnostic = {
    ...seal(JSON.stringify(cleanup)),adb_endpoint:'tcp:127.0.0.1:5045',adb_serial:'127.0.0.1:15555',central_lease_version:lock.version,
    desktop_readback:{serial,default_home:'com.android.launcher3/.Launcher',focused_activity:'com.android.launcher3/com.android.launcher3.Launcher',observed_at:cutoff},
  };
  return {...f,readLock,cleanup,seal};
}

it('settles the original 101 after only returned read-only cleanup probes and releases its exact central lock', async () => {
  const f = await desktopCleanupReview();
  expect((await f.readLock()).locked_by).toBe(f.task.id);
  const result = await f.reconcile();
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({status:'failed',run_id:f.job.run_id,replayed:false,retry_safe:false});
  expect((await f.state()).result.standalone_receipt).toEqual(f.receipt);
  expect((await f.state()).result.standalone_start_review).toMatchObject({
    admission_code:'DESKTOP_UNKNOWN',cleanup_diagnostic_sha256:f.body.review.cleanup_diagnostic.sha256,
    observed_central_lease_version:f.body.review.cleanup_diagnostic.central_lease_version,central_release_performed:true,
  });
  expect((await f.run()).status).toBe('failed');
  expect((await f.readLock()).locked_by).toBeNull();
  expect((await f.reconcile()).body.replayed).toBe(true);
  expect((await f.finish()).body.status).toBe('blocked');
});

it('keeps the original 101 blocked for an uncertified cleanup leaf, desktop mismatch, or changed central version', async () => {
  const f = await desktopCleanupReview();
  const original = structuredClone(f.body);
  const invalidLeaf = structuredClone(f.cleanup);
  invalidLeaf.leaves.leaves[0].argv_sha256 = createHash('sha256').update(JSON.stringify(['shell','input','keyevent','3'])).digest('hex');
  Object.assign(f.body.review.cleanup_diagnostic,f.seal(JSON.stringify(invalidLeaf)));
  expect((await f.reconcile()).status).toBe(400);
  Object.assign(f.body,structuredClone(original));
  f.body.review.cleanup_diagnostic.desktop_readback.focused_activity = 'com.android.launcher3/.OtherActivity';
  expect((await f.reconcile()).status).toBe(400);
  Object.assign(f.body,structuredClone(original));
  f.body.review.cleanup_diagnostic.central_lease_version = '1';
  expect((await f.reconcile()).status).toBe(409);
  expect((await f.state()).status).toBe('blocked');
  expect((await f.run()).status).toBe('running');
  expect((await f.readLock()).locked_by).toBe(f.task.id);
});

it('settles a fresh already-free central lock without rewriting it', async () => {
  const f = await desktopCleanupReview(false);
  const before = await f.readLock();
  expect(before.locked_by).toBeNull();
  const result = await f.reconcile();
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(await f.readLock()).toEqual(before);
  expect((await f.state()).result.standalone_start_review.central_release_performed).toBe(false);
  expect((await f.run()).status).toBe('failed');
});

async function desktopCleanupWithLastAckMissing() {
  const f = await desktopCleanupReview();
  const adb = ['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555'];
  const commands = [['version'],['version'],[...adb,'get-state'],['version'],
    [...adb,'shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],
    ['version'],[...adb,'shell','input','keyevent','3'],['version']];
  const fields = f.cleanup.leaves.leaves[0];
  const leaves = commands.map((argv,index)=>({...fields,sequence:index+1,pid:fields.pid+index,
    argv_sha256:createHash('sha256').update(JSON.stringify(argv)).digest('hex')}));
  Object.assign(f.cleanup.leaves, {complete:false,requests_returned:false,leaves});
  const ledger = leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at}=leaf;
    const intent={sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  ledger.push({...leaves.at(-1),phase:'unknown'});
  const encodeLedger = () => f.seal(ledger.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const setLedger = () => Object.assign(f.body.review.cleanup_diagnostic,
    f.seal(JSON.stringify(f.cleanup)),{terminal_ack_ledger:encodeLedger()});
  setLedger();
  return {...f,ledger,setLedger};
}

it('settles an exited final version probe with a missing ack after one completed HOME', async () => {
  const f = await desktopCleanupWithLastAckMissing();
  const result = await f.reconcile();
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(await f.state()).toMatchObject({status:'failed',result:{
    standalone_receipt:f.receipt,
    standalone_start_review:{cleanup_ledger_sha256:f.body.review.cleanup_diagnostic.terminal_ack_ledger.sha256},
  }});
  expect((await f.run()).status).toBe('failed');
  expect((await f.readLock()).locked_by).toBeNull();
});

it('does not allow the HOME branch without its original terminal-only ledger', async () => {
  const f = await desktopCleanupWithLastAckMissing();
  const diagnostic = f.body.review.cleanup_diagnostic;
  const original = structuredClone(diagnostic);
  delete diagnostic.terminal_ack_ledger;
  expect((await f.reconcile()).status).toBe(400);
  Object.assign(diagnostic,structuredClone(original));
  diagnostic.terminal_ack_ledger.sha256='0'.repeat(64);
  expect((await f.reconcile()).status).toBe(400);
  f.ledger.at(-1).sequence=7;
  f.setLedger();
  expect((await f.reconcile()).status).toBe(400);
  f.ledger.at(-1).sequence=8;
  f.cleanup.leaves.leaves[6].argv_sha256='1'.repeat(64);
  f.setLedger();
  expect((await f.reconcile()).status).toBe(400);
  expect((await f.state()).status).toBe('blocked');
  expect((await f.readLock()).locked_by).toBe(f.task.id);
});
