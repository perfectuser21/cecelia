/** 新Span按真实发生位置幂等；摘要只信任服务端规范化的持久字段。 */
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
const SPAN_FIELDS = ['run_id','workflow_id','activity_id','step_id','enabler_id','started_at','ended_at','wait_ms',
  'executor_kind','executor_id','model','tokens_in','tokens_out','cost_usd','attempts','fallback','outcome','evidence','occurrence_key','payload_sha256'];
const INSERT = `INSERT INTO spans (${SPAN_FIELDS.join(',')}) VALUES (${SPAN_FIELDS.map((_,i)=>`$${i+1}`).join(',')})`;
const LEGACY_SQL = `${INSERT} ON CONFLICT (run_id, (COALESCE(step_id, activity_id, enabler_id)), started_at) WHERE occurrence_key IS NULL DO NOTHING RETURNING id`;
const OCCURRENCE_SQL = `${INSERT} ON CONFLICT (run_id, occurrence_key) WHERE occurrence_key IS NOT NULL DO NOTHING RETURNING id`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXECUTOR_KINDS = new Set(['code', 'agent', 'human']);
const OUTCOMES = new Set(['pass', 'fail', 'skipped', 'unknown']);
const TARGET_FIELDS = ['activity_id', 'step_id', 'enabler_id'];

export function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(`${field} must be a uuid`);
  return value.toLowerCase();
}

function optionalTimestamp(value, field, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} must be an ISO timestamp`);
  return d.toISOString();
}

function optionalInt(value, field, { min = null } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} must be an integer`);
  if (min !== null && n < min) throw new Error(`${field} must be >= ${min}`);
  return n;
}

export function normalizeSpan(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`spans[${index}] must be an object`);
  const runId = typeof raw.run_id === 'string' ? raw.run_id.trim() : '';
  if (!runId) throw new Error(`spans[${index}].run_id is required`);

  const targets = Object.fromEntries(TARGET_FIELDS.map((f) => [f, optionalUuid(raw[f], `spans[${index}].${f}`)]));
  if (!TARGET_FIELDS.some((f) => targets[f])) {
    throw new Error(`spans[${index}] needs at least one of activity_id / step_id / enabler_id`);
  }

  const executorKind = raw.executor_kind;
  if (!EXECUTOR_KINDS.has(executorKind)) throw new Error(`spans[${index}].executor_kind must be one of code|agent|human`);
  const outcome = raw.outcome === undefined || raw.outcome === null ? 'unknown' : raw.outcome;
  if (!OUTCOMES.has(outcome)) throw new Error(`spans[${index}].outcome must be one of pass|fail|skipped|unknown`);

  const attempts = raw.attempts === undefined || raw.attempts === null ? 1 : optionalInt(raw.attempts, `spans[${index}].attempts`, { min: 1 });
  const fallback = raw.fallback === undefined || raw.fallback === null ? false : raw.fallback === true || raw.fallback === 'true';
  const evidence = raw.evidence === undefined || raw.evidence === null ? null : JSON.stringify(raw.evidence);
  const costUsd = raw.cost_usd === undefined || raw.cost_usd === null || raw.cost_usd === '' ? null : Number(raw.cost_usd);
  if (costUsd !== null && !Number.isFinite(costUsd)) throw new Error(`spans[${index}].cost_usd must be a number`);

  const params = [
    runId,
    optionalUuid(raw.workflow_id, `spans[${index}].workflow_id`),
    targets.activity_id,
    targets.step_id,
    targets.enabler_id,
    optionalTimestamp(raw.started_at, `spans[${index}].started_at`, true),
    optionalTimestamp(raw.ended_at, `spans[${index}].ended_at`),
    optionalInt(raw.wait_ms, `spans[${index}].wait_ms`, { min: 0 }),
    executorKind,
    typeof raw.executor_id === 'string' && raw.executor_id ? raw.executor_id : null,
    typeof raw.model === 'string' && raw.model ? raw.model : null,
    optionalInt(raw.tokens_in, `spans[${index}].tokens_in`, { min: 0 }),
    optionalInt(raw.tokens_out, `spans[${index}].tokens_out`, { min: 0 }),
    costUsd,
    attempts,
    fallback,
    outcome,
    evidence,
  ];
  const occurrence_key = raw.occurrence_key ?? null;
  if (occurrence_key !== null && (typeof occurrence_key !== 'string' || !occurrence_key.trim())) throw new Error(`spans[${index}].occurrence_key must be a non-empty string`);
  const normalized = Object.fromEntries(SPAN_FIELDS.slice(0, 18).map((field, i) => [field, params[i]]));
  normalized.evidence = evidence === null ? null : JSON.parse(evidence);
  const payload_sha256 = occurrence_key === null ? null : stepSha256(normalized);
  return { params: [...params, occurrence_key, payload_sha256], occurrence_key, payload_sha256 };
}

export async function writeSpans(pool, rows) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [];
    for (const row of rows) {
      const result = await client.query(row.occurrence_key === null ? LEGACY_SQL : OCCURRENCE_SQL, row.params);
      if (result.rows.length) ids.push(result.rows[0].id);
      else if (row.occurrence_key !== null) {
        // INSERT等待竞争事务后，下一条READ COMMITTED查询读取获胜者，不覆盖执行事实。
        const existing = (await client.query('SELECT payload_sha256 FROM spans WHERE run_id=$1 AND occurrence_key=$2',
          [row.params[0], row.occurrence_key])).rows[0];
        if (existing?.payload_sha256 !== row.payload_sha256) throw Object.assign(new Error('同一发生位置已存在不同内容的Span'), {
          status: 409, code: 'SPAN_OCCURRENCE_CONFLICT', run_id: row.params[0], occurrence_key: row.occurrence_key,
        });
      }
    }
    await client.query('COMMIT');
    return { inserted: ids.length, skipped: rows.length - ids.length, count: rows.length, ids };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
