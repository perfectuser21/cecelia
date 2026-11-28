import { createHash } from 'node:crypto';
import { getRunDefinitionBinding } from '../lib/run-definition-binding.js';
import { finishRun } from '../lib/task-run.js';
import { finalizeTask } from '../lib/task-terminal.js';
import { digest } from '../orchestrator/commander-decision.js';
import { validateMachineRequest } from './claim.js';
import { UUID, onlyKeys, requireFoundation } from './contracts.js';
import { foundationTransaction } from './registry.js';
import { collectionOpenAppReview, collectionAccountReadReview, desktopCleanupFailure, verifyDesktopCleanupProof, verifyReleasedCleanupProof } from './standalone-cleanup-review.js';
import { collectionAccountFallbackReview } from './standalone-account-fallback-review.js';

const hash = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const startFailure = 'standalone_start_unconfirmed';
const businessUnconfirmed = 'standalone_business_unconfirmed';
const evidenceTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const proofIdentity = ['task_id','run_id','task_run_id','run_binding_id','source_commit','snapshot_sha256'];
const validPid = value => Number.isSafeInteger(value) && value > 0;
const check = (ok, code = 'standalone_start_review_conflict') => requireFoundation(ok, code);
const invalid = ok => requireFoundation(ok, 'standalone_start_review_invalid', 400);
const hardwareSource = ['device-epoch-fence-diagnostics.mjs','adb-shell-v2-protocol.mjs','device-epoch-fence-reference.mjs'];
const hardwareFiles = ['socket-0.raw','socket-1.raw','stdout.raw','stderr.raw'];
const hardwareHash = value => typeof value === 'string' && hash.test(value);

function verifyHardwareTimeout(review, taskId) {
  const artifact = review.hardware_diagnostic;
  if (review.admission_code === 'EPOCH_ADMISSION_SCOPE') {
    invalid(artifact === undefined);
    return null;
  }
  invalid(review.admission_code === 'EPOCH_DEVICE_IDENTITY');
  onlyKeys(artifact,['stage','raw','sha256']);
  const { raw, sha256 } = artifact;
  invalid(artifact.stage === 'initial_hardware_serial' && typeof raw === 'string' && Buffer.byteLength(raw) <= 4096
    && hardwareHash(sha256) && createHash('sha256').update(raw).digest('hex') === sha256);
  let diagnostic;
  try { diagnostic = JSON.parse(raw); } catch { invalid(false); }
  onlyKeys(diagnostic,['protocol','query','scope','source','started_at','finished_at','events','files','wire_complete','exit_code',
    'error_code','pending','open_sockets','original_execution_stopped','remote_quiescence','resource_authority']);
  onlyKeys(diagnostic.scope,['endpoint','serial','maintenance_task_id']);
  onlyKeys(diagnostic.source,hardwareSource);
  onlyKeys(diagnostic.files,hardwareFiles);
  const { scope, events } = diagnostic;
  invalid(diagnostic.protocol === 'device-epoch-fence-diagnostic/v1' && diagnostic.query === 'hardware_serial'
    && scope.maintenance_task_id === taskId && typeof scope.endpoint === 'string' && /^tcp:127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(scope.endpoint)
    && typeof scope.serial === 'string' && /^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(scope.serial)
    && hardwareSource.every(key=>hardwareHash(diagnostic.source[key])) && hardwareFiles.every(key=>hardwareHash(diagnostic.files[key]))
    && diagnostic.wire_complete === false && diagnostic.exit_code === 0 && diagnostic.error_code === 'DIAGNOSTIC_DEADLINE'
    && diagnostic.pending === 0 && diagnostic.open_sockets === 0 && diagnostic.original_execution_stopped === false
    && diagnostic.remote_quiescence === 'unknown' && diagnostic.resource_authority === 'not_attested'
    && evidenceTime(diagnostic.started_at) && evidenceTime(diagnostic.finished_at) && Array.isArray(events) && events.length === 4);
  const startedAt = Date.parse(diagnostic.started_at), finishedAt = Date.parse(diagnostic.finished_at);
  let previousAt = startedAt;
  for (const [index,event] of events.entries()) {
    const closing = index % 2 === 1;
    onlyKeys(event,closing?['index','event','at','had_error','peer_eof']:['index','event','at']);
    const timestamp = Date.parse(event.at);
    invalid(event.index === Math.floor(index/2) && event.event === (closing?'close':'eof')
      && (!closing || event.had_error === false && event.peer_eof === true)
      && evidenceTime(event.at) && timestamp >= previousAt && timestamp <= finishedAt);
    previousAt = timestamp;
  }
  return {startedAt,finishedAt,sha256};
}

