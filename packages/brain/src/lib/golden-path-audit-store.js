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
    async lease(instanceId) {
      return (await pool.query({ text: `SELECT clock_timestamp() AS db_now,
        (SELECT payload FROM cecelia_events WHERE source='golden-path-retirement'
          AND event_type='golden_path_observation_health' AND payload->>'instance_id'=$1
          ORDER BY id DESC LIMIT 1) AS latest`, values: [instanceId], query_timeout: 2_000 })).rows[0];
    },
    async persist(type, payload) {
      if (Object.hasOwn(payload, 'gp_db_created_at')) throw new Error('gp_audit_reserved_time');
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
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [payload.audit_id]);
        const found = await query(
          `SELECT id,event_type,payload,(payload->>'gp_db_created_at')::timestamptz AS created_at,
             payload->>'gp_db_created_at' AS gp_db_created_at,clock_timestamp() AS db_time
           FROM cecelia_events WHERE source='golden-path-retirement' AND payload->>'audit_id'=$1`,
          [payload.audit_id],
        );
        if (found.rows.length > 1) throw new Error('gp_audit_duplicate');
        let row = found.rows[0];
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
           SELECT $1,'golden-path-retirement',$2::jsonb||jsonb_build_object('gp_db_created_at',stamp.time),stamp.time FROM stamp
           RETURNING id,(payload->>'gp_db_created_at')::timestamptz AS created_at,
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
