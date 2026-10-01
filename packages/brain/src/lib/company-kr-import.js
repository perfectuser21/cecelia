import { COMPANY_GOAL_DATABASE, COMPANY_KR_CATALOG, COMPANY_FORMULA, COMPANY_KR_DATABASE, COMPANY_METRIC_MODE, companyMetric, compatibleValue, compatibleProgress, rawDecimal } from './company-kr-metrics.js';
import { lockCompanyReceipt, appendCompanyReceipt } from './company-kr-observations.js';

function validate(data) {
  if (!Array.isArray(data.records) || !Array.isArray(data.goals)) throw new Error('公司导入缺少完整快照');
  for (const list of [data.records, data.goals]) if (new Set(list.map(r => r.page_id)).size !== list.length) throw new Error('sourcepage重复');
  for (const goal of data.goals) if (goal.database_id && goal.database_id !== COMPANY_GOAL_DATABASE) throw new Error('Goal来源库归属错误');
  for (const row of data.records) {
    if (!row.page_id || !data.goals.some(g => g.page_id === row.goal_id)) throw new Error('KR缺少已验证Goal来源');
    if (row.database_id && row.database_id !== COMPANY_KR_DATABASE) throw new Error('KR来源库归属错误');
    if (!(COMPANY_KR_CATALOG.find(c => c.page_id === row.page_id)?.unit || row.unit) || [row.start, row.current, row.target].some(v => rawDecimal(v) === null)) throw new Error('KR缺少单位或正式数值');
  }
}

/** source page ID是唯一认领键；初始8项catalog仅提供历史单位。 */
export async function importCompanyKrs(pool, data, { actor, task_id } = {}) {
  validate(data);
  if (!actor || !task_id) throw new Error('导入必须关联actor与已登记任务');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await lockCompanyReceipt(client, task_id);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['company-kr-import']);
    const objectives = {}, ids = [], createdIds = [];
    for (const goal of data.goals) {
      const existing = await client.query("SELECT id,title,metadata,custom_props FROM objectives WHERE custom_props->'company_notion'->>'page_id'=$1 FOR UPDATE", [goal.page_id]);
      if (existing.rows.length > 1) throw new Error('Goal来源存在重复映射');
      const old = existing.rows[0];
      if (old && (old.metadata?.source_system !== 'notion-company-okr' || old.custom_props?.company_notion?.database_id !== COMPANY_GOAL_DATABASE)) throw new Error('Goal来源已有其它归属');
      const metadata = { ...old?.metadata, company_status: goal.status, source_system: 'notion-company-okr' };
      const props = { ...old?.custom_props, company_notion: { database_id: COMPANY_GOAL_DATABASE, page_id: goal.page_id, area_ids: goal.area_ids || [] } };
      let id = old?.id;
      if (!old) {
        id = (await client.query("INSERT INTO objectives(title,status,metadata,custom_props) VALUES($1,'active',$2::jsonb,$3::jsonb) RETURNING id", [goal.title, JSON.stringify(metadata), JSON.stringify(props)])).rows[0].id;
      } else if (old.title !== goal.title || JSON.stringify(old.metadata) !== JSON.stringify(metadata) || JSON.stringify(old.custom_props) !== JSON.stringify(props)) {
        await client.query('UPDATE objectives SET title=$2,metadata=$3::jsonb,custom_props=$4::jsonb,updated_at=clock_timestamp() WHERE id=$1', [id, goal.title, JSON.stringify(metadata), JSON.stringify(props)]);
      }
      objectives[goal.page_id] = id;
    }
    for (const row of data.records) {
      const existing = await client.query("SELECT id,objective_id,metadata,custom_props FROM key_results WHERE custom_props->'company_notion'->>'page_id'=$1 FOR UPDATE", [row.page_id]);
      if (existing.rows.length > 1) throw new Error('KR来源存在重复映射');
      if (existing.rows[0]) {
        if (existing.rows[0].metadata?.metric_mode !== COMPANY_METRIC_MODE || existing.rows[0].custom_props?.company_notion?.database_id !== COMPANY_KR_DATABASE) throw new Error('KR来源已有其它归属');
        ids.push(existing.rows[0].id); continue;
      }
      const seed = COMPANY_KR_CATALOG.find(c => c.page_id === row.page_id), unit = seed?.unit || row.unit;
      const metric = companyMetric(row.start, row.current, row.target), display = compatibleProgress(metric);
      const metadata = { metric_mode: COMPANY_METRIC_MODE, company_metric: metric, company_formula: COMPANY_FORMULA, progress_source: COMPANY_METRIC_MODE,
        company_status: row.status, unit_source: seed ? { field: 'original_title', title: seed.title } : { field: 'Unit' }, validation_state: 'unverified',
        imported_snapshot: { actor, task_id, source_updated_at: row.updated_at, evidence: '原Notion页正式值快照，独立于机器观察与建议' } };
      if (row.page_id === '3dbc40c2-ba63-8158-808a-e81bd769eb6b') metadata.metric_window = { observed: 'snapshot', limitation: '既有F1/F3/F4/N1快照算法；未验证连续7天' };
      const inserted = await client.query(`INSERT INTO key_results(objective_id,title,status,current_value,target_value,unit,metadata,custom_props,progress,progress_pct)
        VALUES($1,$2,'active',$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING id`,
      [objectives[row.goal_id], row.title, compatibleValue(metric.current), compatibleValue(metric.target), unit, JSON.stringify(metadata), JSON.stringify({ company_notion: { database_id: COMPANY_KR_DATABASE, page_id: row.page_id, goal_id: row.goal_id, area_ids: row.area_ids || [] } }), display.progress, display.progress_pct]);
      ids.push(inserted.rows[0].id); createdIds.push(inserted.rows[0].id);
    }
    const registry = await client.query("SELECT vessel,face FROM notion_projection_map WHERE notion_db_id=$1 AND brain_table='key_results' FOR UPDATE", [COMPANY_KR_DATABASE]);
    if (registry.rows.some(r => r.vessel !== 'notion-company-key-results' || r.face !== 'inlet')) throw new Error('公司投影库已有其它归属');
    await client.query(`INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status,notes)
      VALUES($1,'Key Results','inlet','key_results','both','notion-company-key-results','active','正式Start/Current/Target与来源入站；机器仅出站独立AI建议和观察列')
      ON CONFLICT(notion_db_id,COALESCE(brain_table,'')) DO UPDATE SET direction='both',status='active',notes=EXCLUDED.notes,updated_at=NOW()`, [COMPANY_KR_DATABASE]);
    if (createdIds.length) await appendCompanyReceipt(client, task, { actor, fact: '公司KR按sourcepage动态幂等纳入Brain', evidence: data.records.map(r => ({ source: `notion:${r.page_id}`, fact: `Goal:${r.goal_id}` })), created: createdIds.length, ids: createdIds, observed_at: new Date().toISOString() });
    await client.query('COMMIT');
    return { success: true, created: createdIds.length, changed_ids: createdIds, company_kr_count: ids.length, ids, objectives };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
