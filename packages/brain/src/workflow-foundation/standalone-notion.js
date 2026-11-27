import { randomUUID } from 'node:crypto';
import { getRunDefinitionBinding } from '../lib/run-definition-binding.js';
import { afterTerminalTransition, finalizeTask } from '../lib/task-terminal.js';
import { finishRun } from '../lib/task-run.js';
import { digest } from '../orchestrator/commander-decision.js';
import { UUID, requireFoundation, onlyKeys } from './contracts.js';
import { validateMachineRequest } from './claim.js';
import { foundationTransaction } from './registry.js';
import { resolveStandaloneRelease } from './standalone-release.js';
import { resolveBilibiliVerification } from './standalone-bilibili.js';
import { bilibiliVerificationSource, standaloneSourceList, standaloneSources, standaloneWorkerSourceList, standaloneWorkerSources, standaloneWorkflows } from './standalone-source.js';

const boundSource = `payload->>'source' IN (${standaloneSourceList}) AND task_type='workflow_dispatch'`;
const boundWorkerSource = `payload->>'source' IN (${standaloneWorkerSourceList}) AND task_type='workflow_dispatch'`;

export async function claimStandaloneNotionTask(pool, input) {
  validateMachineRequest(input, ['machine_id','sources','task_id']);
  const sources = input.sources ?? [standaloneSources[0]];
  requireFoundation(Array.isArray(sources) && sources.length > 0 && sources.length <= standaloneWorkerSources.length
    && new Set(sources).size === sources.length && sources.every(source => standaloneWorkerSources.includes(source)), 'standalone_worker_sources_invalid', 400);
  const exactVerification=sources.length===1&&sources[0]===bilibiliVerificationSource;
  requireFoundation(exactVerification ? UUID.test(input.task_id??'')
    : input.task_id===undefined&&!sources.includes(bilibiliVerificationSource), 'standalone_worker_task_scope_invalid',400);
  const machine = input.machine_id;
  return foundationTransaction(pool, 'notion-standalone:' + machine, async db => {
    // 103 has no phone resources. A review hold on the handset must not reserve the scorer.
    const row = (await db.query(`SELECT candidate.* FROM tasks candidate WHERE ${boundWorkerSource} AND status='queued' AND claimed_by IS NULL
      AND payload#>>'{foundation_request,machine_id}'=$1 AND payload->>'source'=ANY($2::text[])
      AND ($4::uuid IS NULL OR candidate.id=$4::uuid)
      AND NOT EXISTS (SELECT 1 FROM tasks active WHERE ${boundWorkerSource}
        AND active.result#>>'{standalone_claim,machine_id}'=$1 AND active.status IN ('in_progress','blocked')
        AND (active.payload->>'source'=$3)=(candidate.payload->>'source'=$3))
      ORDER BY created_at,id LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED`, [machine,sources,'notion_leadgen_103',input.task_id??null])).rows[0];
    if (!row) return { job: null };

    const stage = row.payload.source.slice(-3);
    const verification = row.payload.source === bilibiliVerificationSource;
    const fixed = verification ? await resolveBilibiliVerification(db, row.payload.workflow_definition)
      : await resolveStandaloneRelease(db, row.payload.workflow_definition, standaloneWorkflows[stage]);
    requireFoundation(fixed.machine_id === machine
      && fixed.definition.workflow_definition_version_id === row.payload.workflow_definition.workflow_definition_version_id
      && fixed.definition.snapshot_sha256 === row.payload.workflow_definition.snapshot_sha256, 'standalone_release_changed');
    if (verification) requireFoundation(digest(row.payload.workflow_input) === digest({scope:fixed.scope,skill:fixed.skill}),
      'bilibili_verification_scope_invalid');
    const claimedAt = new Date().toISOString();
    const job = {
      claimer: 'standalone:' + machine, claimed_at: claimedAt,
      task_id: row.id, run_id: randomUUID(), machine_id: machine, tenant_id: row.tenant_id,
      release_id: fixed.definition.release_id, definition: fixed.definition, input: row.payload.workflow_input,
      ...(stage === '101' ? {} : { workflow_key: fixed.row.key }),
    };
    await db.query(`UPDATE tasks SET status='in_progress',claimed_by=$2,claimed_at=$4::timestamptz,started_at=$4::timestamptz,updated_at=NOW(),
      status_history=COALESCE(status_history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('from','queued','to','in_progress','source','standalone_notions','changed_at',NOW())),
      result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('standalone_claim',$3::jsonb) WHERE id=$1`,
    [row.id, job.claimer, JSON.stringify(job), claimedAt]);
    return { job };
  });
}

