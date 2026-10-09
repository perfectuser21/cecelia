import { isDeepStrictEqual } from 'node:util';
import { assertNoSecretMaterial } from './commander-contract.js';
import { createRunEventStore } from './run-event-store.js';
import { runActivityContract } from './activity-runtime.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_TYPE = 'activity-contract';
const EVENTS = new Set(['WF_RUN_STARTED', 'ACTIVITY_STARTED', 'ACTIVITY_HEARTBEAT',
  'ACTIVITY_FINISHED', 'ACTIVITY_SKIPPED', 'WF_RUN_FINALIZED', 'WF_RUN_FINALIZATION_CORRECTED']);
const SECRET_KEY = /token|secret|password|api[_-]?key|auth(?:entication|orization)?|credential_payload/i;
const SECRET_TEXT = /(?:postgres(?:ql)?|https?):\/\/[^\s/@:]+:[^\s/@]+@|\bBearer\s+\S+|\b(?:password|api[_-]?key|access[_-]?token|secret)\s*[=:]\s*\S+/i;

function assertSafe(value) {
  // 服务调用可共享failure/budget对象；JSON事件允许共享引用，禁止实际环。
  let normalized;
  try { normalized = JSON.parse(JSON.stringify(value)); }
  catch { throw new Error('non_json_value_forbidden'); }
  assertNoSecretMaterial(normalized);
  const inspect = nested => {
    if (typeof nested === 'string' && SECRET_TEXT.test(nested)) throw new Error('secret_material_forbidden');
    if (nested && typeof nested === 'object') Object.values(nested).forEach(inspect);
  };
  inspect(normalized);
  return normalized;
}

// 原始stdio不属于事件账；可能包含凭据、噪声或失败命令。产物/指标/证据仍完整保留。
function publicReceipt(receipt, redact = false) {
  const clean = structuredClone(receipt);
  for (const activity of clean.activities || []) {
    for (const attempt of activity.attempts || []) {
      if (attempt.transport) { delete attempt.transport.stdout; delete attempt.transport.stderr; }
    }
  }
  if (!redact) return clean;
  const scrub = value => {
    if (typeof value === 'string') return SECRET_TEXT.test(value) ? '[redacted]' : value;
    if (!value || typeof value !== 'object') return value;
    for (const [key, nested] of Object.entries(value)) {
      const safeAuthFailureStatus = key === 'auth_failed' && typeof nested === 'boolean';
      value[key] = SECRET_KEY.test(key) && !safeAuthFailureStatus ? '[redacted]' : scrub(nested);
    }
    return value;
  };
  return scrub(clean);
}