function verifyRequest(runId, input) {
  validateMachineRequest(input, ['task_id','machine_id','blocked_at','expected_receipt_sha256','expected_attestation_sha256','review']);
  const review = input.review;
  onlyKeys(review, ['protocol','observed_at','evidence_sha256','admission_code','host_process_exited','native_operations',
    'business_effects','local_lock','host_proof','revocation','hardware_diagnostic','cleanup_diagnostic']);
  const collectionOpenAppTimeout = [collectionOpenAppReview,collectionAccountReadReview].includes(review.protocol);
  const collectionAccountFallback = review.protocol === collectionAccountFallbackReview;
  const desktopCleanup = collectionAccountFallback || collectionOpenAppTimeout || review.protocol === 'standalone-pre-native-cleanup-review/v1';
  const host = review.host_proof, revocation = review.revocation;
  onlyKeys(host, ['protocol',...proofIdentity,'run_directory','process_identity']);
  onlyKeys(host.process_identity, ['pid','pgid','ppid','uid','start_identity']);
  onlyKeys(review.local_lock, ['owner','review_required']);
  invalid(UUID.test(runId ?? '') && UUID.test(input.task_id ?? '')
    && [input.expected_receipt_sha256,input.expected_attestation_sha256,review.evidence_sha256,host.snapshot_sha256].every(x=>typeof x==='string'&&hash.test(x))
    && [input.blocked_at,review.observed_at].every(evidenceTime)
    && review.host_process_exited === true && review.native_operations === 0 && review.business_effects === 0
    && host.protocol === 'standalone-skill-host-proof/v1'
    && host.task_id === input.task_id && host.run_id === runId && [host.task_run_id,host.run_binding_id].every(x=>UUID.test(x??''))
    && commit.test(host.source_commit ?? '') && validPid(host.process_identity.pid) && validPid(host.process_identity.pgid)
    && validPid(host.process_identity.ppid) && Number.isSafeInteger(host.process_identity.uid) && host.process_identity.uid >= 0
    && typeof host.process_identity.start_identity === 'string' && host.process_identity.start_identity.length > 0
    && host.process_identity.start_identity.length <= 200
    && typeof host.run_directory === 'string' && host.run_directory.startsWith('/') && host.run_directory.endsWith('/'+runId)
    && host.run_directory.length <= 1024 && !/[\r\n\0]/.test(host.run_directory));
  if (review.protocol === 'standalone-released-no-effect-review/v1') {
    invalid(revocation === undefined && review.local_lock.owner === null && review.local_lock.review_required === false);
    return { failureReason:businessUnconfirmed, released:verifyReleasedCleanupProof(review,host,input.blocked_at) };
  }
  onlyKeys(revocation, ['protocol',...proofIdentity,'pid','reason','observed_at']);
  invalid((desktopCleanup || review.protocol === 'standalone-pre-native-review/v1') && evidenceTime(revocation.observed_at)
    && review.local_lock.owner === runId && review.local_lock.review_required === true
    && revocation.protocol === 'standalone-skill-host-revocation/v1' && proofIdentity.every(key=>host[key]===revocation[key])
    && revocation.reason === (desktopCleanup ? review.admission_code : 'ADMISSION_REJECTED')
    && revocation.pid === host.process_identity.pid);
  if (desktopCleanup) return { failureReason: desktopCleanupFailure, cleanup: verifyDesktopCleanupProof(review,host), collectionOpenAppTimeout, collectionAccountFallback };
  invalid(review.cleanup_diagnostic === undefined);
  return { failureReason: startFailure, hardwareTimeout: verifyHardwareTimeout(review,input.task_id) };
}