const identityFields = [
  'protocol','task_id','run_id','claimer','claimed_at','machine_id','profile_sha256',
  'skill','scope_sha256','run_binding','task_run_id','company','approved_keywords',
];

export async function attestStandaloneNotionTask(pool, input) {
  validateMachineRequest(input, ['machine_id','identity']);
  const identity = input.identity;
  onlyKeys(identity, identityFields);
  requireFoundation(UUID.test(identity.task_id) && UUID.test(identity.run_id)
    && UUID.test(identity.company?.company_id) && UUID.test(identity.company?.tenant_id)
    && Number.isSafeInteger(identity.company?.version) && identity.company.version > 0
    && typeof identity.company.policy_id === 'string' && identity.company.policy_id.trim()
    && identity.protocol === 'codex-exec-v1' && /^[a-f0-9]{64}$/.test(identity.profile_sha256 ?? ''),
  'standalone_attestation_invalid', 400);

  return foundationTransaction(pool, 'notion-standalone:' + input.machine_id, async db => {
    const task = (await db.query(`SELECT * FROM tasks WHERE ${boundSource} AND id=$1 FOR UPDATE`, [identity.task_id])).rows[0];
    const claim = task?.result?.standalone_claim;
    const scope = task?.payload?.scope;
    requireFoundation(task?.status === 'in_progress' && scope && identity.skill && identity.company
      && claim?.run_id === identity.run_id && claim.machine_id === input.machine_id && identity.machine_id === input.machine_id
      && identity.claimer === task.claimed_by && identity.claimed_at === claim.claimed_at
      && digest(identity.skill) === digest(task.payload.skill)
      && digest(identity.company) === digest(scope.company ?? null)
      && digest(identity.approved_keywords ?? null) === digest(scope.approved_keywords)
      && identity.scope_sha256 === digest({ ...scope, task_id: task.id }), 'standalone_attestation_conflict');
    const observation = await getRunDefinitionBinding(db, identity.run_id);
    const binding = observation?.binding;
    const ref = identity.run_binding;
    onlyKeys(ref, ['run_binding_id','source_kind','workflow_id','workflow_definition_version_id','attempt_key','activities']);
    const activities = observation?.workflow.payload.activities.map(activity => [activity.slot_key, {
      reference_id: activity.reference_id,
      activity_id: activity.activity_id,
      activity_definition_version_id: activity.activity_version_id,
    }]);
    requireFoundation(activities && (!ref.source_kind || ref.source_kind === 'internal')
      && digest(ref.activities ?? null) === digest(Object.fromEntries(activities)), 'standalone_attestation_conflict');
    requireFoundation(binding?.source_kind === 'internal' && binding.id === ref?.run_binding_id
      && binding.release_id === claim.release_id && binding.task_run_id === identity.task_run_id
      && binding.workflow_id === ref.workflow_id && binding.workflow_definition_version_id === ref.workflow_definition_version_id
      && binding.attempt_key === ref.attempt_key, 'standalone_run_unconfirmed');
    const run = (await db.query(`SELECT id FROM task_runs WHERE id=$1 AND task_id=$2 AND run_id=$3
      AND status='running' AND ended_at IS NULL AND context->>'source'='standalone-skill'`,
    [identity.task_run_id, task.id, identity.run_id])).rows[0];
    requireFoundation(run, 'standalone_run_unconfirmed');
    const previous = task.result.codex_skill_direct;
    requireFoundation(!previous || digest(previous) === digest(identity), 'standalone_attestation_conflict');
    if (!previous) await db.query("UPDATE tasks SET result=result||jsonb_build_object('codex_skill_direct',$2::jsonb),updated_at=NOW() WHERE id=$1",
      [task.id, JSON.stringify(identity)]);
    return { attested: true };
  });
}

