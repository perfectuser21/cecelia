import { companyFormalRevision, companyMetric, compatibleValue, compatibleProgress, COMPANY_KR_DATABASE, COMPANY_METRIC_MODE } from '../lib/company-kr-metrics.js';
import { appendCompanyReceipt, lockCompanyReceipt } from '../lib/company-kr-observations.js';

/** 正式字段总是由Notion回读；AI列更新时间不会产生正式事件。 */
export async function ingestCompanyFormal(pool, krId, remote, { objectiveId, archived = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let kr = (await client.query('SELECT * FROM key_results WHERE id=$1', [krId])).rows[0];
    if (kr?.metadata?.metric_mode !== COMPANY_METRIC_MODE || kr.custom_props?.company_notion?.page_id !== remote.page_id) throw new Error('公司正式值来源不匹配');
    const task = await lockCompanyReceipt(client, kr.metadata.imported_snapshot.task_id);
    kr = (await client.query('SELECT * FROM key_results WHERE id=$1 FOR UPDATE', [krId])).rows[0];
    const before = kr.metadata.company_metric;
    const metric = archived ? before : companyMetric('start' in remote ? remote.start : before.start, 'current' in remote ? remote.current : before.current, 'target' in remote ? remote.target : before.target);
    const source = { ...kr.custom_props.company_notion, ...('goal_id' in remote ? { goal_id: remote.goal_id } : {}), ...('area_ids' in remote ? { area_ids: remote.area_ids } : {}) };
    const metadata = { ...kr.metadata, company_metric: metric, ...('status' in remote ? { company_status: remote.status } : {}), company_source_archived: archived };
    delete metadata.company_sync_error;
    const next = { ...kr, title: remote.title ?? kr.title, unit: remote.unit ?? kr.unit, objective_id: objectiveId ?? kr.objective_id,
      status: archived ? 'archived' : (kr.metadata.company_source_archived ? 'active' : kr.status), metadata, custom_props: { ...kr.custom_props, company_notion: source } };
    const changed = companyFormalRevision(kr) !== companyFormalRevision(next);
    const pending = kr.metadata.company_projection_pending;
    if (!changed && !pending) { await client.query('COMMIT'); return { kr, changed: false, claimed: false }; }
    const event = { kind: archived ? 'company_source_archived' : 'human_formal_claim', actor: 'notion-inlet', fact: archived ? '来源页明确archived/in_trash，停止公司KR分析' : '公司KR正式数字与映射回读，以原Notion表值为准', source_page_id: remote.page_id,
      editor: remote.editor ?? null, before, after: metric, before_revision: companyFormalRevision(kr), after_revision: companyFormalRevision(next),
      ...(pending ? { superseded_machine_attempt: pending } : {}), observed_at: remote.updated_at || new Date().toISOString(),
      evidence: [{ source: `notion:${remote.page_id}`, fact: archived ? '完整快照后逐页读取确认归档' : '比较正式列，AI列不构成正式变更' }] };
    metadata.last_formal_inlet = event;
    if (changed) metadata.validation_state = 'unverified';
    if (pending) {
      metadata.company_projection_retired = { attempt: pending, retired_at: new Date().toISOString(), reason: '正式Current已改为仅人类输入，旧待推值留证' };
      delete metadata.company_projection_pending;
    }
    const display = compatibleProgress(metric);
    const saved = await client.query(`UPDATE key_results SET title=$2,status=$3,unit=$4,objective_id=$5,current_value=$6,target_value=$7,
      progress=$8,progress_pct=$9,metadata=$10::jsonb,custom_props=$11::jsonb,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
    [kr.id, next.title, next.status, next.unit, next.objective_id, compatibleValue(metric.current), compatibleValue(metric.target), display.progress, display.progress_pct, JSON.stringify(metadata), JSON.stringify(next.custom_props)]);
    await client.query(`INSERT INTO notion_ingest_receipts(notion_page_id,notion_db_id,brain_table,brain_id,last_edited_time,history)
      VALUES($1,$2,'key_results',$3,$4,$5::jsonb)
      ON CONFLICT(notion_page_id) DO UPDATE SET last_edited_time=EXCLUDED.last_edited_time,ingested_at=NOW(),history=COALESCE(notion_ingest_receipts.history,'[]'::jsonb)||EXCLUDED.history`,
    [`${remote.page_id}#company-formal`, COMPANY_KR_DATABASE, kr.id, event.observed_at, JSON.stringify([event])]);
    await appendCompanyReceipt(client, task, event);
    await client.query('COMMIT');
    return { kr: saved.rows[0], changed, claimed: before.current !== metric.current };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** 无效/不可读来源停止分析；缺失不是归档证据。相同错误不反复产生事件。 */
export async function markCompanySyncError(pool, krId, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let kr = (await client.query('SELECT * FROM key_results WHERE id=$1', [krId])).rows[0];
    if (kr?.metadata?.metric_mode !== COMPANY_METRIC_MODE) throw new Error('公司来源不存在');
    const task = await lockCompanyReceipt(client, kr.metadata.imported_snapshot.task_id);
    kr = (await client.query('SELECT * FROM key_results WHERE id=$1 FOR UPDATE', [krId])).rows[0];
    if (kr.metadata.company_sync_error?.reason === reason) { await client.query('COMMIT'); return { changed: false }; }
    const changed = !kr.metadata.company_sync_error;
    const error = { reason, at: new Date().toISOString() };
    await client.query('UPDATE key_results SET metadata=$2::jsonb,updated_at=clock_timestamp() WHERE id=$1', [krId, JSON.stringify({ ...kr.metadata, company_sync_error: error })]);
    await appendCompanyReceipt(client, task, { kind: 'company_source_unavailable', actor: 'notion-inlet', fact: '公司KR来源不完整，停止分析，未推断归档', kr_id: krId,
      observed_at: error.at, evidence: [{ source: `notion:${kr.custom_props.company_notion.page_id}`, fact: reason }] });
    await client.query('COMMIT'); return { changed };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function ingestCompanyCurrent(pool, krId, remote) {
  return ingestCompanyFormal(pool, krId, { page_id: remote.page_id, current: remote.current, updated_at: remote.updated_at, editor: remote.editor });
}
export async function ingestCompanyTarget(pool, krId, remote) {
  return (await ingestCompanyFormal(pool, krId, { page_id: remote.page_id, start: remote.start, target: remote.target, updated_at: remote.updated_at, editor: remote.editor })).kr;
}
