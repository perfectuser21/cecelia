import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { internalAuth } from '../middleware/internal-auth.js';
import { evidenceHash, evaluateReleaseObservation } from '../lib/release-index.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const repo = 'perfectuser21/zenithjoy-workspace';
const device = '47.100.213.173:10001';
const profile = 'cloud-phone-test';
// The Cloud 101 epoch record pins this blocked predecessor independently of the successor.
const originalTaskId = '0874e3fc-b7c2-46a6-b97e-cdc1264a693c';
const idFields = ['task_id', 'binding_id', 'release_id', 'observation_id', 'original_task_id', 'review_task_id'];
const queryFields = [...idFields, 'device_name', 'profile', 'profile_sha256', 'source_commit'];
const reviewFields = ['work_kind', 'reviewer', 'business_run_id', 'candidate_source_commit', 'original_record_sha256', 'development_task_id'];
const shipFields = ['schema_version', 'stage', 'task_id', 'repo', 'head_sha', 'actor'];
const bindingFields = ['id', 'run_id', 'source_kind', 'workflow_id', 'workflow_definition_version_id', 'attempt_key', 'task_run_id', 'release_id', 'observation_id'];
const taskRunFields = ['id', 'task_id', 'run_id', 'status', 'ended_at'];
const runFields = ['run_id', 'task_id', 'machine_id', 'profile_sha256', 'mode'];
const runBindingFields = ['run_binding_id', 'workflow_id', 'workflow_definition_version_id', 'attempt_key'];
const activityFields = ['reference_id', 'activity_id', 'activity_definition_version_id'];
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source?.[key]]));
const iso = value => new Date(value).toISOString();

const exactSnapshot = `
  SELECT jsonb_build_object('id',b.id,'run_id',b.run_id,'source_kind',b.source_kind,
           'workflow_id',b.workflow_id,'workflow_definition_version_id',b.workflow_definition_version_id,
           'attempt_key',b.attempt_key,'task_run_id',b.task_run_id,'release_id',b.release_id,
           'observation_id',b.observation_id,'payload',jsonb_build_object(
             'runtime_snapshot_sha256',b.payload->'runtime_snapshot_sha256')) AS binding,
         jsonb_build_object('id',r.id,'task_id',r.task_id,'run_id',r.run_id,
           'status',r.status,'ended_at',r.ended_at) AS task_run,
         jsonb_build_object('id',t.id,'status',t.status,'claimed_by',t.claimed_by,
           'claimed_at',t.claimed_at,'common_runner',t.result->'common_runner') AS task,
         jsonb_build_object('device_name',l.device_name,'locked_by',l.locked_by,'locked_at',l.locked_at,
           'expires_at',l.expires_at,'lease_version',l.xmin::text,
           'expired',l.expires_at < statement_timestamp()) AS central,
         jsonb_build_object('id',original.id,'status',original.status,'execution_stopped',
           original.result->'execution_stopped') AS original_task,
         jsonb_build_object('id',review.id,'status',review.status,'task_type',review.task_type,
           'parent_task_id',review.parent_task_id,'payload',review.payload,'actor',review.result->'actor',
           'audit_evidence',review.result->'audit_evidence',
           'compatibility_receipt',review.result->'epoch_source_compatibility') AS review,
         jsonb_build_object('id',dev.id,'task_type',dev.task_type,
           'requested_task_type',dev.payload->'requested_task_type','work_kind',dev.payload->'work_kind',
           'merge_sha',dev.result->'merge_sha','ship_candidate',dev.result->'ship_candidate') AS development,
         jsonb_build_object('id',v.id,'target',v.target,'environment',v.environment,'manifest_sha256',v.manifest_sha256,
           'payload',jsonb_build_object('components',v.payload->'components',
             'verification',v.payload->'verification')) AS release,
         jsonb_build_object('id',o.id,'release_id',o.release_id,'collector',o.collector,'evidence_ref',o.evidence_ref,
           'payload_sha256',o.payload_sha256,'payload',jsonb_build_object('environment',o.payload->'environment',
             'target',o.payload->'target','components',o.payload->'components')) AS observation
  FROM run_definition_bindings b
  JOIN task_runs r ON r.id=b.task_run_id AND r.run_id=b.run_id AND r.workflow_id=b.workflow_id
  JOIN tasks t ON t.id=r.task_id
  JOIN workflow_definition_versions w ON w.id=b.workflow_definition_version_id AND w.workflow_id=b.workflow_id
  JOIN device_locks l ON l.device_name=$7 AND l.locked_by=t.id::text
  JOIN tasks original ON original.id=$9
  JOIN tasks review ON review.id=$10 AND review.status='completed' AND review.task_type='research'
  JOIN tasks dev ON dev.id=review.parent_task_id AND dev.id::text=review.payload->>'development_task_id'
  JOIN release_versions v ON v.id=b.release_id
  JOIN LATERAL (
    SELECT id, release_id, collector, evidence_ref, payload_sha256, payload
    FROM release_observations
    WHERE release_id=v.id OR (payload->>'environment'=v.environment AND payload->>'target'=v.target)
    ORDER BY observed_at DESC, created_at DESC, id DESC
    LIMIT 1
  ) o ON o.id=b.observation_id AND o.release_id=v.id
  WHERE b.run_id=$1 AND t.id=$2 AND b.id=$3 AND b.release_id=$4 AND b.observation_id=$5
    AND b.source_kind='internal' AND r.status='running' AND r.ended_at IS NULL
    AND t.status='in_progress' AND t.claimed_by='common-runner' AND t.claimed_at IS NOT NULL
    AND t.payload->>'profile'=$8 AND t.payload->>'serial'=$7 AND t.payload->>'source_commit'=$6
    AND t.result->'common_runner'->>'profile_sha256'=$11
    AND original.status='blocked' AND original.result->'execution_stopped' IS DISTINCT FROM 'true'::jsonb
    AND l.expires_at > statement_timestamp() + interval '1 second'
    AND w.payload->>'key'='douyin_video_discovery'
    AND v.environment='staging:' || $6 AND v.target='mmv'`;