// 调用方提供已有Brain run；此模块不创建/完成task或initiative_run。
export async function createActivityEventSink({ pool, runId, sourceId, runTag }) {
  if (!UUID.test(runId)) throw new Error('activity_run_id_invalid');
  if (!UUID.test(sourceId)) throw new Error('activity_source_id_invalid');
  if (typeof runTag !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(runTag)) throw new Error('activity_run_tag_invalid');
  if (!pool || typeof pool.connect !== 'function') throw new Error('activity_event_pool_required');
  runId = runId.toLowerCase(); sourceId = sourceId.toLowerCase();
  const lockKey = SOURCE_TYPE + ':' + sourceId;
  const client = await pool.connect();
  let locked = false, closed = false, closing = false, unavailable = false, queue = Promise.resolve();
  const clientError = () => { unavailable = true; };
  client.on('error', clientError);
  const close = async () => {
    if (closed || closing) return;
    closing = true;
    await queue;
    closed = true;
    try {
      if (unavailable) { client.release(true); return; }
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
      client.off('error', clientError);
      client.release();
    } catch { client.release(true); }
  };
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lockKey])).rows[0].locked;
    if (!locked) throw new Error('activity_source_busy');
    if (!(await client.query('SELECT id FROM initiative_runs WHERE id=$1', [runId])).rows.length) throw new Error('activity_run_not_found');
    if ((await client.query('SELECT 1 FROM harness_run_events WHERE source_type=$1 AND source_id=$2 LIMIT 1',
      [SOURCE_TYPE, sourceId])).rows.length) throw new Error('activity_source_already_used');
  } catch (error) { await close(); throw error; }
  const store = createRunEventStore(client);
  const confirmed = [];
  let observed = 0;
  const receipt = () => ({ run_id: runId, source_type: SOURCE_TYPE, source_id: sourceId,
    local_cursor: confirmed.at(-1)?.local_cursor ?? 0, cursor: confirmed.at(-1)?.cursor ?? 0,
    events: structuredClone(confirmed) });
  const append = async (event, snapshot) => {
    if (closed) throw new Error('activity_event_sink_closed');
    if (unavailable) throw new Error('activity_event_store_unavailable');
    if (event.run_tag !== runTag || (snapshot.run_tag !== undefined && snapshot.run_tag !== runTag)) throw new Error('activity_run_identity_mismatch');
    if (!Number.isSafeInteger(event.cursor) || event.cursor <= observed || !EVENTS.has(event.event_type)
      || (observed === 0 && (event.cursor !== 1 || event.event_type !== 'WF_RUN_STARTED'))
      || (observed > 0 && event.event_type === 'WF_RUN_STARTED')) throw new Error('activity_event_sequence_invalid');
    // 与Postgres JSONB同一表示：合法completed可省略failure_class，undefined不能造成假读回失败。
    const payload = assertSafe({ local_cursor: event.cursor, run_tag: runTag,
      event: structuredClone(event), receipt: publicReceipt(snapshot) });
    observed = event.cursor;
    try {
      await client.query('BEGIN');
      const saved = await store.append({ runId, eventType: event.event_type, sourceType: SOURCE_TYPE,
        sourceId, sourceVersion: event.cursor, payload });
      const [readback] = await store.list(runId, { afterCursor: saved.cursor - 1, limit: 1 });
      if (!readback || readback.cursor !== saved.cursor || readback.source_id !== sourceId
        || readback.source_type !== SOURCE_TYPE || readback.source_version !== event.cursor
        || readback.event_type !== event.event_type || !isDeepStrictEqual(readback.payload, payload)) {
        throw new Error('activity_event_readback_mismatch');
      }
      await client.query('COMMIT');
      confirmed.push({ local_cursor: event.cursor, cursor: saved.cursor, event_type: event.event_type });
      return saved;
    } catch {
      try { await client.query('ROLLBACK'); } catch {}
      throw new Error('activity_event_store_unavailable');
    }
  };
  return Object.freeze({ close, receipt,
    onEvent(event, snapshot) {
      if (closing || closed) return Promise.reject(new Error('activity_event_sink_closed'));
      // 心跳与进程退出可重叠，按runtime分配的本地游标串行提交。
      const pending = queue.then(() => append(event, snapshot));
      queue = pending.catch(() => {});
      return pending;
    },
  });
}

export async function runActivityContractWithEventStore(contract, input, { pool, runId, sourceId, onEvent, ...options } = {}) {
  assertSafe(input); assertSafe(contract);
  const sink = await createActivityEventSink({ pool, runId, sourceId, runTag: input?.run_tag });
  let rejectedFinalEvent;
  try {
    const result = await runActivityContract(contract, input, { ...options, onEvent: async (event, snapshot) => {
      await sink.onEvent(event, snapshot);
      try { await onEvent?.(event, { ...publicReceipt(snapshot), event_ledger: sink.receipt() }); }
      catch (error) {
        if (event.event_type === 'WF_RUN_FINALIZED') rejectedFinalEvent = event;
        throw error;
      }
    } });
    if (rejectedFinalEvent) {
      // runtime按既有语义将回调失败收敛为partial/failed；保留已提交终态，追加真实修正。
      // 不重调失败回调，也不反转开始事件必须先落账的顺序。
      const correction = { cursor: rejectedFinalEvent.cursor + 1, event_type: 'WF_RUN_FINALIZATION_CORRECTED',
        run_tag: input.run_tag, corrects_local_cursor: rejectedFinalEvent.cursor, status: result.status };
      try { await sink.onEvent(correction, result); }
      catch { result.event_failures.push({ cursor: correction.cursor, event_type: correction.event_type }); }
    }
    return { ...publicReceipt(result, true), event_ledger: sink.receipt() };
  } finally { await sink.close(); }
}
