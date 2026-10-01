/** 原公司库是列级入口：Target/Start 入站，只有 Current 出站；原公式与关系不写。 */
import { notionReq as defaultNotionReq } from '../recurring-notion-sync.js';
import { COMPANY_GOALS, COMPANY_KR_DATABASE, COMPANY_KR_CATALOG, COMPANY_FORMULA, COMPANY_METRIC_MODE, companyMetric, compatibleValue, compatibleProgress, rawDecimal } from '../lib/company-kr-metrics.js';
import { appendCompanyReceipt, lockCompanyReceipt } from '../lib/company-kr-observations.js';

export const COMPANY_KR_VESSEL = 'notion-company-key-results';
const lastRun = new WeakMap(), inFlight = new WeakSet();
const text = p => (p?.title || []).map(v => v.plain_text ?? v.text?.content ?? '').join('');
const areas = p => (p?.Area?.relation || []).map(v => v.id);
const configuredToken = () => process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_INBOX_TOKEN;
const sameDecimal = (a, b) => a === null || b === null ? a === b : Number(a) === Number(b);

export async function readCompanySnapshot({ token = configuredToken(), notionReq = defaultNotionReq } = {}) {
  if (!token) throw new Error('Notion token未配置');
  const schema = await notionReq(token, `/databases/${COMPANY_KR_DATABASE}`, 'GET');
  const fields = { Name: 'title', Current: 'number', Target: 'number', Start: 'number', Progress: 'formula', Goal: 'relation', Area: 'relation', Status: 'status' };
  for (const [name, type] of Object.entries(fields)) if (schema.properties?.[name]?.type !== type) throw new Error(`公司库列类型不符:${name}`);
  if (schema.properties.Progress.formula?.expression?.replace(/\s/g, '') !== COMPANY_FORMULA.replace(/\s/g, '')) throw new Error('公司原公式发生变化，拒绝改写或另算口径');
  const pages = []; let cursor;
  do {
    const result = await notionReq(token, `/databases/${COMPANY_KR_DATABASE}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    pages.push(...result.results);
    if (result.has_more && !result.next_cursor) throw new Error('公司库分页不完整');
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  const records = pages.map(page => {
    if (page.archived || page.in_trash || page.parent?.database_id !== COMPANY_KR_DATABASE) throw new Error('公司页归属不符或已归档');
    const p = page.properties;
    if (p.Goal?.relation?.length !== 1 || p.Goal?.has_more || p.Area?.has_more) throw new Error('公司Goal/Area来源不完整');
    return { page_id: page.id, title: text(p.Name), goal_id: p.Goal.relation[0].id, area_ids: areas(p), start: p.Start.number, current: p.Current.number, target: p.Target.number, status: p.Status.status?.name ?? null, updated_at: page.last_edited_time, editor: page.last_edited_by?.id ?? null };
  });
  if (records.length !== 8 || new Set(records.map(r => r.page_id)).size !== 8 || records.some(r => !COMPANY_KR_CATALOG.some(c => c.page_id === r.page_id && c.goal_id === r.goal_id))) throw new Error('公司库须为显式8页映射，拒绝按标题编号认领');
  const goals = [];
  for (const source of COMPANY_GOALS) {
    const page = await notionReq(token, `/pages/${source.page_id}`, 'GET');
    if (page.archived || page.in_trash || page.properties?.Area?.has_more) throw new Error('Goal来源不可用');
    goals.push({ page_id: source.page_id, title: text(page.properties.Name), area_ids: areas(page.properties), status: page.properties.Status?.status?.name ?? null });
  }
  return { records, goals };
}

/** 按列值而非页面编辑者比较；机器Current编辑不能掩盖人的Target修改。 */
export async function ingestCompanyTarget(pool, krId, remote) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM key_results WHERE id=$1', [krId]);
    let kr = rows[0];
    if (kr?.metadata?.metric_mode !== COMPANY_METRIC_MODE || kr.custom_props?.company_notion?.page_id !== remote.page_id) throw new Error('公司Target来源不匹配');
    const start = rawDecimal(remote.start), target = rawDecimal(remote.target);
    let before = kr.metadata.company_metric;
    if (start === before.start && target === before.target) { await client.query('COMMIT'); return kr; }
    const task = await lockCompanyReceipt(client, kr.metadata.imported_snapshot.task_id);
    kr = (await client.query('SELECT * FROM key_results WHERE id=$1 FOR UPDATE', [krId])).rows[0];
    before = kr.metadata.company_metric;
    if (start === before.start && target === before.target) { await client.query('COMMIT'); return kr; }
    const metric = companyMetric(start, before.current, target);
    const display = compatibleProgress(metric);
    const event = { actor: 'notion-inlet', fact: '主理人公司KR Target/Start列值回读（人赢）', source_page_id: remote.page_id, editor: remote.editor, observed_at: remote.updated_at, before, after: metric, evidence: [{ source: `notion:${remote.page_id}`, fact: '逐列值差异，不按last_editor过滤' }] };
    const saved = await client.query(
      `UPDATE key_results SET target_value=$2, metadata=$3::jsonb, progress=$4,progress_pct=$5,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
      [kr.id, compatibleValue(metric.target), JSON.stringify({ ...kr.metadata, company_metric: metric, last_target_inlet: event }), display.progress, display.progress_pct]);
    await client.query(
      `INSERT INTO notion_ingest_receipts(notion_page_id,notion_db_id,brain_table,brain_id,last_edited_time,history)
       VALUES($1,$2,'key_results',$3,$4,$5::jsonb)
       ON CONFLICT(notion_page_id) DO UPDATE SET last_edited_time=EXCLUDED.last_edited_time,ingested_at=NOW(),history=COALESCE(notion_ingest_receipts.history,'[]'::jsonb)||EXCLUDED.history`,
      [`${remote.page_id}#company-target`, COMPANY_KR_DATABASE, kr.id, remote.updated_at, JSON.stringify([event])]);
    await appendCompanyReceipt(client, task, event);
    await client.query('COMMIT'); return saved.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Current相对上次现场值变化视为人类主张；独立观察证据不由此伪造。 */
export async function ingestCompanyCurrent(pool, krId, remote) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let kr = (await client.query('SELECT * FROM key_results WHERE id=$1', [krId])).rows[0];
    if (kr?.metadata?.metric_mode !== COMPANY_METRIC_MODE || kr.custom_props?.company_notion?.page_id !== remote.page_id) throw new Error('公司Current来源不匹配');
    const current = rawDecimal(remote.current);
    if ('company_current_baseline' in kr.metadata && sameDecimal(current, kr.metadata.company_current_baseline)) { await client.query('COMMIT'); return { kr, claimed: false }; }
    const task = await lockCompanyReceipt(client, kr.metadata.imported_snapshot.task_id);
    kr = (await client.query('SELECT * FROM key_results WHERE id=$1 FOR UPDATE', [krId])).rows[0];
    const before = kr.metadata.company_metric;
    const hasBaseline = 'company_current_baseline' in kr.metadata;
    if (hasBaseline && sameDecimal(current, kr.metadata.company_current_baseline)) { await client.query('COMMIT'); return { kr, claimed: false }; }
    if (!hasBaseline && !sameDecimal(current, before.current)) {
      await appendCompanyReceipt(client, task, { kind: 'current_conflict', actor: 'notion-inlet', fact: 'Current缺少现场基线，保留双方值并停止该页投影', source_page_id: remote.page_id, editor: remote.editor, before, remote_current: current, observed_at: remote.updated_at });
      await client.query('COMMIT');
      return { kr, halted: true, claimed: false };
    }
    const metric = companyMetric(before.start, current, before.target), display = compatibleProgress(metric);
    const claimed = hasBaseline && !sameDecimal(current, kr.metadata.company_current_baseline);
    const event = { kind: 'human_current_claim', actor: 'notion-inlet', fact: '公司Current人类主张入账，尚未验证经营证据（人赢）', source_page_id: remote.page_id, editor: remote.editor, before, after: metric, observed_at: remote.updated_at, evidence: [{ source: `notion:${remote.page_id}`, fact: 'Current列相对已导入/投影基线发生变化' }] };
    const metadata = { ...kr.metadata, company_current_baseline: current, ...(claimed ? { company_metric: metric, validation_state: 'unverified', last_current_inlet: event } : {}) };
    kr = (await client.query('UPDATE key_results SET current_value=$2,progress=$3,progress_pct=$4,metadata=$5::jsonb,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [kr.id, compatibleValue(metric.current), display.progress, display.progress_pct, JSON.stringify(metadata)])).rows[0];
    if (claimed) await appendCompanyReceipt(client, task, event);
    await client.query('COMMIT'); return { kr, claimed };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function runCompanyKrProjection(pool, { token = configuredToken(), notionReq = defaultNotionReq, now = Date.now() } = {}) {
  if (!token) return { skipped: true, reason: 'not_configured' };
  const registered = await pool.query("SELECT notion_db_id FROM notion_projection_map WHERE brain_table='key_results' AND face='inlet' AND direction='both' AND status='active' AND vessel=$1", [COMPANY_KR_VESSEL]);
  if (!registered.rows.length) return { skipped: true, reason: 'not_registered' };
  if (registered.rows.length !== 1 || registered.rows[0].notion_db_id !== COMPANY_KR_DATABASE) throw new Error('公司投影登记归属错误');
  if (inFlight.has(pool) || (lastRun.has(pool) && now - lastRun.get(pool) < 300000)) return { skipped: true, reason: 'interval' };
  inFlight.add(pool); lastRun.set(pool, now);
  try {
    const snapshot = await readCompanySnapshot({ token, notionReq });
    const { rows } = await pool.query("SELECT * FROM key_results WHERE metadata->>'metric_mode'=$1", [COMPANY_METRIC_MODE]);
    if (rows.length !== 8 || new Set(rows.map(r => r.custom_props?.company_notion?.page_id)).size !== 8) throw new Error('公司KR真身应为8条且映射唯一');
    const result = { expected: 8, remote: snapshot.records.length, patched: 0, matched: 0, claims: 0 };
    for (const kr of rows) {
      const remote = snapshot.records.find(r => r.page_id === kr.custom_props.company_notion.page_id);
      if (!remote) throw new Error('公司页丢失，拒绝错配');
      await ingestCompanyTarget(pool, kr.id, remote);
      const inlet = await ingestCompanyCurrent(pool, kr.id, remote);
      if (inlet.halted) throw new Error('公司Current无基线冲突，已留账，禁止覆盖');
      const current = inlet.kr.metadata.company_metric.current;
      if (inlet.claimed) result.claims++;
      if (!sameDecimal(current, rawDecimal(remote.current))) {
        // 写前再读取现场值，缩小Notion无CAS接口的并发窗口。
        const page = await notionReq(token, `/pages/${remote.page_id}`, 'GET');
        if (page.archived || page.in_trash || page.parent?.database_id !== COMPANY_KR_DATABASE) throw new Error('公司Current写前归属检查失败');
        const latest = { ...remote, current: page.properties.Current.number, start: page.properties.Start.number, target: page.properties.Target.number, updated_at: page.last_edited_time, editor: page.last_edited_by?.id ?? null };
        if (!sameDecimal(rawDecimal(latest.current), rawDecimal(remote.current)) || !sameDecimal(rawDecimal(latest.start), rawDecimal(remote.start)) || !sameDecimal(rawDecimal(latest.target), rawDecimal(remote.target))) {
          await ingestCompanyTarget(pool, kr.id, latest);
          const newer = await ingestCompanyCurrent(pool, kr.id, latest);
          if (newer.halted) throw new Error('公司Current写前无基线冲突，已留账，禁止覆盖');
          if (newer.claimed) result.claims++;
          result.matched++; continue;
        }
        await notionReq(token, `/pages/${remote.page_id}`, 'PATCH', { properties: { Current: { number: Number(current) } } });
        await pool.query("UPDATE key_results SET metadata=jsonb_set(metadata,'{company_current_baseline}',$2::jsonb,true) WHERE id=$1 AND metadata->>'metric_mode'=$3", [kr.id, JSON.stringify(current), COMPANY_METRIC_MODE]);
        result.patched++;
      }
      result.matched++;
    }
    return result;
  } finally { inFlight.delete(pool); }
}
