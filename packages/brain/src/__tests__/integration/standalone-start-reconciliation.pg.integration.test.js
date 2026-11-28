import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { foundationHttpFixture } from '../fixtures/workflow-foundation-http.js';
import { prepareCollectionOpenAppTimeoutReview, prepareDesktopCleanupReview } from '../fixtures/standalone-cleanup-review-fixture.js';
import { createFoundationTask } from '../../workflow-foundation/registry.js';
import { digest } from '../../orchestrator/commander-decision.js';

const machine = 'us-mac-m4';
const serial = 'fixture-physical-phone';
const sourceCommit = 'b'.repeat(40);
let fixture;
afterEach(async () => { await fixture?.close(); fixture = null; });

async function blockedPhone({reason = 'standalone_start_unconfirmed', holdDevice = false, stage = '101'} = {}) {
  const collection = stage === '102';
  const workflowKey = collection ? 'douyin_video_processing' : 'douyin_video_discovery';
  fixture = await foundationHttpFixture({ workflowKey, releaseTarget: 'mmv', directInput: true });
  const { registration, release } = await fixture.publish();
  const submit = async () => {
    const notionPageId = randomUUID();
    return (await createFoundationTask(fixture.pool, {
      workflow_id: registration.workflow_id, release_id: release.id,
      input: { binding_key: 'fixture', business: collection ? { source_run: 'fixture-video-batch' } : { keyword: '验收', max_candidates: 1 } },
      idempotency_key: `notion-${stage}:${notionPageId}`,
    }, { notionPageId, notionTenantId: randomUUID(), notionWorkflowKey: workflowKey })).task;
  };
  const task = await submit();
  const claim = () => fixture.request('/workflow-foundation/standalone/claim', { machine_id: machine, sources: ['notion_leadgen_'+stage] });
  const { job } = (await claim()).body;
  const start = await fixture.request(`/runs/${job.run_id}/start-skill`, {
    task_id: task.id, claimer: job.claimer, claimed_at: job.claimed_at,
    definition: { ...job.definition, attempt_key: task.id+':1', actor: job.claimer },
    standalone: {
      scope: { workflow_key: workflowKey, source_commit: sourceCommit, approved_keywords: collection ? [] : ['验收'], ...(collection ? {source_run:'fixture-video-batch'} : {}), limit: 1,
        serial, ...(collection ? { profile:'fixture-cloud' } : {}), line: 'fixture', company: { company_id: randomUUID(), tenant_id: task.tenant_id, version: 1, policy_id: 'fixture' } },
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
  const f = await blockedPhone();
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
  const f = await blockedPhone();
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
  const f = await blockedPhone();
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

async function desktopCleanupReview(holdDevice = true, stage = '101') {
  const f = await blockedPhone({reason:'standalone_cleanup_unconfirmed',holdDevice,stage});
  return prepareDesktopCleanupReview(f,fixture.pool,serial);
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

async function desktopCleanupWithLastAckMissing(preflight = false) {
  const f = await desktopCleanupReview();
  const adb = ['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555'];
  const probes = preflight
    ? [[...adb,'shell','getprop','ro.product.model'],[...adb,'shell','dumpsys','telephony.registry']]
    : [[...adb,'shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],
      [...adb,'shell','input','keyevent','3']];
  const commands = [['version'],['version'],[...adb,'get-state'],['version'],
    probes[0],['version'],probes[1],['version']];
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
  if (preflight) {
    const review=f.body.review, at=review.observed_at;
    review.admission_code=review.revocation.reason='TOOL_RESULT_UNKNOWN';
    const controller=[
      {operation:'phone',code:'STANDALONE_NATIVE_COMMAND',controller_exit_code:124,at,diagnostic:{
        stdout:'profile=fixture\nserial=fixture-physical-phone\nmodel=fixture\nstate=device\ncall_state=idle\n',
        stderr:'NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN\nguarded command timeout: whole command and children terminated; owner lock retained\n',
      }},
      {operation:'phone',code:'STANDALONE_NATIVE_HOST_REVOKED',at},
      {operation:'inspect',code:'STANDALONE_NATIVE_HOST_REVOKED',at},
    ];
    const scope=(await f.state()).payload.scope;
    const {company_id,tenant_id,version}=scope.company;
    const snapshot={company_id,tenant_id,version,line_key:scope.line,run_id:f.job.run_id,count:1};
    review.cleanup_diagnostic.preflight_timeout={
      ...f.seal(controller.map(row=>JSON.stringify(row)).join('\n')+'\n'),company_snapshot:snapshot,
    };
    return {...f,ledger,setLedger,controller};
  }
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

it('settles the read-only preflight timeout and preserves the company snapshot fact', async () => {
  const f=await desktopCleanupWithLastAckMissing(true);
  const result=await f.reconcile();
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect((await f.state()).result.standalone_start_review).toMatchObject({
    admission_code:'TOOL_RESULT_UNKNOWN',
    cleanup_ledger_sha256:f.body.review.cleanup_diagnostic.terminal_ack_ledger.sha256,
    preflight_timeout_sha256:f.body.review.cleanup_diagnostic.preflight_timeout.sha256,
    company_snapshot:f.body.review.cleanup_diagnostic.preflight_timeout.company_snapshot,
  });
  expect((await f.run()).status).toBe('failed');
  expect((await f.readLock()).locked_by).toBeNull();
});

it('rejects an unrelated company snapshot or a non-timeout tool error', async () => {
  const f=await desktopCleanupWithLastAckMissing(true);
  const diagnostic=f.body.review.cleanup_diagnostic.preflight_timeout;
  const original=structuredClone(diagnostic);
  diagnostic.company_snapshot.company_id=randomUUID();
  expect((await f.reconcile()).status).toBe(409);
  Object.assign(diagnostic,original);
  f.controller[0].controller_exit_code=1;
  Object.assign(diagnostic,f.seal(f.controller.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  expect((await f.reconcile()).status).toBe(400);
  expect((await f.state()).status).toBe('blocked');
  expect((await f.readLock()).locked_by).toBe(f.task.id);
});

async function accountForegroundReview() {
  const f = await desktopCleanupReview();
  const { review } = f.body;
  const { company_id, tenant_id, version } = (await f.state()).payload.scope.company;
  const target = ['-H', '127.0.0.1', '-P', '5045', '-s', '127.0.0.1:15555'];
  const versionProbe = ['version'];
  const state = [...target, 'get-state'];
  const model = [...target, 'shell', 'getprop', 'ro.product.model'];
  const call = [...target, 'shell', 'dumpsys', 'telephony.registry'];
  const foreground = [...target, 'shell', 'dumpsys', 'window', 'displays'];
  const commands = [
    versionProbe, versionProbe, state, versionProbe, model, versionProbe, call, versionProbe, foreground,
    versionProbe, versionProbe, state, versionProbe, model, versionProbe, foreground,
  ];
  const fields = f.cleanup.leaves.leaves[0];
  const leaves = commands.map((argv,index)=>({
    ...fields, sequence:index+1, pid:fields.pid+index,
    argv_sha256:createHash('sha256').update(JSON.stringify(argv)).digest('hex'),
  }));
  const rawLines = rows => rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
  const ledger = leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at}=leaf;
    const intent={sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  f.cleanup.leaves.leaves = leaves;
  review.admission_code = review.revocation.reason = 'TOOL_RESULT_UNKNOWN';
  Object.assign(review.cleanup_diagnostic, f.seal(JSON.stringify(f.cleanup)), {
    account_foreground_refusal: {
      ...f.seal(rawLines([
        {operation:'phone',code:'STANDALONE_NATIVE_COMMAND',controller_exit_code:2,at:review.observed_at,
          diagnostic:{stdout:'',stderr:'standalone account entry is not in Douyin foreground; navigation refused\n'}},
        {operation:'inspect',code:'STANDALONE_NATIVE_HOST_REVOKED',at:review.observed_at},
      ])),
      company_snapshot:{company_id,tenant_id,version,line_key:'fixture',run_id:f.job.run_id,count:1},
      leaf_ledger:f.seal(rawLines(ledger)),
    },
  });
  return {...f, ledger, rawLines};
}

it('settles an exact account foreground refusal with only returned read-only operations and preserves the receipt', async () => {
  const f=await accountForegroundReview();
  const proof=f.body.review.cleanup_diagnostic.account_foreground_refusal;
  const result=await f.reconcile();
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({status:'failed',retry_safe:false,replayed:false});
  expect((await f.state()).result).toMatchObject({
    standalone_receipt:f.receipt,
    standalone_start_review:{account_foreground_refusal_sha256:proof.sha256,cleanup_ledger_sha256:proof.leaf_ledger.sha256,
      company_snapshot:proof.company_snapshot,central_release_performed:true},
  });
  expect((await f.run()).status).toBe('failed');
  expect((await f.readLock()).locked_by).toBeNull();
  expect((await f.reconcile()).body).toMatchObject({replayed:true});
});

it('keeps the account foreground refusal quarantined without exact diagnostics, all read-only leaves and the same company', async () => {
  const f=await accountForegroundReview();
  const diagnostic=f.body.review.cleanup_diagnostic;
  const proof=structuredClone(diagnostic.account_foreground_refusal);
  diagnostic.account_foreground_refusal=null;
  expect((await f.reconcile()).status).toBe(400);
  diagnostic.account_foreground_refusal={...structuredClone(proof),
    leaf_ledger:f.seal(f.rawLines(f.ledger.slice(0,-1)))};
  expect((await f.reconcile()).status).toBe(400);
  diagnostic.account_foreground_refusal={...structuredClone(proof),
    ...f.seal(proof.raw.replace('navigation refused','not the exact controller refusal'))};
  expect((await f.reconcile()).status).toBe(400);
  diagnostic.account_foreground_refusal=structuredClone(proof);
  diagnostic.account_foreground_refusal.company_snapshot.company_id=randomUUID();
  expect((await f.reconcile()).status).toBe(409);
  expect((await f.state()).status).toBe('blocked');
  expect((await f.run()).status).toBe('running');
  expect((await f.readLock()).locked_by).toBe(f.task.id);
});


it.each(['cleanup', 'launch', 'probes', 'mixed', 'account-no-xml', 'account-snapshot'])('102 已回桌面且零业务写入时结算原运行（原生记录=%s）', async (mode) => {
  const f = await blockedPhone({stage:'102', reason:'standalone_business_unconfirmed'});
  const next = await f.submit();
  expect((await f.claim()).body).toEqual({job:null});
  const observedAt = new Date().toISOString();
  const began = +(await f.run()).started_at;
  const endpoint = 'tcp:127.0.0.1:5045', transport = '127.0.0.1:15555';
  const target = ['-H','127.0.0.1','-P','5045','-s',transport], version = ['version'];
  const cleanup = [version,version,[...target,'get-state'],version,
    [...target,'shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],
    version,[...target,'shell','input','keyevent','3'],version,[...target,'shell','dumpsys','window','displays']];
  const open = [version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],version,
    [...target,'shell','monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1'],version,
    [...target,'shell','dumpsys','window','displays']];
  const telephony=[...target,'shell','dumpsys','telephony.registry'];
  const probe=[version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],version,
    telephony,version,[...target,'shell','dumpsys','window','displays'],version,telephony];
  const snapshotMode = mode === 'account-snapshot';
  const accountMode = mode === 'account-no-xml' || snapshotMode;
  const profile = (await f.state()).payload.scope.profile;
  const xml = '/sdcard/douyin-leadgen-ui-'+profile+'.xml';
  const uiStat = [...target,'shell','stat','-c','%s',xml];
  const foreground = [...target,'shell','dumpsys','window','displays'];
  const account = [version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],version,
    foreground,version,foreground,version,[...target,'shell','rm','-f',xml],version,
    [...target,'shell','uiautomator','dump','--compressed',xml],version,uiStat,version,
    [...target,'shell',`if [ ! -e '${xml}' ] && [ ! -L '${xml}' ]; then printf '%s' 'REMOTE_UI_ABSENT_V1'; else exit 1; fi`]];
  const snapshotId = f.job.run_id+'-acct-shot';
  const remoteShot = '/sdcard/douyin-leadgen-shot-'+profile+'.png';
  const localShot = '/private/tmp/openclaw-phone/evidence/'+profile+'/'+snapshotId+'.png';
  const snapshot = [version,version,[...target,'get-state'],version,
    [...target,'shell','screencap','-p',remoteShot],version,[...target,'pull',remoteShot,localShot]];
  const prelude={cleanup:[],launch:open,probes:[...probe,...probe],mixed:[...probe,...open,version],
    'account-no-xml':[...probe,...open,...account],
    'account-snapshot':[...probe,...open,...account,...snapshot]}[mode];
  const commands = [...prelude,...cleanup];
  const sha = value => createHash('sha256').update(value).digest('hex');
  const boundary = 'darwin-sandbox-deny-process-fork-v1';
  const [device] = (await fixture.pool.query('SELECT xmin::text AS version FROM device_locks WHERE device_name=$1',[serial])).rows;
  const proofFor = argv => {
    const leaves = argv.map((cmd,index)=>({sequence:index+1,argv_sha256:sha(JSON.stringify(cmd)),intent_at:began,boundary,
      pid:index+10,started_at:began,ended_at:began,code:accountMode&&cmd===uiStat?1:0,signal:null,tainted:false,dump_crash_returned:false,request_returned:true}));
    const ledger = leaves.flatMap(leaf=>{
      const {sequence,argv_sha256,intent_at,pid,started_at}=leaf;
      const intent={sequence,argv_sha256,intent_at,boundary};
      return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
    }).map(row=>JSON.stringify(row)).join('\n')+'\n';
    const raw = JSON.stringify({task_id:f.task.id,run_id:f.job.run_id,execution_mode:'codex-direct',
      native_return_unknown:false,quarantine_verified:false,local_released:true,central_released:true,
      desktop:'launcher=com.android.launcher3\nforeground_package=com.android.launcher3\nforeground=  mCurrentFocus=Window{aa u0 com.android.launcher3/.Launcher}\n',
      leaves:{complete:!accountMode,empty_complete:false,requests_returned:true,empty_requests_returned:false,epoch_fence_lost:false,leaves,
        ledger:f.body.review.host_proof.run_directory+'/standalone-leaves/collection-leaves-a.jsonl'}});
    return {raw,sha256:sha(raw),adb_endpoint:endpoint,adb_serial:transport,central_lease_version:device.version,
      ...(accountMode?{account_profile:profile}:{}),
      ...(snapshotMode?{account_snapshot_id:snapshotId}:{}),terminal_ack_ledger:{raw:ledger,sha256:sha(ledger)}};
  };
  const {revocation,...review}=f.body.review;
  const body={...f.body,review:{...review,protocol:'standalone-released-no-effect-review/v1',admission_code:'CLEANUP_VERIFIED_NO_BUSINESS',
    observed_at:observedAt,local_lock:{owner:null,review_required:false},cleanup_diagnostic:proofFor(commands)}};

  expect((await f.reconcile(body,{auth:false})).status).toBe(401);
  const diagnostic = body.review.cleanup_diagnostic;
  expect((await f.reconcile({...body,review:{...body.review,local_lock:{owner:f.job.run_id,review_required:true}}})).status).toBe(400);
  expect((await f.reconcile({...body,review:{...body.review,cleanup_diagnostic:{...diagnostic,sha256:'0'.repeat(64)}}})).status).toBe(400);
  const missingAck = diagnostic.terminal_ack_ledger.raw.trimEnd().split('\n').slice(0,-1).join('\n')+'\n';
  expect((await f.reconcile({...body,review:{...body.review,cleanup_diagnostic:{...diagnostic,
    terminal_ack_ledger:{raw:missingAck,sha256:sha(missingAck)}}}})).status).toBe(400);
  if (prelude.length) {
    const replaceCommand = (index,command) => commands.map((original,position)=>position===index?command:original);
    for (const invalidCommands of [
      replaceCommand(6,[...target,'shell','input','tap','100','100']),
      replaceCommand(commands.length-3,[...target,'shell','input','keyevent','4']),
      [...prelude,...cleanup.slice(0,-1)],
      [...commands,version],
      [open[6],...cleanup],
      [...open,...open,...cleanup],
      replaceCommand(2,['-H','127.0.0.1','-P','5044','-s',transport,'get-state']),
      ...(accountMode?[
        replaceCommand(probe.length+open.length+10,[...target,'shell','rm','-f','/sdcard/foreign.xml']),
        [...probe,...open,...account,...account,...cleanup],
        [...prelude.slice(0,-1),...cleanup],
      ]:[]),
      ...(snapshotMode?[
        replaceCommand(prelude.length-1,[...target,'pull',remoteShot,localShot.replace(f.job.run_id,randomUUID())]),
        replaceCommand(prelude.length-1,[...target,'pull',remoteShot,'/tmp/foreign.png']),
        replaceCommand(prelude.length-3,[...target,'shell','input','tap','100','100']),
        [...prelude,...snapshot,...cleanup],
      ]:[]),
    ]) {
      expect((await f.reconcile({...body,review:{...body.review,cleanup_diagnostic:proofFor(invalidCommands)}})).status).toBe(400);
    }
  }
  expect((await f.reconcile({...body,review:{...body.review,cleanup_diagnostic:{...diagnostic,
    central_lease_version:device.version+'0'}}})).status).toBe(409);
  expect(await f.state()).toMatchObject({status:'blocked'});
  expect(await f.run()).toMatchObject({status:'running'});
  const first = await f.reconcile(body);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body).toMatchObject({status:'failed',retry_safe:false,replayed:false});
  expect((await f.reconcile(body)).body).toMatchObject({status:'failed',replayed:true});
  const replay = await f.finish();
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({status:'blocked'});
  expect(await f.state()).toMatchObject({status:'failed',claimed_by:null,result:{standalone_receipt:f.receipt}});
  expect(await f.run()).toMatchObject({status:'failed'});
  expect((await f.claim()).body.job.task_id).toBe(next.id);
},30000);

it.each([{}, { uiProfile:'fixture-cloud' }, { uiProfile:'fixture-cloud', accountRead:true }])('102 受管手机超时后，仅凭原回执和现场归位结算 %j',async(options)=>{
  const f = prepareCollectionOpenAppTimeoutReview(await desktopCleanupReview(false,'102'),options);
  const pending = await f.submit();
  expect((await f.claim()).body).toEqual({job:null});
  const wrongDesktop = structuredClone(f.body);
  wrongDesktop.review.cleanup_diagnostic.desktop_readback.focused_activity = 'com.ss.android.ugc.aweme/.MainActivity';
  expect((await f.reconcile(wrongDesktop)).status).toBe(400);
  const wrongLedger = structuredClone(f.body);
  const artifact = wrongLedger.review.cleanup_diagnostic[options.accountRead?'account_read_timeout':'open_app_timeout'];
  Object.assign(artifact.leaf_ledger,f.seal(artifact.leaf_ledger.raw.replace('"phase":"exit"','"phase":"unknown"')));
  expect((await f.reconcile(wrongLedger)).status).toBe(400);
  const busy = await fixture.pool.query("UPDATE device_locks SET locked_by=$2 WHERE device_name=$1 RETURNING xmin::text AS version",[serial,pending.id]);
  f.body.review.cleanup_diagnostic.central_lease_version = busy.rows[0].version;
  expect((await f.reconcile()).status).toBe(409);
  expect(await f.state()).toMatchObject({status:'blocked'});
  expect(await f.run()).toMatchObject({status:'running'});
  const released = await fixture.pool.query("UPDATE device_locks SET locked_by=NULL WHERE device_name=$1 RETURNING xmin::text AS version",[serial]);
  f.body.review.cleanup_diagnostic.central_lease_version = released.rows[0].version;
  const result = await f.reconcile();
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({status:'failed',retry_safe:false,replayed:false});
  expect((await f.reconcile()).body).toMatchObject({status:'failed',replayed:true});
  expect((await f.finish()).body).toMatchObject({status:'blocked'});
  expect(await f.state()).toMatchObject({status:'failed',claimed_by:null,result:{standalone_receipt:f.receipt}});
  expect(await f.run()).toMatchObject({status:'failed'});
  expect((await f.claim()).body.job.task_id).toBe(pending.id);
});
