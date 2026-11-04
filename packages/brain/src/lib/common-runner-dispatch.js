import fs from 'node:fs';
import {resourceFreeReview} from './common-runner-review.js';
import { isAbsolute } from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { directory, endpointValid } from '../execution-directory/directory.js';
import { authorize, resolveCleanup, transaction } from '../execution-directory/store.js';
import { startRun as startCentralRun, finishRun as finishCentralRun } from './task-run.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
import { resolveMachineId } from '../machine-registry.js';
import { isIsolatedRuntime } from '../runtime-safety.js';
import { readRunReconciliation } from '../routes/run-reconciliation.js';
import { readTickDispatchEnabled } from '../tick-dispatch-gate.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const PROFILE = /^[a-z][a-z0-9-]{0,63}$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (message, status = 409) => { throw Object.assign(Error(message), { status }); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex');
const inputKeys = new Set(['task_id', 'profile', 'input', 'mode']);
async function assertCommonRunnerStartAllowed(env, pool) {
  if (isIsolatedRuntime(env)) fail('common_runner_runtime_isolated', 503);
  if (!await readTickDispatchEnabled(pool, env)) fail('common_runner_dispatch_paused', 503);
  const { isDraining } = await import('../drain.js');
  if (isDraining()) fail('common_runner_dispatch_paused', 503);
}

/** Operator-owned routing; callers cannot supply endpoints, commands or credentials. */
export function loadCommonRunnerProfiles(filename) {
  if (!filename) return {};
  if (typeof filename !== 'string' || !isAbsolute(filename)) fail('common_runner_profiles_untrusted');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077) !== 0
      || (stat.uid !== 0 && stat.uid !== process.getuid?.())) fail('common_runner_profiles_untrusted');
    const config = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!object(config) || Object.keys(config).some(key => key !== 'profiles') || !object(config.profiles)) fail('common_runner_profiles_invalid');
    for (const [key, value] of Object.entries(config.profiles)) {
      if (!PROFILE.test(key) || !object(value) || Object.keys(value).some(k => !['machine_id', 'profile_sha256'].includes(k))
        || typeof value.machine_id !== 'string' || !value.machine_id || !HASH.test(value.profile_sha256)) fail('common_runner_profiles_invalid');
    }
    return config.profiles;
  } finally { fs.closeSync(fd); }
}

export async function httpTransport({ endpoint, action, runId, body, token, fetchFn = fetch, timeoutMs = 20000, allowLoopbackForTests = false }) {
  if (!endpointValid(endpoint) || typeof token !== 'string' || token.length < 32) fail('common_runner_transport_unconfigured', 503);
  const url = new URL(endpoint);
  const octets = url.hostname.split('.');
  // No DNS resolution or arbitrary directory URL can receive the control credential.
  const tailnet = octets.length === 4 && octets.every(part => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)
    && Number(octets[0]) === 100 && Number(octets[1]) >= 64 && Number(octets[1]) <= 127 && url.port === '5231';
  const fixture = allowLoopbackForTests === true && process.env.NODE_ENV === 'test'
    && url.hostname === '127.0.0.1' && Number(url.port) > 0 && Number(url.port) <= 65535;
  if ((!tailnet && !fixture) || (endpoint !== url.origin && endpoint !== `${url.origin}/`)) fail('common_runner_transport_unconfigured', 503);
  if (!UUID.test(runId) || !['start', 'inspect', 'cancel', 'flush'].includes(action)) fail('common_runner_request_invalid', 400);
  url.pathname = `/workflows/${encodeURIComponent(runId)}/${encodeURIComponent(action)}`;
  const response = await fetchFn(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
  });
  let bytes = 0; const chunks = [];
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length; if (bytes > 262144) fail('common_runner_response_oversized'); chunks.push(chunk);
  }
  if (!response.ok) fail(`common_runner_worker_http_${response.status}`, response.status === 409 ? 409 : 503);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function verifyEnvelope(envelope, expected, token) {
  const receipt = envelope?.receipt;
  if (!object(receipt) || typeof envelope.signature !== 'string' || !HASH.test(envelope.signature)) fail('common_runner_receipt_unverified');
  const signature = createHmac('sha256', token).update(JSON.stringify(receipt)).digest('hex');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(envelope.signature))
    || ['run_id', 'task_id', 'machine_id', 'request_nonce', 'profile_sha256', 'mode'].some(key => receipt[key] !== expected[key])) fail('common_runner_receipt_unverified');
  return receipt;
}

