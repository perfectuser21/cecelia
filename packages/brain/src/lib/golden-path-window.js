import path from 'node:path';
import fs from 'node:fs';
import { readGoldenPathT0Archive, readGoldenPathServing } from './golden-path-archive.js';
import { isDeepStrictEqual } from 'node:util';
import { readGoldenPathJournal, listGoldenPathJournals } from './golden-path-journal.js';

const TASK = '115a39b8-b66a-45b1-9b1a-9ff88fe16152';
const LEASE_MS = 60_000, WINDOW_MS = 7 * 24 * 3600_000;
const time = value => value instanceof Date ? value.getTime() : Date.parse(value);
const validSource = source => /^[a-f0-9]{40}$/.test(source?.git_sha ?? '')
  && source?.manifest && Object.keys(source.manifest).length >= 8
  && Object.values(source.manifest).every(hash => /^[a-f0-9]{64}$/.test(hash));

export async function readGoldenPathT0({ pool, root, window }) {
  if (!window?.t0_event_id) return null;
  const sources = window.sources ?? (window.source ? [window.source] : []);
  const matches = row => row?.db_time_verified === true && row?.id === window.t0_event_id && Number.isFinite(time(row.created_at))
    && /([zZ]|[+-]\d\d:\d\d)$/.test(row.payload?.gp_db_created_at ?? '')
    && time(row.payload.gp_db_created_at) === time(row.created_at)
    && row.payload?.window_id === window.window_id
    && sources.length && sources.every(validSource)
    && sources.some(source => isDeepStrictEqual(source, row.payload.source));
  const row = (await pool.query({ text: `SELECT id,payload,
    CASE WHEN pg_typeof(created_at)='timestamp without time zone'::regtype
      THEN created_at AT TIME ZONE current_setting('TimeZone') ELSE created_at END AS created_at,
    CASE WHEN pg_typeof(created_at)='timestamp without time zone'::regtype
      THEN (payload->>'gp_db_created_at')::timestamptz AT TIME ZONE current_setting('TimeZone')=created_at
      ELSE (payload->>'gp_db_created_at')::timestamptz=created_at END AS db_time_verified
    FROM cecelia_events
    WHERE id=$1 AND event_type='golden_path_observation_t0' AND source='golden-path-retirement'`,
  values: [window.t0_event_id], query_timeout: 2_000 })).rows[0];
  if (row) return matches(row) ? row : null;
  // 事件保留期后仅接受先前server持久化的独立实际DB回执，不读任务自报日期。
  try {
    const archived = readGoldenPathT0Archive(path.join(root, window.window_id));
    return matches(archived) ? archived : null;
  } catch { return null; }

}

