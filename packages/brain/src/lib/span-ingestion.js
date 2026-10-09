/** 新Span按真实发生位置幂等；摘要只信任服务端规范化的持久字段。 */
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
import { normalizeSpanProvenance,validateSpanBinding,SPAN_IDENTITY_FIELDS } from './span-provenance.js';
const SPAN_FIELDS = ['run_id','workflow_id','activity_id','step_id','enabler_id','started_at','ended_at','wait_ms',
  'executor_kind','executor_id','model','tokens_in','tokens_out','cost_usd','attempts','fallback','outcome','evidence','occurrence_key','payload_sha256'];
const INSERT = `INSERT INTO spans (${SPAN_FIELDS.join(',')}) VALUES (${SPAN_FIELDS.map((_,i)=>`$${i+1}`).join(',')})`;
const LEGACY_SQL = `${INSERT} ON CONFLICT (run_id, (COALESCE(step_id, activity_id, enabler_id)), started_at) WHERE occurrence_key IS NULL DO NOTHING RETURNING id`;
const OCCURRENCE_SQL = `${INSERT} ON CONFLICT (run_id, occurrence_key) WHERE occurrence_key IS NOT NULL DO NOTHING RETURNING id`;
const V2_FIELDS=[...SPAN_FIELDS,'identity_protocol',...SPAN_IDENTITY_FIELDS];
const V2_SQL=`INSERT INTO spans (${V2_FIELDS.join(',')}) VALUES (${V2_FIELDS.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT (run_id, occurrence_key) WHERE occurrence_key IS NOT NULL DO NOTHING RETURNING id`;

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
  const provenance=normalizeSpanProvenance(raw);
  const payload_sha256 = occurrence_key === null ? null : stepSha256(provenance.identity_protocol===2?{...normalized,...provenance}:normalized);
  return { params: [...params, occurrence_key, payload_sha256], occurrence_key, payload_sha256,identity_protocol:provenance.identity_protocol,provenance,normalized };
}

export async function writeSpans(pool, rows) {
  // 按实际冲突键固定取锁顺序；保存输入序号供响应恢复调用者的顺序。
  const ordered = rows.map((row, index) => ({ row, index, key: JSON.stringify(row.occurrence_key === null
    ? [row.params[0], 'legacy', row.params[3] || row.params[2] || row.params[4], row.params[5]]
    : [row.params[0], 'occurrence', row.occurrence_key]) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 与首次绑定使用同一运行锁；排序避免多运行批次反序死锁。
    // 旧协议由数据库触发器校验，迁移前客户端仍保持原SQL形状。
    const v2=rows.filter(row=>row.identity_protocol===2);
    if(v2.length){
      for(const runId of [...new Set(ordered.map(({row})=>row.params[0]))])await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,515))',[runId]);
      const {getRunDefinitionBinding}=await import('./run-definition-binding.js');
      const contexts=new Map();
      for(const row of v2){
        if(!contexts.has(row.params[0]))contexts.set(row.params[0],await getRunDefinitionBinding(client,row.params[0]));
        validateSpanBinding(row,contexts.get(row.params[0]));
      }
    }
    const inserted = [];
    for (const { row, index } of ordered) {
      const result = await client.query(row.identity_protocol===2?V2_SQL:row.occurrence_key === null ? LEGACY_SQL : OCCURRENCE_SQL,
        row.identity_protocol===2?[...row.params,2,...SPAN_IDENTITY_FIELDS.map(field=>row.provenance[field])]:row.params);
      if (result.rows.length) inserted.push({ id: result.rows[0].id, index });
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
    const ids = inserted.sort((a, b) => a.index - b.index).map(row => row.id);
    return { inserted: ids.length, skipped: rows.length - ids.length, count: rows.length, ids };
  } catch (error) {
    await client.query('ROLLBACK');
    if(error.code==='23514'&&error.constraint?.startsWith('spans_bound_run_'))Object.assign(error,{status:422,code:error.constraint==='spans_bound_run_protocol'?'SPAN_IDENTITY_PROTOCOL_REQUIRED':'SPAN_RUN_IDENTITY_MISMATCH'});
    throw error;
  }
  finally { client.release(); }
}