export function commonRunnerFormalBinding(definition, runId) {
  const b = definition?.binding;
  if (!b || b.run_id !== runId || b.source_kind !== 'internal'
    || ![b.id, b.workflow_id, b.workflow_definition_version_id].every(value => UUID.test(value ?? ''))
    || typeof b.attempt_key !== 'string' || !b.attempt_key) fail('common_runner_formal_binding_required');
  const activities = {};
  for (const ref of definition.workflow?.payload?.activities ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref.slot_key ?? '') || Object.hasOwn(activities, ref.slot_key)
      || ![ref.reference_id, ref.activity_id, ref.activity_version_id].every(value => UUID.test(value ?? ''))
      || !definition.activities?.some(a => a.id === ref.activity_version_id && a.activity_id === ref.activity_id)) fail('common_runner_formal_binding_required');
    Object.defineProperty(activities, ref.slot_key, { enumerable: true, value: {
      reference_id: ref.reference_id, activity_id: ref.activity_id, activity_definition_version_id: ref.activity_version_id,
    } });
  }
  if (!Object.keys(activities).length) fail('common_runner_formal_binding_required');
  return { run_binding_id: b.id, workflow_id: b.workflow_id,
    workflow_definition_version_id: b.workflow_definition_version_id, attempt_key: b.attempt_key, activities };
}