function project(row, scope) {
  const { binding, task, task_run:taskRun, central, original_task:originalTask, review, development, release, observation } = row;
  const common = task.common_runner, runBinding = common?.run_binding, activities = Object.entries(runBinding?.activities ?? {});
  const receipt = review.compatibility_receipt, audit = review.audit_evidence, ship = development.ship_candidate;
  const validRunner = common?.run_id === scope.run_id && common.task_id === scope.task_id && common.mode === 'formal'
    && common.machine_id === 'us-mac-m4' && runBinding?.run_binding_id === binding.id
    && runBinding.workflow_id === binding.workflow_id && runBinding.workflow_definition_version_id === binding.workflow_definition_version_id
    && runBinding.attempt_key === binding.attempt_key && activities.length > 0 && activities.length <= 20
    && activities.every(([key, value]) => /^[a-z_][a-z0-9_]{0,119}$/i.test(key)
      && activityFields.every(field => uuid.test(value?.[field] ?? '')))
    && hash.test(binding.payload?.runtime_snapshot_sha256 ?? '') && /^[1-9]\d{0,9}$/.test(central.lease_version);
  const p = review.payload;
  const validReview = ['epoch_source_compatibility_review', 'coding_review'].includes(p?.work_kind)
    && typeof review.actor === 'string' && review.actor.trim() && review.actor !== task.claimed_by && p.reviewer === review.actor
    && p.business_run_id === scope.run_id && p.candidate_source_commit === scope.source_commit
    && hash.test(p.original_record_sha256 ?? '') && audit?.verdict === 'pass' && typeof audit.path === 'string' && audit.path.trim()
    && hash.test(audit.sha256 ?? '') && Array.isArray(receipt?.evidence_refs) && receipt.evidence_refs.includes(audit.path)
    && receipt.protocol === 'cloud-101-epoch-source-compatibility/v1'
    && receipt.business_run_id === scope.run_id && receipt.original_record_sha256 === p.original_record_sha256
    && receipt.actor === review.actor && receipt.serial === scope.device_name && receipt.instance_id === 'mmv-cloud-epoch2'
    && receipt.candidate_manifest_sha256 === binding.payload.runtime_snapshot_sha256
    && receipt.candidate_runtime_source?.commit === scope.source_commit && receipt.release_id === release.id
    && receipt.observation_id === observation.id && receipt.candidate_release_manifest_sha256 === release.manifest_sha256
    && development.id !== task.id
    && (development.task_type === 'dev' || (development.task_type === 'harness_initiative'
      && development.requested_task_type === 'dev' && development.work_kind === 'coding_mutation'))
    && ship?.schema_version === 1 && ship.stage === 'candidate' && ship.task_id === development.id && ship.repo === repo
    && [ship.head_sha, development.merge_sha].includes(scope.source_commit)
    && typeof ship.actor === 'string' && ship.actor.trim() && ship.actor !== review.actor;
  if (!validRunner || !validReview || !hash.test(release.manifest_sha256) || !hash.test(observation.payload_sha256)
      || !release.payload.components?.some(c => c.kind === 'repo' && c.repo === repo && c.revision === scope.source_commit)) return null;
  const current = evaluateReleaseObservation(release, observation);
  const verification = pick(release.payload.verification, ['status', 'ci_status']);
  const releaseComponents = evidenceHash(release.payload.components);
  const observationComponents = evidenceHash(observation.payload.components);
  if (!current.deployed || verification.status !== 'verified' || verification.ci_status !== 'verified'
      || releaseComponents !== observationComponents) return null;
  return {
    task: { ...pick(task, ['id', 'status', 'claimed_by']), claimed_at: iso(task.claimed_at), result: {
      common_runner: { ...pick(common, runFields), run_binding: { ...pick(runBinding, runBindingFields),
        activities: Object.fromEntries(activities.map(([key, value]) => [key, pick(value, activityFields)])) } },
    } },
    binding: { ...pick(binding, bindingFields), payload: pick(binding.payload, ['runtime_snapshot_sha256']) },
    links: { task_id: taskRun.task_id, task_run_id: taskRun.id },
    taskRun: pick(taskRun, taskRunFields),
    central: { ...central, locked_at: iso(central.locked_at), expires_at: iso(central.expires_at) },
    originalTask: { id: originalTask.id, status: originalTask.status, result: { execution_stopped: originalTask.execution_stopped } },
    compatibilityReview: { ...pick(review, ['id', 'status', 'task_type', 'parent_task_id']), payload: pick(p, reviewFields),
      result: { actor: review.actor, audit_evidence: pick(audit, ['path', 'sha256', 'verdict']),
        epoch_source_compatibility_sha256: evidenceHash(receipt) } },
    compatibilityDevelopment: { ...pick(development, ['id', 'task_type']),
      payload: pick(development, ['requested_task_type', 'work_kind']),
      result: { merge_sha: development.merge_sha, ship_candidate: pick(ship, shipFields) } },
    compatibilityRelease: { release_id: release.id, observation_id: observation.id,
      environment: release.environment, target: release.target, source_commit: scope.source_commit,
      manifest_sha256: release.manifest_sha256, observation_payload_sha256: observation.payload_sha256,
      release_components_sha256: releaseComponents, observation_components_sha256: observationComponents,
      gate: { release_id: release.id, current_observation_id: observation.id, current_status: 'deployed', ...current, verification } },
  };
}

