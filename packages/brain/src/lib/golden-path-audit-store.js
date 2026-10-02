import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { archiveGoldenPathT0, assertGoldenPathProtectedDirectory } from './golden-path-archive.js';
// GP专属持久插入；公共EventBus容错保持。现有表必须已存在，不执行DDL。
const expired = () => new Error('gp_audit_deadline');
async function acquire(pool, deadline) {
  let abandoned = false, timer;
  try {
    return await Promise.race([pool.connect().then(client => {
      if (abandoned) { client.release(); throw expired(); }
      return client;
    }), new Promise((_, reject) => { timer = setTimeout(() => {
      abandoned = true; reject(expired());
    }, Math.max(1, deadline - Date.now())); })]);
  } finally { clearTimeout(timer); }
}
export function createGoldenPathAuditStore(pool, { timeoutMs = 4_000 } = {}) {
  return {
    async issueT0({ root, windowId, source }) {
      if (!/^[a-f0-9-]{36}$/.test(windowId) || !/^[a-f0-9]{40}$/.test(source?.git_sha ?? '')
          || !source?.manifest || Object.keys(source.manifest).length < 8
          || !Object.values(source.manifest).every(value => /^[a-f0-9]{64}$/.test(value))) throw new Error('gp_t0_issue_invalid');
      assertGoldenPathProtectedDirectory(root);
      const row = await this.persist('golden_path_observation_t0', { audit_id: randomUUID(), window_id: windowId, source });
      if (row.storage_text !== row.clock_utc_text || !['timestamp without time zone', 'timestamp with time zone'].includes(row.storage_type)) {
        throw new Error('gp_t0_storage_unproven');
      }
      const receipt = { id: row.id, created_at: row.created_at, payload: row.payload,
        issuance: { format: 'gp-t0-issuer-v1', storage_type: row.storage_type, storage_text: row.storage_text, clock_utc_text: row.clock_utc_text } };
      const directory = path.join(root, windowId); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      archiveGoldenPathT0(directory, receipt);
      // 只有实际COMMIT与独立fsync回执均确认后才返回可登记的ID，不自动改任务。
      return receipt;
    },
    async lease(instanceId) {
      return (await pool.query({ text: `SELECT clock_timestamp() AS db_now,
        (SELECT payload FROM cecelia_events WHERE source='golden-path-retirement'
          AND event_type='golden_path_observation_health' AND payload->>'instance_id'=$1
          ORDER BY id DESC LIMIT 1) AS latest`, values: [instanceId], query_timeout: 2_000 })).rows[0];
    },
    async persist(type, payload, { isolatedRequestOnly = false } = {}) {
      if (Object.hasOwn(payload, 'gp_db_created_at')) throw new Error('gp_audit_reserved_time');
      if (isolatedRequestOnly && (type !== 'golden_path_legacy_access'
          || payload.window_id !== 'isolated-request-only' || payload.observation_mode !== 'isolated_request_only'
          || Object.hasOwn(payload, 'source') || Object.hasOwn(payload, 'instance_id'))) throw new Error('gp_isolated_payload_invalid');
      const deadline = Date.now() + timeoutMs;
      const remaining = () => { const left = deadline - Date.now(); if (left <= 0) throw expired(); return left; };
      const client = await acquire(pool, deadline);
      let commitSent = false, destroy = false;
      const query = async (text, values) => {
        const left = remaining();
        if (text !== 'BEGIN') await client.query({
          text: "SELECT set_config('statement_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true)",
          values: [`${left}ms`], query_timeout: left,
        });
        const result = await client.query({ text, values, query_timeout: remaining() });
        remaining(); return result;
      };
      try {
        await query('BEGIN');
        if (isolatedRequestOnly) {
          // 必须是执行INSERT的同一连接；env/URL不能证明实际库隔离。
          const name = (await query('SELECT current_database() AS name')).rows[0]?.name;
          if (typeof name !== 'string' || !/(?:^|[_-])(test|testing|dev|scratch|staging|preview|eval|evaluator)$/i.test(name)) {
            throw new Error('gp_isolated_database_unproven');
          }
        }
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [payload.audit_id]);
        const found = await query(
          `SELECT id,event_type,payload,(payload->>'gp_db_created_at')::timestamptz AS created_at,
             payload->>'gp_db_created_at' AS gp_db_created_at,clock_timestamp() AS db_time
           FROM cecelia_events WHERE source='golden-path-retirement' AND payload->>'audit_id'=$1`,
          [payload.audit_id],
        );
        if (found.rows.length > 1) throw new Error('gp_audit_duplicate');
        let row = found.rows[0];
        if (type === 'golden_path_observation_t0' && row) throw new Error('gp_t0_existing_unissued');
        let storage = 'stamp.time';
        if (type === 'golden_path_observation_t0') {
          const kind = (await query(`SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute
            WHERE attrelid=to_regclass('cecelia_events') AND attname='created_at' AND NOT attisdropped`)).rows[0]?.type;
          if (kind === 'timestamp without time zone') storage = "stamp.time AT TIME ZONE 'UTC'";
          else if (kind !== 'timestamp with time zone') throw new Error('gp_t0_storage_unproven');
        }
        const originalPayload = row ? Object.fromEntries(Object.entries(row.payload).filter(([key]) => key !== 'gp_db_created_at')) : null;
        if (row && (row.event_type !== type || JSON.stringify(originalPayload) !== JSON.stringify(payload))) {
          // JSONB键序不稳定，按键规范化后比较内容。
          const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
            : Array.isArray(value) ? value.map(canonical) : value;
          if (row.event_type !== type || JSON.stringify(canonical(originalPayload)) !== JSON.stringify(canonical(payload))) {
            throw new Error('gp_audit_identity_conflict');
          }
        }
        if (!row) row = (await query(
          `WITH stamp AS (SELECT clock_timestamp() AS time)
           INSERT INTO cecelia_events(event_type,source,payload,created_at)
           SELECT $1,'golden-path-retirement',$2::jsonb||jsonb_build_object('gp_db_created_at',stamp.time),${storage} FROM stamp
           RETURNING id,payload,pg_typeof(created_at)::text AS storage_type,
             CASE WHEN pg_typeof(created_at)='timestamp without time zone'::regtype
               THEN to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS.US')
               ELSE to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') END AS storage_text,
             to_char((payload->>'gp_db_created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') AS clock_utc_text,(payload->>'gp_db_created_at')::timestamptz AS created_at,
             payload->>'gp_db_created_at' AS gp_db_created_at,clock_timestamp() AS db_time`, [type, JSON.stringify(payload)],
        )).rows[0];
        if (!row?.id || !row.created_at || !/([zZ]|[+-]\d\d:\d\d)$/.test(row.gp_db_created_at ?? '')
            || Date.parse(row.gp_db_created_at) !== new Date(row.created_at).getTime()) throw new Error('gp_audit_ack_missing');
        remaining(); commitSent = true;
        await query('COMMIT');
        return row;
      } catch (error) {
        // 未知COMMIT不假称zero；销毁连接，journal保gap并以audit_id重放核事实。
        if (commitSent) destroy = true;
        else try { await client.query({ text: 'ROLLBACK', query_timeout: 1_000 }); } catch { destroy = true; }
        throw error;
      } finally { client.release(destroy); }
    },
  };
}