// 只读裁决：T0与当前时刻都取DB真实行，不接受调用方自报时间/窗口或heartbeat零调用推断。
export async function inspectGoldenPathWindow({ pool, root }) {
  const result = { accepted: false, reasons: [], unknown_accesses: [], actual_access_count: 0, actual_access_count_complete: false };
  const reject = reason => { if (!result.reasons.includes(reason)) result.reasons.push(reason); };
  const window = (await pool.query({ text: `SELECT result->'gp_observation_window' AS window FROM tasks WHERE id=$1`, values: [TASK], query_timeout: 2_000 }))
    .rows[0]?.window;
  if (!/^[a-f0-9-]{36}$/.test(window?.window_id ?? '') || !window?.t0_event_id) {
    reject('window_not_admitted'); return result;
  }
  const t0 = await readGoldenPathT0({ pool, root, window });
  const clock = (await pool.query({ text: 'SELECT clock_timestamp() AS db_now', query_timeout: 2_000 })).rows[0];
  const sources = window.sources ?? (window.source ? [window.source] : []);
  if (!t0 || t0.payload?.window_id !== window.window_id || !sources.length
      || !sources.every(validSource) || !sources.some(source => isDeepStrictEqual(source, t0.payload?.source))) {
    reject('t0_or_source_unproven'); return result;
  }
  const begin = time(t0.created_at), now = time(clock?.db_now), cutoff = begin + WINDOW_MS;
  if (!Number.isFinite(begin) || !Number.isFinite(now)) { reject('database_time_unproven'); return result; }
  result.t0 = new Date(begin).toISOString(); result.db_now = new Date(now).toISOString();
  if (now < cutoff) reject('seven_real_days_incomplete');
  let files;
  const directory = path.join(root, window.window_id);
  try {
    files = listGoldenPathJournals(directory);
    if (!files.length || files.length > 1024) throw new Error('missing');
  } catch { reject('journal_manifest_missing'); return result; }
  let serving;
  try {
    serving = readGoldenPathServing(root);
    // 全局清单之外的已有pair（包括旧格式unadmitted）也必须被发现，不能假设没登记就不存在。
    const directories = fs.readdirSync(root).filter(name => name === 'unadmitted' || /^[a-f0-9-]{36}$/.test(name));
    if (directories.length > 1024) throw new Error('too_many_windows');
    const diskInstances = directories.flatMap(name => listGoldenPathJournals(path.join(root, name))
      .map(file => ({ instance_id: path.basename(file, '.jsonl'), window_id: name })));
    if (diskInstances.length !== serving.length || diskInstances.some(instance => !serving.some(row =>
      row.instance_id === instance.instance_id && row.window_id === instance.window_id))) throw new Error('orphan');
    const registered = serving.filter(r => r.window_id === window.window_id);
    if (registered.length !== files.length || registered.some(r => !files.includes(path.join(directory, `${r.instance_id}.jsonl`)))) {
      throw new Error('unregistered');
    }
  } catch { reject('serving_manifest_unproven'); return result; }
  for (const instance of serving.filter(r => r.window_id !== window.window_id)) {
    try {
      const dir = path.join(root, instance.window_id), file = path.join(dir, `${instance.instance_id}.jsonl`);
      if (!listGoldenPathJournals(dir).includes(file)) throw new Error('missing');
      const rows = readGoldenPathJournal(file);
      const acks = new Map(rows.filter(r => r.kind === 'ack').map(r => [r.audit_id, r]));
      const lifecycle = rows.filter(r => r.kind === 'intent' && r.payload.lifecycle);
      const listening = lifecycle.find(r => r.payload.lifecycle === 'listening');
      const end = lifecycle.find(r => r.payload.lifecycle === 'instance_end');
      const from = time(acks.get(listening?.payload.audit_id)?.created_at);
      const to = end ? time(acks.get(end.payload.audit_id)?.created_at) : now;
      if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('unknown_lifetime');
      if (to < begin || from > cutoff) continue;
      reject('serving_instance_unadmitted');
      for (const row of rows.filter(r => r.kind === 'intent' && r.event_type === 'golden_path_legacy_access')) {
        const at = time(acks.get(row.payload.audit_id)?.created_at);
        if (!Number.isFinite(at) || at < begin || at > cutoff) continue;
        result.actual_access_count += 1;
        if (row.payload.caller?.kind !== 'internal_code') { result.unknown_accesses.push(row.payload.audit_id); reject('caller_unresolved'); }
      }
    } catch { reject('serving_instance_unproven'); }
  }
  const spans = [], ids = new Map(), acknowledgements = new Map();
  for (const file of files) {
    let rows;
    try { rows = readGoldenPathJournal(file); } catch { reject('journal_corrupt'); continue; }
    if (!rows.length) { reject('instance_empty'); continue; }
    for (const row of rows) {
      if (row.window_id !== window.window_id || !sources.some(s => isDeepStrictEqual(s, row.source))) reject('source_unadmitted');
      if (row.kind === 'gap' || row.kind === 'recovered_ack') reject('coverage_gap');
      if (row.kind === 'intent') {
        if (ids.has(row.payload?.audit_id)) reject('duplicate_intent');
        ids.set(row.payload?.audit_id, row);
      }
      if (row.kind === 'ack') {
        if (acknowledgements.has(row.audit_id)) reject('duplicate_ack');
        acknowledgements.set(row.audit_id, row);
      }
    }
    const lifecycle = rows.filter(r => r.kind === 'intent' && r.payload.lifecycle);
    const localAcks = new Map(rows.filter(r => r.kind === 'ack').map(r => [r.audit_id, r]));
    const bound = lifecycle.map(r => ({ intent: r, ack: localAcks.get(r.payload.audit_id) }));
    const listening = bound.find(r => r.intent.payload.lifecycle === 'listening');
    const start = bound.find(r => r.intent.payload.lifecycle === 'instance_start');
    if (!start?.ack || !listening?.ack || time(start.ack.created_at) > time(listening.ack.created_at)) reject('instance_start_unproven');
    const points = bound.map(r => time(r.ack?.created_at)).filter(Number.isFinite).sort((a, b) => a - b);
    for (let i = 1; i < points.length; i += 1) if (points[i] - points[i - 1] > LEASE_MS) reject('health_lease_gap');
    const ended = bound.find(r => r.intent.payload.lifecycle === 'instance_end');
    if (bound.filter(r => r.intent.payload.lifecycle === 'instance_start').length !== 1
        || bound.filter(r => r.intent.payload.lifecycle === 'listening').length !== 1
        || bound.filter(r => r.intent.payload.lifecycle === 'instance_end').length > 1) reject('lifecycle_identity_invalid');
    const last = ended?.ack ? time(ended.ack.created_at) : points.at(-1);
    if (!ended?.ack && now - last > LEASE_MS) reject('instance_end_or_lease_unproven');
    if (listening?.ack && Number.isFinite(last)) spans.push([time(listening.ack.created_at), last]);
  }
  for (const [id, intent] of ids) {
    const ack = acknowledgements.get(id);
    if (!Number.isSafeInteger(Number(ack?.event_id)) || Number(ack?.event_id) <= 0
        || !/([zZ]|[+-]\d\d:\d\d)$/.test(ack?.gp_db_created_at ?? '')
        || time(ack.gp_db_created_at) !== time(ack.created_at)
        || !Number.isFinite(time(ack?.created_at)) || !Number.isFinite(time(ack?.db_time))
        || time(ack.created_at) > time(ack.db_time) || time(ack.db_time) > now) reject('ack_unproven');
    if (intent.payload?.legacy_read_enabled !== false || intent.payload?.healthy === false) reject('flag_or_health_invalid');
    if (intent.event_type === 'golden_path_legacy_access') {
      result.actual_access_count += 1;
      if (intent.payload.caller?.kind !== 'internal_code') {
        result.unknown_accesses.push(id); reject('caller_unresolved');
      }
    }
  }
  for (const id of acknowledgements.keys()) if (!ids.has(id)) reject('ack_without_intent');
  spans.sort((a, b) => a[0] - b[0]);
  let covered = begin;
  for (const [from, to] of spans) {
    if (to < begin) continue;
    if (from > covered) { reject('deployment_coverage_gap'); break; }
    covered = Math.max(covered, to);
  }
  if (covered < Math.min(now, cutoff)) reject('window_coverage_incomplete');
  result.accepted = result.reasons.length === 0;
  result.actual_access_count_complete = result.accepted;
  return result;
}
