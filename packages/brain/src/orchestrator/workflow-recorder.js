import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSpan } from '../lib/span-ingestion.js';
import { activityQuestions, actualAttempt, reportedSteps, sanitized } from './activity-observations.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
const EVENTS = new Set(['WF_RUN_STARTED','ACTIVITY_STARTED','ACTIVITY_HEARTBEAT','ACTIVITY_FINISHED','ACTIVITY_SKIPPED','WF_RUN_FINALIZED','WF_RUN_FINALIZATION_CORRECTED','ACTIVITY_CHECKED','ACTIVITY_ROUTED','ACTIVITY_AGENT_EVENT','COMMANDER_REQUEST','COMMANDER_EXCHANGE','COMMANDER_UNAVAILABLE','COMMANDER_BUDGET_EXHAUSTED','COMMANDER_RECONNECTED','COMMANDER_SLEEP','WF_OWNER_REVIEW_REQUIRED']);
function syncDirectory(root) { const fd = fs.openSync(root, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeExclusive(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
}
function durableLine(file, value) {
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
}
const attemptKey = event => JSON.stringify([event.activity, event.item ?? null, event.attempt ?? 1]);

export function createWorkflowRecorder({ root, runId, taskId, machineId, profileDigest, mode,
  metadata, brainUrl, headers = {}, fetchImpl = globalThis.fetch }) {
  if (!root || !runId || !taskId || !machineId || !profileDigest || !['formal','exploration'].includes(mode)
    || !metadata || !Object.keys(metadata).length) throw new Error('recorder_identity_required');
  metadata = sanitized(metadata);
  for (const m of Object.values(metadata)) {
    if (!['code','agent'].includes(m.executor_kind)) throw new Error('recorder_executor_kind_invalid');
    normalizeSpan({ run_id: runId, activity_id: m.activity_id, executor_kind: m.executor_kind,
      started_at: new Date().toISOString(), occurrence_key: 'preflight',
      ...(mode === 'formal' ? { ...m.identity, identity_protocol: 2 } : {}) }, 0);
    if (mode === 'formal' && !m.identity?.workflow_id) throw new Error('recorder_workflow_identity_required');
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const manifest = { runId, taskId, machineId, profileDigest, mode, metadata };
  const manifestPath = path.join(root, 'identity.json');
  if (fs.existsSync(manifestPath)) {
    if (!isDeepStrictEqual(JSON.parse(fs.readFileSync(manifestPath)), manifest)) throw new Error('recorder_identity_conflict');
  } else writeExclusive(manifestPath, manifest);
  const journal = path.join(root, 'events.jsonl');
  const rows = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const events = [], spans = [], records = [], pending = new Map(), blocked = new Map(), starts = new Map();
  const eventDigests = new Map(); let queue = Promise.resolve(), poisoned = false;
  function apply(row) {
    records.push(row);
    if (row.kind === 'event') {
      events.push(row); eventDigests.set(row.event.cursor, row.input_digest);
      if (row.event.event_type === 'ACTIVITY_STARTED') starts.set(attemptKey(row.event), row);
    }
    if (row.span) { spans.push(row.span); pending.set(row.span.occurrence_key, row.span); }
    if (row.kind === 'ack') { pending.delete(row.occurrence_key); blocked.delete(row.occurrence_key); }
    if (row.kind === 'blocked') blocked.set(row.occurrence_key, row.reason);
  }
  rows.forEach(apply);
  function refresh() {
    if (!fs.existsSync(journal)) return;
    const content = fs.readFileSync(journal, 'utf8');
    if (content && !content.endsWith('\n')) throw new Error('recorder_journal_incomplete');
    const current = content.split('\n').filter(Boolean).map(JSON.parse);
    events.length = 0; spans.length = 0; records.length = 0;
    pending.clear(); blocked.clear(); starts.clear(); eventDigests.clear(); current.forEach(apply);
  }
  function append(row) {
    if (poisoned) throw new Error('recorder_local_storage_failed');
    try { durableLine(journal, row); apply(row); }
    catch (error) { poisoned = true; throw error; }
  }
  function serial(fn) {
    const job = queue.then(() => { refresh(); return fn(); }); queue = job.catch(() => {}); return job;
  }
  function spanFor(key, m, startedAt, endedAt, evidence, outcome = 'unknown', attempts = 1, stepId = null) {
    const raw = { run_id: runId, activity_id: m.activity_id, step_id: stepId, executor_kind: m.executor_kind, executor_id: machineId,
      started_at: startedAt, ended_at: endedAt, occurrence_key: key, attempts, outcome,
      evidence: { ...evidence, task_id: taskId, machine_id: machineId, profile_digest: profileDigest, mode,
        ...(m.runtime_snapshot_sha256 ? { runtime_snapshot_sha256: m.runtime_snapshot_sha256 } : {}) },
      ...(mode === 'formal' ? { ...m.identity, identity_protocol: 2 } : {}) };
    const normalized = normalizeSpan(raw, 0);
    return { ...normalized.normalized, ...normalized.provenance, occurrence_key: normalized.occurrence_key,
      payload_sha256: normalized.payload_sha256 };
  }
  const stepValidationRows = (source, verdict, observedAt) => {
    if (verdict?.step_checks === undefined) return;
    const reject = () => { throw new Error('recorder_step_validation_invalid'); };
    const checks = verdict.step_checks, m = metadata[source], proofCache = new Map();
    if (!Array.isArray(checks)) reject();
    if (!checks.length) return;
    const checked = events.findLast(row => row.event.event_type === 'ACTIVITY_CHECKED'
      && row.event.activity === source && row.event.phase === 'end'
      && isDeepStrictEqual(row.event.verdict, sanitized(verdict)) && starts.has(attemptKey(row.event)));
    if (!checked || verdict.acceptance_ref !== m.questions?.A4?.ref
      || verdict.executor?.kind !== 'code' || !/^[a-f0-9]{64}$/.test(verdict.executor?.sha256 ?? '')) reject();
    const seen = new Set();
    for (const check of checks) {
      const target = metadata[check.activity_key], definitions = target?.questions?.B1?.declared?.steps;
      const matches = Array.isArray(definitions) ? definitions.filter(step => step.step_id === check.step_id) : [];
      if (matches.length !== 1 || target.activity_id !== check.activity_id || target.identity?.reference_id !== check.reference_id
        || target.identity?.activity_definition_version_id !== check.activity_definition_version_id) reject();
      const step = matches[0], expectedRef = `step:${step.step_id}@${step.registration?.source_sha256}`;
      if (step.locator?.activity_id !== target.activity_id || !/^[a-f0-9]{64}$/.test(step.registration?.source_sha256 ?? '')
        || check.acceptance_ref !== expectedRef || !['pass','fail','unknown'].includes(check.verdict)
        || (step.contract?.dod?.at || check.activity_key) !== source || !Array.isArray(check.evidence)) reject();
      const identityKey = JSON.stringify([check.reference_id, check.step_id]);
      if (seen.has(identityKey)) reject(); seen.add(identityKey);
      const proof = check.evidence.find(row => row && typeof row.path === 'string' && /^[a-f0-9]{64}$/.test(row.sha256 ?? '')
        && verdict.evidence?.some(parent => parent?.path === row.path && parent.sha256 === row.sha256));
      const observation = proof?.observation;
      if (!observation || observation.activity !== check.activity_key || observation.at !== source
        || !(observation.key === step.registration?.key || observation.key === step.locator?.step_key
          || typeof observation.key === 'string' && observation.key.endsWith('.' + step.locator?.step_key))
        || (observation.pass === true ? 'pass' : observation.pass === false ? 'fail' : 'unknown') !== check.verdict
        || !(Object.hasOwn(observation,'observed') || check.verdict === 'unknown' && (observation.error || observation.skipped === true))) reject();
      const proofKey = JSON.stringify([proof.path, proof.sha256]);
      if (!proofCache.has(proofKey)) {
        let fd;
        try {
          fd = fs.openSync(proof.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 4194304) reject();
          const bytes = fs.readFileSync(fd); if (createHash('sha256').update(bytes).digest('hex') !== proof.sha256) reject();
          proofCache.set(proofKey, JSON.parse(bytes.toString('utf8')));
        } catch { reject(); } finally { if (fd !== undefined) fs.closeSync(fd); }
      }
      const actual = (proofCache.get(proofKey).step_dod || []).flatMap(group => group.steps || []);
      if (!actual.some(row => row.key === observation.key && row.activity === observation.activity && row.at === observation.at
        && (row.pass ?? null) === (observation.pass ?? null) && isDeepStrictEqual(sanitized(row.observed ?? null), sanitized(observation.observed ?? null))
        && (row.error ?? null) === (observation.error ?? null))) reject();
      const stepVerdict = {...sanitized(check), executor: sanitized(verdict.executor)};
      const stepMeta = {...target, executor_kind:'code', questions:{...target.questions,A4:{ref:expectedRef,
        version:target.questions.B1.version,declared:step.contract}}};
      const evidence = {kind:'validation',activity:check.activity_key,execution_activity:source,source_event_cursor:checked.event.cursor,
        step_validation:stepVerdict,validation:stepVerdict,questions:activityQuestions(stepMeta,{},stepVerdict),
        timing_semantics:'independent_step_readback_observation_not_execution_interval'};
      const occurrence = `step-validation:${digest([source,checked.event.cursor,stepVerdict])}`;
      if (!spans.some(span => span.occurrence_key === occurrence)) append({kind:'step_validation',observed_at:observedAt,
        span:spanFor(occurrence,stepMeta,observedAt,observedAt,evidence,mode === 'formal' ? check.verdict : 'unknown',1,check.step_id)});
    }
  };
  const validationRows = verdict => {
    const recordedAt = new Date().toISOString();
    const executed = [...new Set(events.filter(r => r.event.event_type === 'ACTIVITY_FINISHED').map(r => r.event.activity))];
    for (const key of executed) {
      const m = metadata[key], v = verdict?.activities?.[key] ?? null;
      stepValidationRows(key, v, recordedAt);
      const questions = activityQuestions(m, {}, v, { run_id: runId, task_id: taskId, machine_id: machineId,
        profile_digest: profileDigest, observed_at: recordedAt });
      const verified = questions.A4.status === 'observed';
      const outcome = mode === 'formal' && verified ? v.verdict : 'unknown';
      const observation = { kind: 'validation', activity: key, observed_at: recordedAt,
        timing_semantics: 'result_observation_not_validator_execution_interval',
        validation: sanitized(v), workflow_validation: sanitized(verdict?.workflow), cleanup_validation: sanitized(verdict?.cleanup), questions,
        execution_occurrences: spans.filter(s => s.evidence.kind === 'execution' && s.activity_id === m.activity_id).map(s => s.occurrence_key) };
      const occurrence = `validation:${digest([key, sanitized(verdict)])}`;
      if (spans.some(s => s.occurrence_key === occurrence)) continue;
      append({ ...observation, span: spanFor(occurrence, m, recordedAt, recordedAt, observation, outcome) });
    }
  };
  return Object.freeze({
    onEvent(event, receipt) { return serial(() => {
      if (!Number.isSafeInteger(event?.cursor) || event.cursor < 1 || !EVENTS.has(event.event_type)) throw new Error('recorder_event_invalid');
      const safeEvent = sanitized(event), safeReceipt = sanitized(receipt);
      const inputDigest = digest([safeEvent, safeReceipt]);
      if (eventDigests.has(event.cursor)) {
        if (eventDigests.get(event.cursor) !== inputDigest) throw new Error('event_occurrence_conflict');
        return;
      }
      if (events.length && event.cursor <= events.at(-1).event.cursor) throw new Error('recorder_event_sequence_invalid');
      const observedAt = new Date().toISOString();
      const row = { kind: 'event', observed_at: observedAt, event: safeEvent, receipt: safeReceipt, input_digest: inputDigest };
      if (event.event_type === 'ACTIVITY_FINISHED') {
        const declared = metadata[event.activity]; if (!declared) throw new Error('activity_metadata_missing');
        const attempt = actualAttempt(receipt, event);
        const start = starts.get(attemptKey(event));
        const m=start?.event.recovery&&declared.recovery_implementation?{...declared,executor_kind:'agent',implementation:declared.recovery_implementation}:declared;
        const preflightFailure = !start && ['failed','needs_review'].includes(attempt.status) && attempt.transport === null
          && typeof attempt.reason_code === 'string' && attempt.reason_code.length > 0;
        if (!start && !preflightFailure) throw new Error('activity_start_missing');
        const context = { run_id: runId, task_id: taskId, machine_id: machineId, profile_digest: profileDigest,
          activity: event.activity, item: event.item ?? null, attempt: event.attempt ?? 1, started_at: start?.observed_at ?? null,
          ended_at: observedAt, budget: start?.event.budget ?? null, execution_invoked: !preflightFailure,
          start_known: Boolean(start), ...(start && Object.hasOwn(start.event, 'input') ? { input: start.event.input } : {}) };
        const evidence = { kind: 'execution', activity: event.activity, item: sanitized(event.item ?? null),
          execution_invoked: !preflightFailure, start_known: Boolean(start),
          timing_semantics: preflightFailure ? 'preflight_failure_observed' : 'runtime_start_end_observed',
          attempt: event.attempt ?? 1, questions: activityQuestions(m, attempt, null, context), steps: reportedSteps(attempt),
          raw_result: sanitized(attempt), execution_status: attempt.status };
        row.span = spanFor(`execution:${digest(attemptKey(event))}`, m, start?.observed_at ?? observedAt, observedAt, evidence,
          'unknown', event.attempt ?? 1);
        if (spans.some(s => s.occurrence_key === row.span.occurrence_key)) throw new Error('span_occurrence_conflict');
      }
      if(event.event_type.startsWith('COMMANDER_')||['ACTIVITY_CHECKED','ACTIVITY_ROUTED','ACTIVITY_AGENT_EVENT','WF_OWNER_REVIEW_REQUIRED'].includes(event.event_type)){
        const m=metadata[event.activity]??Object.values(metadata)[0];
        row.span=spanFor(`event:${event.cursor}`,m,observedAt,observedAt,{kind:event.event_type.startsWith('COMMANDER_')?'commander':'runtime_check',activity:event.activity??null,event:safeEvent},'unknown');
      }
      append(row);
    }); },
    recordValidation(verdict) { return serial(() => {
      append({ kind: 'validator', observed_at: new Date().toISOString(), verdict: sanitized(verdict) }); validationRows(verdict);
    }); },
    finalize(receipt, verdict) { return serial(() => {
      if (verdict) validationRows(verdict);
      append({ kind: 'terminal', observed_at: new Date().toISOString(), receipt: sanitized(receipt), verdict: sanitized(verdict),
        outcome: mode === 'formal' && ['pass','fail'].includes(verdict?.workflow?.verdict) ? verdict.workflow.verdict : 'unknown' });
    }); },
    flush() { return serial(async () => {
      const summary = () => {
        const manifest = spans.map(s => ({ occurrence_key: s.occurrence_key, payload_sha256: s.payload_sha256 }))
          .sort((a,b) => a.occurrence_key < b.occurrence_key ? -1 : a.occurrence_key > b.occurrence_key ? 1 : 0);
        return { pending: pending.size, blocked: blocked.size, total: manifest.length, acked: manifest.length - pending.size,
          manifest_sha256: digest(manifest) };
      };
      if (!brainUrl || typeof fetchImpl !== 'function') return summary();
      for (const [key, span] of pending) {
        if (blocked.has(key)) continue;
        try {
          const response = await fetchImpl(`${brainUrl.replace(/\/$/, '')}/api/brain/spans`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(span), signal: AbortSignal.timeout(10000) });
          if (response.status === 409) { append({ kind: 'blocked', occurrence_key: key, reason: 'central_occurrence_conflict' }); continue; }
          if (!response.ok) continue;
          const readback = await fetchImpl(`${brainUrl.replace(/\/$/, '')}/api/brain/spans?run_id=${encodeURIComponent(runId)}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!readback.ok) continue;
          const body = await readback.json(); const saved = body.spans?.find(s => s.occurrence_key === key);
          if (!saved || normalizeSpan(saved, 0).payload_sha256 !== span.payload_sha256) continue;
          append({ kind: 'ack', occurrence_key: key, payload_sha256: span.payload_sha256, observed_at: new Date().toISOString() });
        } catch (error) { if (poisoned) throw error; /* 网络失败只留outbox，不能让业务重试。 */ }
      }
      refresh();
      return summary();
    }); },
    inspect() { return clone({ events, spans, pending: pending.size, blocked: [...blocked].map(([occurrence_key, reason]) => ({ occurrence_key, reason })),
      records, root, mode }); },
  });
}