function checkedReceipt(receipt) {
  onlyKeys(receipt, ['task_id', 'run_id', 'status', 'summary', 'evidence', 'reason']);
  const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
  requireFoundation(UUID.test(receipt.task_id) && UUID.test(receipt.run_id)
    && ['completed','needs_review'].includes(receipt.status)
    && Array.isArray(receipt.evidence) && receipt.evidence.length <= 20 && receipt.evidence.every(ref => text(ref, 2000))
    && (receipt.status === 'completed' ? text(receipt.summary, 1900) && receipt.evidence.length : text(receipt.reason, 200)),
  'standalone_receipt_invalid', 400);
  return receipt;
}

export async function finishStandaloneNotionTask(pool, input) {
  validateMachineRequest(input, ['machine_id', 'receipt']);
  const receipt = checkedReceipt(input.receipt);
  const outcome = await foundationTransaction(pool, 'notion-standalone:' + input.machine_id, async db => {
    const task = (await db.query(`SELECT * FROM tasks WHERE ${boundWorkerSource} AND id=$1 FOR UPDATE`, [receipt.task_id])).rows[0];
    const claim = task?.result?.standalone_claim;
    requireFoundation(claim?.run_id === receipt.run_id && claim.machine_id === input.machine_id, 'standalone_claim_conflict');
    const verification = task.payload.source === bilibiliVerificationSource;
    const status = receipt.status === 'completed' ? 'completed' : 'blocked';
    const stored = task.result.standalone_receipt;
    if (stored) {
      const reviewedSource = task.payload.source === 'notion_leadgen_101'
        || task.payload.source === 'notion_leadgen_102' && (receipt.reason === 'standalone_business_unconfirmed'
          || receipt.reason === 'standalone_cleanup_unconfirmed'
            && /^[a-f0-9]{64}$/.test(task.result.standalone_start_review?.collection_open_app_timeout_sha256 ?? ''));
      const reviewedStart = task.status === 'failed' && status === 'blocked' && reviewedSource
        && task.result.standalone_start_review?.protocol === 'standalone-start-failure-settlement/v1'
        && task.result.standalone_start_review.run_id === receipt.run_id
        && task.result.standalone_start_review?.receipt_sha256 === digest(receipt);
      requireFoundation((task.status === status || reviewedStart) && digest(stored) === digest(receipt), 'standalone_receipt_conflict');
      return { status, replayed:true };
    }
    requireFoundation(task.status === 'in_progress' && task.claimed_by === 'standalone:' + input.machine_id, 'standalone_claim_conflict');

    // The trusted provider boots its original run via start-skill. A worker cannot
    // settle a completed job just by returning a model response.
    if (status === 'completed') {
      const proof = task.result.bilibili_verification;
      requireFoundation(verification ? proof?.run_id === receipt.run_id
        && digest(receipt.evidence) === digest([proof.evidence])
        : task.result.codex_skill_direct?.run_id === receipt.run_id, 'standalone_run_unconfirmed');
      const run = (await db.query(`SELECT id FROM task_runs WHERE task_id=$1 AND run_id=$2
        AND status='running' AND ended_at IS NULL AND context->>'source'='standalone-skill' FOR UPDATE`,
      [task.id, receipt.run_id])).rows[0];
      requireFoundation(run && (!verification || run.id === proof.task_run_id), 'standalone_run_unconfirmed');
      const closed = await finishRun({ runId: receipt.run_id, status: 'success', result: receipt },
        { pool: db, strict: true, emit: async () => {} });
      requireFoundation(closed.updated, 'standalone_run_unconfirmed');
      const result=await finalizeTask(db,task.id,'completed',{
        relay:false, onlyIfStatus:'in_progress', mergeResult:{standalone_receipt:receipt},
        standaloneReconciliation:{runId:receipt.run_id},
      });
      requireFoundation(result.rowCount===1,'standalone_run_unconfirmed');
    } else {
      await db.query(`UPDATE tasks SET status='blocked',error_message=$2,updated_at=NOW(),
        blocked_reason='needs_review',blocked_at=NOW(),
        status_history=COALESCE(status_history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('from',status,'to','blocked','source','standalone_notions','changed_at',NOW())),
        result=result||jsonb_build_object('standalone_receipt',$3::jsonb) WHERE id=$1`,
      [task.id, receipt.reason, JSON.stringify(receipt)]);
    }
    return { status, replayed:false, relay:!verification };
  });
  if (outcome.status === 'completed' && !outcome.replayed && outcome.relay) await afterTerminalTransition(pool,receipt.task_id,outcome.status);
  return { status:outcome.status };
}
