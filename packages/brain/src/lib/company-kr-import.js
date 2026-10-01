import { COMPANY_GOALS, COMPANY_GOAL_DATABASE, COMPANY_KR_CATALOG, COMPANY_FORMULA, COMPANY_KR_DATABASE, COMPANY_METRIC_MODE, companyMetric, compatibleValue, compatibleProgress } from './company-kr-metrics.js';
import { lockCompanyReceipt, appendCompanyReceipt } from './company-kr-observations.js';

function validate(data) {
  if (data.records?.length !== 8 || data.goals?.length !== 3) throw new Error('公司导入必须恰好8条KR与3条Goal');
  if (new Set(data.records.map(r => r.page_id)).size !== 8 || new Set(data.goals.map(r => r.page_id)).size !== 3) throw new Error('sourcepage重复');
  for (const source of COMPANY_KR_CATALOG) {
    const row = data.records.find(r => r.page_id === source.page_id);
    if (!row || row.goal_id !== source.goal_id) throw new Error('公司sourcepage/Goal显式映射不匹配');
    if (row.area_ids?.length) throw new Error('公司Area出现新关系，需明确来源映射');
  }
  for (const source of COMPANY_GOALS) {
    const goal = data.goals.find(g => g.page_id === source.page_id);
    if (!goal || goal.area_ids?.length) throw new Error('Goal来源缺失或Area需明确映射');
  }
}

/** 仅已核对的8页与3Goal；advisory锁防重复导入，不认领同名系统实体。 */
export async function importCompanyKrs(pool, data, { actor, task_id } = {}) {
  validate(data);
  if (!actor || !task_id) throw new Error('导入必须关联actor与已登记任务');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await lockCompanyReceipt(client, task_id);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['company-kr-import']);
    const objectives = {}, ids = [];
    let created = 0;
    for (const source of COMPANY_GOALS) {
      const goal = data.goals.find(g => g.page_id === source.page_id);
      const existing = await client.query("SELECT id,metadata,custom_props FROM objectives WHERE custom_props->'company_notion'->>'page_id'=$1 FOR UPDATE", [source.page_id]);
      if (existing.rows.length > 1) throw new Error('Goal来源存在重复映射');
      if (existing.rows[0] && (existing.rows[0].metadata?.source_system !== 'notion-company-okr' || existing.rows[0].custom_props?.company_notion?.database_id !== COMPANY_GOAL_DATABASE)) throw new Error('Goal来源已有其它归属');
      let id = existing.rows[0]?.id;
      if (!id) {
        const inserted = await client.query(
          `INSERT INTO objectives(title,status,metadata,custom_props) VALUES($1,'active',$2::jsonb,$3::jsonb) RETURNING id`,
          [goal.title, JSON.stringify({ company_status: goal.status, source_system: 'notion-company-okr' }), JSON.stringify({ company_notion: { database_id: COMPANY_GOAL_DATABASE, page_id: source.page_id, area_ids: [] } })]);
        id = inserted.rows[0].id;
      }
      objectives[source.page_id] = id;
    }
    for (const source of COMPANY_KR_CATALOG) {
      const row = data.records.find(r => r.page_id === source.page_id);
      const existing = await client.query("SELECT id, objective_id, metadata, custom_props FROM key_results WHERE custom_props->'company_notion'->>'page_id'=$1 FOR UPDATE", [source.page_id]);
      if (existing.rows.length > 1) throw new Error('KR来源存在重复映射');
      if (existing.rows[0]) {
        if (existing.rows[0].metadata?.metric_mode !== COMPANY_METRIC_MODE || existing.rows[0].objective_id !== objectives[source.goal_id] || existing.rows[0].custom_props?.company_notion?.database_id !== COMPANY_KR_DATABASE || existing.rows[0].custom_props?.company_notion?.goal_id !== source.goal_id) throw new Error('KR来源已有其它归属');
        ids.push(existing.rows[0].id); continue;
      }
      const metric = companyMetric(row.start, row.current, row.target);
      const display = compatibleProgress(metric);
      const metadata = { metric_mode: COMPANY_METRIC_MODE, company_metric: metric, company_current_baseline: metric.current, company_formula: COMPANY_FORMULA, progress_source: COMPANY_METRIC_MODE, company_status: row.status, unit_source: { field: 'original_title', title: source.title }, validation_state: 'unverified', imported_snapshot: { actor, task_id, source_updated_at: row.updated_at, evidence: '原Notion页历史快照，不代表机算或Manager证据确认' } };
      if (source.page_id === '3dbc40c2-ba63-8158-808a-e81bd769eb6b') metadata.metric_window = { observed: 'snapshot', limitation: '既有F1/F3/F4/N1快照算法；未验证连续7天' };
      const inserted = await client.query(
        `INSERT INTO key_results(objective_id,title,status,current_value,target_value,unit,metadata,custom_props,progress,progress_pct)
         VALUES($1,$2,'active',$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING id`,
        [objectives[source.goal_id], row.title, compatibleValue(metric.current), compatibleValue(metric.target), source.unit, JSON.stringify(metadata), JSON.stringify({ company_notion: { database_id: COMPANY_KR_DATABASE, page_id: source.page_id, goal_id: source.goal_id, area_ids: [] } }), display.progress, display.progress_pct]);
      ids.push(inserted.rows[0].id); created++;
    }
    const registry = await client.query("SELECT vessel,face FROM notion_projection_map WHERE notion_db_id=$1 AND brain_table='key_results' FOR UPDATE", [COMPANY_KR_DATABASE]);
    if (registry.rows.some(r => r.vessel !== 'notion-company-key-results' || r.face !== 'inlet')) throw new Error('公司投影库已有其它归属');
    await client.query(`INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status,notes)
      VALUES($1,'Key Results','inlet','key_results','both','notion-company-key-results','active','Brain为经营KR真身；Target/Start列级入站，只有Current出站，原formula与关系不写')
      ON CONFLICT(notion_db_id,COALESCE(brain_table,'')) DO UPDATE SET direction='both',status='active',notes=EXCLUDED.notes,updated_at=NOW()`, [COMPANY_KR_DATABASE]);
    await appendCompanyReceipt(client, task, { actor, fact: '公司8KR与3Objective按显式sourcepage幂等纳入Brain并登记列级通道', evidence: data.records.map(r => ({ source_page_id: r.page_id, source_goal_id: r.goal_id })), created, ids, observed_at: new Date().toISOString() });
    await client.query('COMMIT');
    return { success: true, created, company_kr_count: ids.length, ids, objectives };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
