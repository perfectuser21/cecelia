import { companyKrView, companyVersion, canonicalCompanyVersion, isCompanyKr, isActiveCompanyKr, rawDecimal } from './company-kr-metrics.js';

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export async function lockCompanyReceipt(client, taskId) {
  const { rows } = await client.query('SELECT id, result FROM tasks WHERE id=$1 FOR UPDATE', [taskId]);
  if (!rows[0]) fail('证据任务不存在', 404);
  return rows[0];
}
export async function appendCompanyReceipt(client, task, observation) {
  const result = { ...(task.result || {}), metric_observations: [...(task.result?.metric_observations || []), observation] };
  await client.query('UPDATE tasks SET result=$2::jsonb, updated_at=NOW() WHERE id=$1', [task.id, JSON.stringify(result)]);
}

function validate(input) {
  if (!input.task_id || !input.actor?.trim() || !input.idempotency_key?.trim() || !input.source_page_id || !input.expected_updated_at) fail('观察必须带task_id、actor、source_page_id、幂等键及版本');
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 20
      || input.evidence.some(e => typeof e.fact !== 'string' || !e.fact.trim() || typeof e.source !== 'string' || !e.source.trim())) fail('观察必须带fact/source证据');
  if (!Number.isFinite(Date.parse(input.observed_at))) fail('observed_at必须为有效时刻');
  if (!Number.isFinite(Date.parse(input.expected_updated_at))) fail('expected_updated_at必须为有效版本');
  if (rawDecimal(input.current_value) == null) fail('current_value必须为有限原指标值');
}

/** 注册 task 的结果账和 KR 观察在同一事务落地；重复收据不得再次覆盖指标。 */
export async function observeCompanyKr(pool, krId, input) {
  validate(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await lockCompanyReceipt(client, input.task_id);
    const { rows } = await client.query('SELECT *, updated_at::text AS observation_version FROM key_results WHERE id=$1 FOR UPDATE', [krId]);
    const kr = rows[0];
    if (!kr || !isCompanyKr(kr)) fail('公司KR不存在', 404);
    if (!isActiveCompanyKr(kr)) fail('公司KR已暂停、完成或归档', 409);
    if (kr.custom_props?.company_notion?.page_id !== input.source_page_id || kr.unit !== input.unit) fail('sourcepage或原unit不匹配', 409);
    const duplicate = (task.result?.metric_observations || []).find(e => e.idempotency_key === input.idempotency_key);
    if (duplicate) {
      if (duplicate.kr_id !== kr.id || duplicate.current_value !== rawDecimal(input.current_value)) fail('幂等键已用于其它观察', 409);
      await client.query('COMMIT');
      return { success: true, item: companyKrView(kr), duplicate: true };
    }
    if (canonicalCompanyVersion(companyVersion(kr)) !== canonicalCompanyVersion(input.expected_updated_at)) fail('stale：人类或较新观察已更新，请重新读取', 409);
    if (kr.metadata?.last_observation?.observed_at && Date.parse(input.observed_at) < Date.parse(kr.metadata.last_observation.observed_at)) fail('观察早于现有证据', 409);
    const receipt = { task_id: input.task_id, idempotency_key: input.idempotency_key, kr_id: kr.id, source_page_id: input.source_page_id, actor: input.actor, observed_at: input.observed_at, fact: '公司KR独立原指标观察，正式值由主理人填写', evidence: input.evidence, unit: input.unit, current_value: rawDecimal(input.current_value) };
    const metadata = { ...kr.metadata, last_observation: receipt };
    const saved = await client.query(
      `UPDATE key_results SET metadata=$2::jsonb, updated_at=clock_timestamp() WHERE id=$1 RETURNING *, updated_at::text AS observation_version`,
      [kr.id, JSON.stringify(metadata)]);
    await appendCompanyReceipt(client, task, receipt);
    await client.query('COMMIT');
    return { success: true, item: companyKrView(saved.rows[0]), duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
