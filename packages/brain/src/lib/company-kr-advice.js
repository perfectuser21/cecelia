import { createHash } from 'node:crypto';
import { companyFormalRevision, companyKrView, isCompanyKr, isActiveCompanyKr, rawDecimal } from './company-kr-metrics.js';

const FIELDS = ['task_id', 'actor', 'source_page_id', 'formal_revision', 'suggested_current', 'suggested_target', 'reason', 'evidence', 'analyzed_at', 'idempotency_key'];
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function validate(input) {
  if (!input || Object.keys(input).some(k => !FIELDS.includes(k))) fail('建议含非授权字段');
  for (const key of ['task_id', 'source_page_id', 'formal_revision', 'idempotency_key', 'reason']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) fail(`建议缺少${key}`);
  }
  if (input.actor !== 'brain-openclaw-reaper') fail('建议只能由可信收割器入账', 403);
  if (!Number.isFinite(Date.parse(input.analyzed_at))) fail('analyzed_at必须为有效时间');
  for (const key of ['suggested_current', 'suggested_target']) {
    if (!(key in input) || (input[key] !== null && (typeof input[key] === 'boolean' || rawDecimal(input[key]) === null))) fail(`${key}必须为有限数值或null`);
  }
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 20 || input.evidence.some(e => !e || typeof e.fact !== 'string' || !e.fact.trim() || typeof e.source !== 'string' || !e.source.trim())) fail('建议必须带fact/source证据');
  return Object.fromEntries(FIELDS.map(k => [k, k.startsWith('suggested_') ? rawDecimal(input[k]) : input[k]]));
}

/** 可信任务快照、正式版本与建议收据同事务校验；不会写任何正式指标列。 */
export async function saveCompanyAdvice(pool, krId, input) {
  const advice = validate(input);
  const semantic = Object.fromEntries(Object.entries(advice).filter(([key]) => key !== 'analyzed_at'));
  const fingerprint = createHash('sha256').update(JSON.stringify({ kr_id: krId, ...semantic })).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = (await client.query('SELECT id,status,task_type,executor_kind,payload,result FROM tasks WHERE id=$1 FOR UPDATE', [input.task_id])).rows[0];
    if (!task) fail('建议任务不存在', 404);
    const kr = (await client.query('SELECT *,updated_at::text AS observation_version FROM key_results WHERE id=$1 FOR UPDATE', [krId])).rows[0];
    if (!kr || !isCompanyKr(kr)) fail('公司KR不存在', 404);
    const old = (task.result?.company_kr_advice || []).find(a => a.idempotency_key === input.idempotency_key);
    if (old) {
      if (old.fingerprint !== fingerprint) fail('幂等键已用于不同建议', 409);
      await client.query('COMMIT');
      return { success: true, duplicate: true, receipt: old, item: companyKrView(kr) };
    }
    const snapshot = task.payload?.company_kr_analysis;
    const item = snapshot?.items?.find(item => item.id === krId && item.source_page_id === input.source_page_id && item.formal_revision === input.formal_revision);
    if (task.status !== 'in_progress' || task.task_type !== 'qiumi_task' || task.executor_kind !== 'openclaw-agent' || snapshot?.version !== 1 || !snapshot.snapshot_id
      || !item) fail('建议任务与本次公司KR分析快照不匹配', 403);
    if (advice.evidence.some(e => !item.evidence?.some(known => known.source === e.source && known.fact === e.fact))) fail('建议证据不属于该KR任务输入快照', 403);
    if (advice.suggested_current !== null && (!item.observation?.evidence?.length || rawDecimal(item.observation.current_value) === null
      || Number(advice.suggested_current) !== Number(item.observation.current_value))) fail('建议当前值须有对应独立观测证据且与观测数值相等', 409);
    if (kr.custom_props?.company_notion?.page_id !== input.source_page_id) fail('公司KR来源不匹配', 409);
    if (!isActiveCompanyKr(kr)) fail('公司KR已暂停、完成或归档', 409);
    if (companyFormalRevision(kr) !== input.formal_revision) fail('stale：正式值已变化，请重新分析', 409);
    if (kr.metadata?.company_advice?.analyzed_at && Date.parse(input.analyzed_at) < Date.parse(kr.metadata.company_advice.analyzed_at)) fail('建议早于已保存分析', 409);
    const receipt = { ...advice, kr_id: krId, fingerprint, fact: 'AI建议独立入账，正式数字由主理人在原Notion表决定填写' };
    const saved = await client.query('UPDATE key_results SET metadata=$2::jsonb,updated_at=clock_timestamp() WHERE id=$1 RETURNING *,updated_at::text AS observation_version', [krId, JSON.stringify({ ...kr.metadata, company_advice: receipt })]);
    await client.query('UPDATE tasks SET result=$2::jsonb,updated_at=NOW() WHERE id=$1', [task.id, JSON.stringify({ ...task.result, company_kr_advice: [...(task.result?.company_kr_advice || []), receipt] })]);
    await client.query('COMMIT');
    return { success: true, duplicate: false, receipt, item: companyKrView(saved.rows[0]) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