/** Central checks use persistent authority only. Host exit, local fence and effect reads are the authorized operator's observation. */
export async function reconcileStandaloneStartFailure(pool, runId, input, { principal, now = Date.now } = {}) {
  requireFoundation(principal === 'authenticated-operator', 'standalone_start_review_auth_required', 401);
  const { failureReason, hardwareTimeout, cleanup, released, collectionOpenAppTimeout, collectionAccountFallback } = verifyRequest(runId,input);
  const requestSha = digest(input), review = input.review, host = review.host_proof;
  const collection = Boolean(released || collectionOpenAppTimeout || collectionAccountFallback);
  const expectedSource = collection ? 'notion_leadgen_102' : 'notion_leadgen_101';
  const expectedWorkflow = collection ? 'douyin_video_processing' : 'douyin_video_discovery';
  return foundationTransaction(pool, 'notion-standalone:'+input.machine_id, async db => {
    const task = (await db.query("SELECT * FROM tasks WHERE id=$1 AND task_type='workflow_dispatch' AND payload->>'source'=$2 FOR UPDATE",[input.task_id,expectedSource])).rows[0];
    const claim = task?.result?.standalone_claim, receipt = task?.result?.standalone_receipt;
    const attestation = task?.result?.codex_skill_direct, scope = task?.payload?.scope;
    check(claim?.task_id === input.task_id && claim.run_id === runId && claim.machine_id === input.machine_id
      && claim.claimer === 'standalone:'+input.machine_id && claim.tenant_id === task.tenant_id
      && task.payload.foundation_request?.machine_id === input.machine_id && task.payload.execution_mode === 'standalone-skill'
      && receipt?.task_id === task.id && receipt.run_id === runId && receipt.status === 'needs_review' && receipt.reason === failureReason
      && Array.isArray(receipt.evidence) && receipt.evidence.length === 0 && digest(receipt) === input.expected_receipt_sha256
      && attestation?.protocol === 'codex-exec-v1' && attestation.task_id === task.id && attestation.run_id === runId
      && attestation.machine_id === claim.machine_id && attestation.claimer === claim.claimer && attestation.claimed_at === claim.claimed_at
      && digest(attestation) === input.expected_attestation_sha256 && attestation.task_run_id === host.task_run_id
      && attestation.run_binding?.run_binding_id === host.run_binding_id && scope?.workflow_key === expectedWorkflow
      && (!collection || scope.source_run === task.payload.workflow_input?.business?.source_run)
      && scope.source_commit === host.source_commit && scope.company?.tenant_id === task.tenant_id
      && attestation.scope_sha256 === digest({...scope,task_id:task.id})
      && task.blocked_at?.toISOString() === input.blocked_at);
    const collectionProfile=(cleanup?.openAppProof??cleanup?.accountReadProof)?.profile ?? cleanup?.fallbackProfile ?? released?.accountProfile;
    if(collectionProfile!==undefined)check(collectionProfile===scope.profile);
    const preflight = cleanup?.preflightProof, account = cleanup?.accountProof;
    const snapshot = (preflight ?? account)?.snapshot;
    if (snapshot) {
      check(snapshot.company_id===scope.company.company_id && snapshot.tenant_id===scope.company.tenant_id
        && snapshot.version===scope.company.version && snapshot.line_key===scope.line);
    }
    const run = (await db.query('SELECT * FROM task_runs WHERE id=$1 AND task_id=$2 AND run_id=$3 FOR UPDATE',[host.task_run_id,task.id,runId])).rows[0];
    check(run?.context?.source === 'standalone-skill' && run.context.executor_kind === 'codex-exec-v1'
      && run.context.executor === claim.claimer && run.context.claimed_at === claim.claimed_at
      && digest(run.context.scope) === digest(scope) && digest(run.context.skill) === digest(task.payload.skill));
    if (hardwareTimeout) {
      check(hardwareTimeout.startedAt >= +run.started_at
        && hardwareTimeout.finishedAt <= Date.parse(review.revocation.observed_at));
    }
    const response = replayed => ({ task_id:task.id, run_id:runId, status:'failed', retry_safe:false, replayed });
    const previous = task.result.standalone_start_review;
    if (previous) {
      check(task.status === 'failed' && run.status === 'failed' && run.ended_at && previous.request_sha256 === requestSha
        && digest(run.result?.standalone_start_review ?? null) === digest(previous));
      return response(true);
    }
    check(task.status === 'blocked' && task.blocked_reason === 'needs_review' && task.claimed_by === claim.claimer
      && task.claimed_at?.toISOString() === claim.claimed_at && run.status === 'running' && run.ended_at === null
      && Object.keys(run.result ?? {}).length === 0
      && !['native_agent','workflow_control','workflow_common_runner','foundation_runner'].some(key=>Object.hasOwn(task.result,key)));
    const reviewedAt = Date.parse(review.observed_at), revokedAt = Date.parse(review.revocation?.observed_at), blockAt = Date.parse(input.blocked_at), at = now();
    check((released || revokedAt >= +run.started_at && revokedAt <= blockAt) && reviewedAt >= blockAt
      && reviewedAt <= at+5000 && at-reviewedAt <= 300000, 'standalone_start_review_stale');

    // Lock the immutable binding too, to order the check relative to FK-bound span ingestion.
    const [bindingRow] = (await db.query('SELECT id FROM run_definition_bindings WHERE run_id=$1 FOR UPDATE',[runId])).rows;
    const original = bindingRow && await getRunDefinitionBinding(db,runId);
    const binding = original?.binding, ref = attestation.run_binding, definition = claim.definition;
    check(binding?.id === host.run_binding_id && binding.source_kind === 'internal' && binding.task_run_id === run.id
      && binding.actor === claim.claimer && binding.attempt_key === `${task.id}:1` && binding.attempt_key === ref.attempt_key
      && run.workflow_id === binding.workflow_id && original.workflow?.source_commit === host.source_commit
      && ['release_id','observation_id','workflow_id','workflow_definition_version_id','snapshot_sha256'].every(key=>binding[key]===definition?.[key])
      && binding.workflow_id === ref.workflow_id && binding.workflow_definition_version_id === ref.workflow_definition_version_id);
    const serial = scope.serial;
    check(typeof serial === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(serial));
    const locks = (await db.query('SELECT device_name,locked_by,xmin::text AS lease_version FROM device_locks WHERE device_name=$1 OR locked_by IN ($2,$3) FOR UPDATE',[serial,task.id,runId])).rows;
    const [deviceLock] = locks;
    check(locks.length === 1 && deviceLock.device_name === serial
      && (deviceLock.locked_by === null || cleanup && !collectionOpenAppTimeout && deviceLock.locked_by === task.id)
      && (!cleanup || cleanup.serial === serial && cleanup.firstIntentAt >= +run.started_at
        && cleanup.leaseVersion === deviceLock.lease_version)
      && (!released || released.firstIntentAt >= +run.started_at && released.leaseVersion === deviceLock.lease_version),
    'standalone_start_review_active_resources');
    const { active } = (await db.query(`SELECT
      EXISTS (SELECT 1 FROM task_runs WHERE task_id=$1 AND run_id<>$2 AND ended_at IS NULL)
      OR EXISTS (SELECT 1 FROM task_leases WHERE task_id=$1 AND released_at IS NULL)
      OR EXISTS (SELECT 1 FROM spans WHERE run_id=$2)
      OR EXISTS (SELECT 1 FROM commander_activity_actions WHERE run_id=$2::uuid)
      OR EXISTS (SELECT 1 FROM pending_actions WHERE status='pending_approval' AND (expires_at IS NULL OR expires_at>NOW())
        AND (params->>'task_id'=$1::text OR params->>'run_id'=$2 OR params->>'device_name'=$3)) AS active`,[task.id,runId,serial])).rows[0];
    check(active === false,'standalone_start_review_active_resources');
    const releaseCentral = Boolean(cleanup && deviceLock.locked_by === task.id);
    if (releaseCentral) {
      const released = await db.query(`UPDATE device_locks SET locked_by=NULL, locked_at=NULL, expires_at=NULL
        WHERE device_name=$1 AND locked_by=$2 AND xmin::text=$3 RETURNING device_name`,[serial,task.id,cleanup.leaseVersion]);
      check(released.rowCount === 1,'standalone_start_review_active_resources');
    }

    const settlement = { protocol:'standalone-start-failure-settlement/v1', source:principal, task_id:task.id, run_id:runId,
      task_run_id:run.id, run_binding_id:binding.id, receipt_sha256:input.expected_receipt_sha256,
      attestation_sha256:input.expected_attestation_sha256, request_sha256:requestSha, retry_safe:false,
      observed_at:review.observed_at, evidence_sha256:review.evidence_sha256,
      host_proof_sha256:digest(host), admission_code:review.admission_code,
      ...(review.revocation ? { revocation_sha256:digest(review.revocation) } : {}),
      ...(hardwareTimeout ? { hardware_diagnostic_sha256:hardwareTimeout.sha256 } : {}),
      ...((cleanup ?? released)?.ledgerSha256 ? { cleanup_ledger_sha256:(cleanup ?? released).ledgerSha256 } : {}),
      ...(preflight ? { preflight_timeout_sha256:preflight.sha256 } : {}),
      ...(account ? { account_foreground_refusal_sha256:account.sha256 } : {}),
      ...(cleanup?.openAppProof ? { collection_open_app_timeout_sha256:cleanup.openAppProof.sha256 } : {}),
      ...(cleanup?.accountReadProof ? { collection_account_read_timeout_sha256:cleanup.accountReadProof.sha256 } : {}),
      ...(collectionAccountFallback ? { collection_account_fallback_cleanup_sha256:cleanup.ledgerSha256 } : {}),
      ...(snapshot ? { company_snapshot:snapshot } : {}),
      ...(cleanup || released ? { cleanup_diagnostic_sha256:(cleanup ?? released).sha256, observed_central_lease_version:(cleanup ?? released).leaseVersion,
        central_release_performed:releaseCentral } : {}) };
    const finished = await finishRun({runId,status:'failed',error:failureReason,result:{standalone_start_review:settlement}},
      {pool:db,strict:true,emit:async()=>{}});
    check(finished.updated,'standalone_start_review_write_unconfirmed');
    const closed = await finalizeTask(db,task.id,'failed',{relay:false,onlyIfStatus:'blocked',set:{completed_at:'now'},
      mergeResult:{standalone_start_review:settlement},standaloneStartFailureReconciliation:{runId,requestSha,receiptReason:failureReason,collectionOpenAppTimeout,collectionAccountFallback}});
    check(closed.rowCount === 1,'standalone_start_review_write_unconfirmed');
    return response(false);
  });
}
