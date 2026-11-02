import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSpan } from '../lib/span-ingestion.js';
import { activityQuestions, actualAttempt, reportedSteps, sanitized } from './activity-observations.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
const EVENTS = new Set(['WF_RUN_STARTED','ACTIVITY_STARTED','ACTIVITY_HEARTBEAT','ACTIVITY_FINISHED','ACTIVITY_SKIPPED','WF_RUN_FINALIZED','WF_RUN_FINALIZATION_CORRECTED']);
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
  function spanFor(key, m, startedAt, endedAt, evidence, outcome = 'unknown', attempts = 1) {
    const raw = { run_id: runId, activity_id: m.activity_id, executor_kind: m.executor_kind, executor_id: machineId,
      started_at: startedAt, ended_at: endedAt, occurrence_key: key, attempts, outcome,
      evidence: { ...evidence, task_id: taskId, machine_id: machineId, profile_digest: profileDigest, mode,
        ...(m.runtime_snapshot_sha256 ? { runtime_snapshot_sha256: m.runtime_snapshot_sha256 } : {}) },
      ...(mode === 'formal' ? { ...m.identity, identity_protocol: 2 } : {}) };
    const normalized = normalizeSpan(raw, 0);
    return { ...normalized.normalized, ...normalized.provenance, occurrence_key: normalized.occurrence_key,
      payload_sha256: normalized.payload_sha256 };
  }
  const validationRows = verdict => {
    const recordedAt = new Date().toISOString();
    const executed = [...new Set(events.filter(r => r.event.event_type === 'ACTIVITY_FINISHED').map(r => r.event.activity))];
    for (const key of executed) {
      const m = metadata[key], v = verdict?.activities?.[key] ?? null;
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
        const m = metadata[event.activity]; if (!m) throw new Error('activity_metadata_missing');
        const attempt = actualAttempt(receipt, event);
        const start = starts.get(attemptKey(event));
        const preflightFailure = !start && attempt.status === 'failed' && attempt.transport === null
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