async function readSnapshot(pool, scope) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '2s'");
    const { rows } = await client.query(exactSnapshot, [
      scope.run_id, scope.task_id, scope.binding_id, scope.release_id, scope.observation_id,
      scope.source_commit, scope.device_name, scope.profile, scope.original_task_id, scope.review_task_id, scope.profile_sha256,
    ]);
    const snapshot = rows.length === 1 ? project(rows[0], scope) : null;
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createCloud101AdmissionRouter({ pool }) {
  const router = Router({ strict: true });
  const authLimiter = rateLimit({ windowMs: 1000, limit: 48, standardHeaders: false, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'CLOUD_101_ADMISSION_AUTH_RATE_LIMIT' }) });
  const limiter = rateLimit({ windowMs: 1000, limit: 24, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: () => 'cloud-101-admission', handler: (_req, res) => res.status(429).json({ error: 'CLOUD_101_ADMISSION_RATE_LIMIT' }) });
  let inFlight = 0;
  router.get('/:run_id', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.set('Allow', 'GET').sendStatus(405);
    return next();
  }, authLimiter, (req, res, next) => {
    if (!process.env.CECELIA_INTERNAL_TOKEN) return res.status(503).json({ error: 'CLOUD_101_ADMISSION_AUTH_UNCONFIGURED' });
    return internalAuth(req, res, next);
  }, limiter, async (req, res) => {
    const q = req.query, runId = req.params.run_id;
    if (Object.keys(q).length !== queryFields.length || queryFields.some(k => typeof q[k] !== 'string')
      || !uuid.test(runId) || idFields.some(k => !uuid.test(q[k]))
      || new Set([q.task_id, q.original_task_id, q.review_task_id]).size !== 3
      || q.device_name !== device || q.profile !== profile || q.original_task_id !== originalTaskId || !sha.test(q.source_commit) || !hash.test(q.profile_sha256)) {
      return res.status(400).json({ error: 'CLOUD_101_ADMISSION_SCOPE' });
    }
    if (inFlight >= 8) return res.status(503).json({ error: 'CLOUD_101_ADMISSION_BUSY' });
    inFlight += 1;
    try {
      const snapshot = await readSnapshot(pool, { ...q, run_id: runId });
      if (!snapshot) return res.status(409).json({ error: 'CLOUD_101_ADMISSION_UNPROVEN' });
      return res.json({ protocol: 'cloud-101-admission-snapshot/v1', ...snapshot });
    } catch {
      return res.status(503).json({ error: 'CLOUD_101_ADMISSION_UNAVAILABLE' });
    } finally {
      inFlight -= 1;
    }
  });
  router.all('/:run_id', (_req, res) => res.set('Allow', 'GET').set('Cache-Control', 'no-store').sendStatus(405));
  return router;
}
