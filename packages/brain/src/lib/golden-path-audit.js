import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { archiveGoldenPathT0, registerGoldenPathServing } from './golden-path-archive.js';
import { createGoldenPathJournal, readGoldenPathJournal } from './golden-path-journal.js';

const HTTP_ROUTES = new Set(['/golden_path', '/golden_path/canvas', '/golden_path/:id/decisions',
  '/tasks/:id/golden-path-decisions', '/journeys/:journey_id/golden-paths', '/golden_path/:id',
  '/golden_path/:id/run-result', '/decisions']);
const INTERNAL = new Set(['step_invariants', 'cumulative_fr']);
export function validateGoldenPathHttp(input) {
  if (!HTTP_ROUTES.has(input.route) || !['GET', 'HEAD', 'POST', 'PATCH'].includes(input.method)
      || !['read', 'write'].includes(input.path_kind)) throw new Error('gp_http_route_invalid');
}
export function createGoldenPathAudit({ root, store, source, flag, windowId = 'unadmitted', admission = null }) {
  if (windowId !== 'unadmitted' && !/^[a-f0-9-]{36}$/.test(windowId)) throw new Error('gp_window_invalid');
  const journal = createGoldenPathJournal(path.join(root, windowId));
  registerGoldenPathServing(root, journal.instanceId, windowId);
  let healthy = true, lastGap = null, tail = Promise.resolve(), closed = false;
  const pendingInstances = new Set();
  const append = record => journal.append({ ...record, source, window_id: windowId });
  // admission仅由server从实际DB T0行/先前可信归档加载，HTTP命中从不提供此字段。
  if (admission) archiveGoldenPathT0(path.join(root, windowId), admission);
  if (admission) append({ kind: 't0_receipt', event_id: admission.id,
    created_at: admission.created_at, payload: admission.payload });
  const gap = reason => {
    healthy = false; lastGap = reason;
    try { append({ kind: 'gap', reason }); } catch { /* 缺lease/end就是不可证明，绝不恢复健康。 */ }
  };
  async function leaseState(instanceId) {
    const receipt = await store.lease(instanceId);
    const at = Date.parse(receipt?.latest?.gp_db_created_at), now = new Date(receipt?.db_now).getTime();
    if (receipt?.latest?.lifecycle === 'instance_end') return 'ended';
    return Number.isFinite(at) && Number.isFinite(now) && at <= now && now - at <= 60_000
      && receipt.latest.healthy !== false ? 'live' : 'expired';
  }
  async function checkPending() {
    for (const instanceId of pendingInstances) {
      try {
        const state = await leaseState(instanceId);
        if (state === 'live') continue;
        pendingInstances.delete(instanceId);
        if (state !== 'ended') gap('gp_previous_instance_unclosed');
      } catch { pendingInstances.delete(instanceId); gap('gp_previous_instance_lease_unproven'); }
    }
  }
  async function persist(type, fields) {
    if (closed) return { persisted: false, reason: 'gp_audit_closed' };
    const payload = { ...fields, audit_id: randomUUID(), instance_id: journal.instanceId,
      observer_actor: 'brain:golden-path-observation', source, window_id: windowId,
      legacy_read_enabled: Boolean(flag()), retirement_task_id: '7d312fd8-10b0-4f23-99ec-535a6e782326' };
    try {
      append({ kind: 'intent', event_type: type, payload });
      const row = await store.persist(type, payload);
      if (!row?.id || !row.created_at) throw new Error('gp_audit_ack_missing');
      append({ kind: 'ack', audit_id: payload.audit_id, event_id: row.id,
        created_at: row.created_at, gp_db_created_at: row.gp_db_created_at ?? null, db_time: row.db_time ?? null });
      return { persisted: true, event_id: row.id };
    } catch { gap('gp_audit_persistence_failed'); return { persisted: false, reason: lastGap }; }
  }
  function serial(fn) {
    const pending = tail.then(fn);
    tail = pending.catch(() => {});
    return pending;
  }
  const lifecycle = kind => serial(() => persist('golden_path_observation_health', { lifecycle: kind, healthy }));
  return {
    file: journal.file,
    abandon: reason => { gap(reason); closed = true; },
    status: () => ({ healthy, lastGap, closed }),
    identity: () => ({ window_id: windowId, source }),
    archiveT0(receipt) {
      return serial(() => {
        if (closed || !receipt?.id || !receipt.created_at || receipt.payload?.window_id !== windowId) {
          throw new Error('gp_t0_receipt_invalid');
        }
        archiveGoldenPathT0(path.join(root, windowId), receipt);
        append({ kind: 't0_receipt', event_id: receipt.id, created_at: receipt.created_at, payload: receipt.payload });
      });
    },
    recordHttp(input) {
      validateGoldenPathHttp(input);
      return serial(() => persist('golden_path_legacy_access', { route: input.route, method: input.method,
        path_kind: input.path_kind, outcome: input.allowed ? 'legacy_read_allowed' : 'rejected',
        caller: { kind: 'unknown', identity_source: 'not_bound' } }));
    },
    recordInternal(operation) {
      if (!INTERNAL.has(operation)) return Promise.reject(new Error('gp_internal_operation_invalid'));
      return serial(() => persist('golden_path_legacy_access', { route: `internal:${operation}`,
        method: 'INTERNAL', path_kind: 'read', outcome: 'legacy_read_allowed',
        caller: { kind: 'internal_code', module: 'harness-line-context', operation } }));
    },
    async recover() {
      return serial(async () => {
        let files;
        try { files = journal.files(); } catch { gap('gp_journal_scan_failed'); return; }
        const intents = new Map(), acks = new Set();
        for (const file of files) {
          let rows;
          try { rows = readGoldenPathJournal(file); } catch { gap('gp_journal_corrupt'); continue; }
          const priorId = path.basename(file, '.jsonl');
          const complete = rows.some(r => r.kind === 'intent' && r.payload.lifecycle === 'instance_end'
            && rows.some(ack => ack.kind === 'ack' && ack.audit_id === r.payload.audit_id));
          if (file !== journal.file && !complete) {
            try {
              if (await leaseState(priorId) === 'live') { pendingInstances.add(priorId); continue; }
            } catch { gap('gp_previous_instance_lease_unproven'); }
          }
          for (const row of rows) {
            if (row.kind === 'gap') gap('gp_historical_gap');
            if (row.kind === 'intent') intents.set(row.payload.audit_id, row);
            if (['ack', 'recovered_ack'].includes(row.kind)) acks.add(row.audit_id);
          }
          if (file !== journal.file && rows.length && !rows.some(r => r.kind === 'intent'
              && r.payload.lifecycle === 'instance_end' && acks.has(r.payload.audit_id))) gap('gp_previous_instance_unclosed');
        }
        for (const [id, row] of intents) {
          if (acks.has(id)) continue;
          gap('gp_unacknowledged_intent');
          try {
            const receipt = await store.persist(row.event_type, row.payload);
            if (!receipt?.id || !receipt.created_at) throw new Error('gp_audit_ack_missing');
            append({ kind: 'recovered_ack', audit_id: id, event_id: receipt.id,
              created_at: receipt.created_at, gp_db_created_at: receipt.gp_db_created_at ?? null, db_time: receipt.db_time ?? null });
          } catch { gap('gp_replay_failed'); }
        }
      });
    },
    start: () => lifecycle('instance_start'), listening: () => lifecycle('listening'),
    heartbeat: () => serial(async () => {
      await checkPending(); return persist('golden_path_observation_health', { lifecycle: 'heartbeat', healthy });
    }),
    async stop() { await lifecycle('instance_end'); closed = true; },
  };
}