export function createCommonRunnerDispatcher({ pool, env = process.env, profiles,
  token = env.KERNEL_FLEET_BRIDGE_TOKEN, transport = httpTransport, authorizeExecution = authorize,
  allowLoopbackForTests = false, taskPolicy,
  resolveBoundNode = resolveCleanup, executionDirectory = directory, startRun = startCentralRun,
  finishRun = finishCentralRun,
  assertCanStart = db => assertCommonRunnerStartAllowed(env, db),
  readReconciliation = readRunReconciliation,
  readDefinition = getRunDefinitionBinding } = {}) {
  async function persist(db, taskId, binding, { activate = true } = {}) {
    const result = await db.query(`UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb,
      ${activate ? `status='in_progress',claimed_by=COALESCE(claimed_by,'common-runner'),claimed_at=COALESCE(claimed_at,NOW()),
      executor_kind='script',
      started_at=COALESCE(started_at,NOW()),` : ''}updated_at=NOW()
      WHERE id=$1 RETURNING id`, [taskId, JSON.stringify({ common_runner: binding })]);
    if (result.rowCount !== 1) fail('common_runner_task_missing', 404);
  }
  async function prepare(action, runId, body, nonce) {
    if (!['start', 'inspect', 'cancel', 'flush'].includes(action) || !UUID.test(runId) || !object(body) || !UUID.test(body.task_id)
      || Object.keys(body).some(key => action === 'start' ? !inputKeys.has(key) : key !== 'task_id')) fail('common_runner_request_invalid', 400);
    if (action === 'start' && (!PROFILE.test(body.profile ?? '') || !object(body.input)
      || !['formal', 'exploration'].includes(body.mode))) fail('common_runner_request_invalid', 400);
    if (typeof token !== 'string' || token.length < 32) fail('common_runner_transport_unconfigured', 503);
    const planDigest = action === 'start' ? digest({ profile: body.profile, input: body.input, mode: body.mode }) : null;
    return transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,515))', [runId]);
      const task = (await db.query('SELECT id,status,kind,task_type,payload,result,claimed_by FROM tasks WHERE id=$1 FOR UPDATE', [body.task_id])).rows[0];
      if (!task) fail('common_runner_task_missing', 404);
      // Only an in-process source adapter can authorize another task class.
      const sourceAuthorized = typeof taskPolicy === 'function'
        && await taskPolicy({ task, db, action, runId, body }) === true;
      if (task.kind !== 'agent' && !sourceAuthorized) fail('common_runner_task_owned');
      let existing = task.result?.common_runner;
      if (existing) {
        if (existing.run_id !== runId || existing.task_id !== body.task_id || (planDigest && existing.input_digest !== planDigest)) fail('common_runner_identity_conflict');
        if (action === 'cancel' && !existing.cancel_requested) {
          existing = { ...existing, cancel_requested: true };
          await persist(db, body.task_id, existing, { activate: false });
        }
        if (action === 'start' && existing.launch_state === 'not_started' && !existing.cancel_requested) {
          if (!['queued', 'in_progress'].includes(task.status)) fail('common_runner_task_not_runnable');
          await assertCanStart(db);
          if (task.payload?.headed_takeover || [true, 'true'].includes(task.payload?.headed_manual)
            || (!sourceAuthorized && task.payload?.commander_protocol === 'commander-v2') || (task.claimed_by && task.claimed_by !== 'common-runner')) fail('common_runner_task_owned');
          if (!executionDirectory.current()) await executionDirectory.refresh({ pool });
          return authorizeExecution(db, { snapshotVersion: executionDirectory.current()?.version, machineId: existing.machine_id,
            surface: 'managed_script', provider: 'script', profileId: existing.profile,
            executionVersionId: existing.execution_version_id, grantId: existing.execution_grant_id }, async (auth, authorizedDb = db) => {
            const reserved = { ...existing, launch_state: 'reserved', launch_nonce: nonce };
            await persist(authorizedDb, body.task_id, reserved);
            return { binding: reserved, endpoint: auth.node.endpoints.worker, action: 'start' };
          });
        }
        const node = await resolveBoundNode(db, { executionVersionId: existing.execution_version_id, persistedAttemptIdentity: existing });
        return { binding: existing, endpoint: node.endpoints.worker, action: action === 'start' ? 'inspect' : action };
      }
      if (action !== 'start') fail('common_runner_run_unknown', 404);
      await assertCanStart(db);
      if (!['queued', 'in_progress'].includes(task.status)) fail('common_runner_task_not_runnable');
      if (task.payload?.headed_takeover || [true, 'true'].includes(task.payload?.headed_manual)
        || (!sourceAuthorized && task.payload?.commander_protocol === 'commander-v2') || (task.claimed_by && task.claimed_by !== 'common-runner')) fail('common_runner_task_owned');
      const configured = profiles ?? loadCommonRunnerProfiles(env.COMMON_RUNNER_PROFILES_FILE);
      if (!Object.hasOwn(configured, body.profile)) fail('common_runner_profile_unavailable');
      const config = configured[body.profile];
      if (!HASH.test(config.profile_sha256)) fail('common_runner_profiles_invalid');
      if (!executionDirectory.current()) await executionDirectory.refresh({ pool });
      return authorizeExecution(db, { snapshotVersion: executionDirectory.current()?.version, machineId: config.machine_id,
        surface: 'managed_script', provider: 'script', profileId: body.profile }, async (auth, authorizedDb = db) => {
        let runBinding;
        if (body.mode === 'formal') {
          const definition = await readDefinition(authorizedDb, runId);
          runBinding = commonRunnerFormalBinding(definition, runId);
          if ((resolveMachineId(definition.release?.target) ?? definition.release?.target) !== config.machine_id) fail('common_runner_formal_machine_mismatch');
          const owner = (await authorizedDb.query('SELECT task_id FROM task_runs WHERE id=$1 AND run_id=$2', [definition.binding.task_run_id, runId])).rows[0];
          if (owner?.task_id !== body.task_id) fail('common_runner_identity_conflict');
        }
        const prior = (await authorizedDb.query('SELECT task_id,status,ended_at FROM task_runs WHERE run_id=$1', [runId])).rows[0];
        if (prior && prior.task_id !== body.task_id) fail('common_runner_identity_conflict');
        if (prior && (prior.ended_at || prior.status !== 'running')) fail('common_runner_run_already_terminal');
        const started = await startRun({ taskId: body.task_id, runId, source: 'common-runner',
          context: { machine_id: config.machine_id, profile: body.profile, mode: body.mode } }, { pool: authorizedDb });
        if (!started?.id) fail('common_runner_run_registration_failed', 503);
        const binding = { run_id: runId, task_id: body.task_id, machine_id: config.machine_id, execution_version_id: auth.executionVersionId,
          execution_grant_id: auth.grantId, profile: body.profile, profile_sha256: config.profile_sha256, mode: body.mode,
          input_digest: planDigest, input: body.input, launch_state: 'reserved', launch_nonce: nonce, created_at: new Date().toISOString() };
        if (runBinding) binding.run_binding = runBinding;
        await persist(authorizedDb, body.task_id, binding);
        return { binding, endpoint: auth.node.endpoints.worker, action };
      });
    });
  }
  async function recordNotStarted(binding, receipt, nonce, action) {
    if (action !== 'start' || receipt.status !== 'waiting_resources' || receipt.execution_state !== 'not_started') return;
    await transaction(pool, async db => {
      const task = (await db.query('SELECT id,result FROM tasks WHERE id=$1 FOR UPDATE', [binding.task_id])).rows[0];
      const current = task?.result?.common_runner;
      // A delayed response from an older start must not reopen a newer launch window.
      if (current?.run_id === binding.run_id && current.launch_nonce === nonce && current.launch_state === 'reserved' && !current.cancel_requested) {
        await persist(db, binding.task_id, { ...current, launch_state: 'not_started' }, { activate: false });
      }
    });
  }
  async function settle(binding, receipt) {
    const central = { status: 'running', recording_status: 'pending' };
    const wb = receipt.writeback;
    const review = receipt.status === 'needs_review';
    const finalStatus = { completed: 'success', failed: 'failed', cancelled: 'cancelled', needs_review: 'failed' }[receipt.status];
    if (finalStatus && receipt.execution_unknown !== true && wb?.pending === 0 && wb.blocked === 0 && Number.isSafeInteger(wb.total)
      && wb.total > 0 && wb.acked === wb.total && HASH.test(wb.manifest_sha256 ?? '')) {
      const rows = (await pool.query(`SELECT occurrence_key,payload_sha256,evidence FROM spans
        WHERE run_id=$1 AND evidence->>'profile_digest'=$2 ORDER BY occurrence_key`, [binding.run_id, binding.profile_sha256])).rows;
      const selected = rows.filter(row => row.evidence?.task_id === binding.task_id
        && row.evidence?.machine_id === binding.machine_id && row.evidence?.mode === binding.mode);
      const manifest = selected.map(({ occurrence_key, payload_sha256 }) => ({ occurrence_key, payload_sha256 }))
        .sort((a, b) => a.occurrence_key < b.occurrence_key ? -1 : a.occurrence_key > b.occurrence_key ? 1 : 0);
      const manifestHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const validations = selected.filter(row => row.evidence.kind === 'validation');
      const workflow = receipt.validation?.workflow;
      const matchesWorkflow = validations.some(row => digest(row.evidence.workflow_validation) === digest(workflow));
      const activities = receipt.validation?.activities;
      const formalVerified = binding.mode !== 'formal' || (object(activities) && Object.keys(activities).length > 0
        && Object.entries(activities).every(([key, verdict]) => verdict?.verdict === 'pass'
          && validations.some(row => row.evidence.activity === key && row.evidence.questions?.A4?.status === 'observed'
            && digest(row.evidence.validation) === digest(verdict))));
      const successVerified = receipt.status !== 'completed' || (workflow?.verdict === 'pass'
        && typeof workflow.acceptance_ref === 'string' && Array.isArray(workflow.evidence) && workflow.evidence.length > 0
        && matchesWorkflow && formalVerified);
      const cleanup = receipt.validation?.cleanup;
      const cleanupVerified = (review && resourceFreeReview(receipt)) || (!review && receipt.status !== 'cancelled') || (receipt.execution_unknown !== true && cleanup?.verdict === 'pass'
        && typeof cleanup.acceptance_ref === 'string' && Array.isArray(cleanup.evidence) && cleanup.evidence.length > 0
        && validations.some(row => digest(row.evidence.cleanup_validation) === digest(cleanup)));
      let reconciliationVerified = true;
      if (binding.mode === 'formal' && receipt.status === 'completed') {
        const reconciliation = await readReconciliation(pool, binding.run_id);
        reconciliationVerified = reconciliation.business_outcome === 'pass' && reconciliation.evidence_status === 'verified';
      }
      if (selected.length === rows.length && selected.length === wb.total && manifestHash === wb.manifest_sha256 && successVerified && cleanupVerified && reconciliationVerified) {
        const evidence = [{ kind: 'central_spans', run_id: binding.run_id, count: wb.total, manifest_sha256: manifestHash },
          { kind: 'worker_receipt', machine_id: binding.machine_id, profile_sha256: binding.profile_sha256, status: receipt.status }];
        const summary = `公共Runner运行${receipt.status}；${wb.total}条执行记录已在Brain独立读回`;
        const result = { actor: 'common-runner', summary, evidence,
          handoff: { summary, next_steps: [] }, common_runner: { mode: binding.mode, business_status: receipt.status, validation: receipt.validation, writeback: wb } };
        const finished = await finishRun({ runId: binding.run_id, status: review ? 'failed' : receipt.status, result,
          artifacts: [`brain:spans:${binding.run_id}`] }, { pool, strict: true });
        const saved = finished?.updated ? null : (await pool.query('SELECT status,task_id,ended_at,result FROM task_runs WHERE run_id=$1', [binding.run_id])).rows[0];
        if (finished?.updated || (saved?.status === finalStatus && saved.task_id === binding.task_id && saved.ended_at
          && (!review || saved.result?.common_runner?.business_status === 'needs_review'))) {
          central.status = review ? 'needs_review' : finalStatus; central.recording_status = 'confirmed';
        }
      }
    }
    const observation = { actor: 'common-runner', summary: `Worker状态${receipt.status}；中央运行${central.status}`,
      evidence: { authenticated_receipt: receipt, central_readback: central },
      handoff: { summary: central.recording_status === 'confirmed' ? '运行记录已确认，任务层由调用方继续归位' : '保留运行身份，继续inspect或flush；禁止重跑业务', next_steps: [] } };
    const stored = await pool.query(`UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||$2::jsonb,updated_at=NOW()
      WHERE id=$1 AND result->'common_runner'->>'run_id'=$3 RETURNING id`,
    [binding.task_id, JSON.stringify({ common_runner_observation: observation }), binding.run_id]);
    if (stored.rowCount !== 1) fail('common_runner_observation_unconfirmed', 503);
    return central;
  }
  return { async dispatch(action, runId, body) {
    const nonce = randomUUID();
    const prepared = await prepare(action, runId, body, nonce), binding = prepared.binding;
    const request = { run_id: runId, task_id: body.task_id, request_nonce: nonce,
      ...(prepared.action === 'start' ? { profile: binding.profile, profile_sha256: binding.profile_sha256, input: binding.input, mode: binding.mode,
        ...(binding.run_binding ? { run_binding: binding.run_binding } : {}) } : {}) };
    try {
      const envelope = await transport({ endpoint: prepared.endpoint, action: prepared.action, runId, body: request, token, allowLoopbackForTests });
      const receipt = verifyEnvelope(envelope, { run_id: runId, task_id: body.task_id, machine_id: binding.machine_id,
        request_nonce: nonce, profile_sha256: binding.profile_sha256, mode: binding.mode }, token);
      await recordNotStarted(binding, receipt, nonce, prepared.action);
      // Do not equate process exit with verified workflow/record completion. Preserve the authenticated observation.
      const central_run = await settle(binding, receipt);
      return { authenticated: true, receipt, central_run };
    } catch (error) {
      // Reservation is committed before transport. Never retry start after an ambiguous network/receipt failure.
      return { run_id: runId, task_id: body.task_id, status: 'unknown', next_action: 'inspect',
        reason: /^common_runner_[a-z0-9_]+$/.test(error.message) ? error.message : 'common_runner_transport_unknown' };
    }
  } };
}
