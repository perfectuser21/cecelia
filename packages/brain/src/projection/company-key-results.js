/** 原公司KR表：正式数字/来源入站，独立AI观察与建议出站。 */
import { notionReq as defaultNotionReq } from '../recurring-notion-sync.js';
import { COMPANY_KR_DATABASE, COMPANY_METRIC_MODE } from '../lib/company-kr-metrics.js';
import { importCompanyKrs } from '../lib/company-kr-import.js';
import { ingestCompanyFormal, markCompanySyncError } from './company-kr-inlet.js';
import { configuredCompanyToken, readCompanySnapshot, ensureCompanyAiSchema, companyAiProperties, projectCompanyAi, companySyncErrorProperties, companyPageBelongs } from './company-kr-notion.js';

export { readCompanySnapshot } from './company-kr-notion.js';
export { ingestCompanyCurrent, ingestCompanyTarget } from './company-kr-inlet.js';
export const COMPANY_KR_VESSEL = 'notion-company-key-results';
const lastRun = new WeakMap(), inFlight = new WeakSet();

async function releaseProjectionLock(client, locked, cycleError) {
  let destroy = false;
  try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['notion-company-key-results-projection']); }
  catch (error) {
    destroy = true;
    if (!cycleError) throw error;
    console.warn('[company-kr-projection] 解锁失败，关闭连接并保留原周期错误:', error.message);
  } finally { client.release(destroy); }
}

export async function runCompanyKrProjection(pool, { token = configuredCompanyToken(), notionReq = defaultNotionReq, now = Date.now() } = {}) {
  if (!token) return { skipped: true, reason: 'not_configured', changed_ids: [] };
  const registered = await pool.query("SELECT notion_db_id FROM notion_projection_map WHERE brain_table='key_results' AND face='inlet' AND direction='both' AND status='active' AND vessel=$1", [COMPANY_KR_VESSEL]);
  if (!registered.rows.length) return { skipped: true, reason: 'not_registered', changed_ids: [] };
  if (registered.rows.length !== 1 || registered.rows[0].notion_db_id !== COMPANY_KR_DATABASE) throw new Error('公司投影登记归属错误');
  if (inFlight.has(pool) || (lastRun.has(pool) && now - lastRun.get(pool) < 300000)) return { skipped: true, reason: 'interval', changed_ids: [] };
  inFlight.add(pool);
  let lockClient, cycleError, locked = false;
  try {
    lockClient = await pool.connect();
    locked = (await lockClient.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', ['notion-company-key-results-projection'])).rows[0]?.acquired === true;
    if (!locked) return { skipped: true, reason: 'projection_locked', changed_ids: [] };
    const snapshot = await readCompanySnapshot({ token, notionReq });
    if (!snapshot.complete) throw new Error('公司来源快照未完成');
    let rows = (await pool.query("SELECT * FROM key_results WHERE metadata->>'metric_mode'=$1", [COMPANY_METRIC_MODE])).rows;
    if (new Set(rows.map(r => r.custom_props?.company_notion?.page_id)).size !== rows.length) throw new Error('公司KR来源映射重复');
    const taskId = rows.find(r => r.metadata?.imported_snapshot?.task_id)?.metadata.imported_snapshot.task_id;
    const imported = snapshot.records.length ? await importCompanyKrs(pool, snapshot, { actor: 'notion-inlet', task_id: taskId }) : { changed_ids: [], objectives: {} };
    if (imported.created) rows = (await pool.query("SELECT * FROM key_results WHERE metadata->>'metric_mode'=$1", [COMPANY_METRIC_MODE])).rows;
    await ensureCompanyAiSchema(token, notionReq, snapshot.schema);
    const result = { expected: rows.length, remote: snapshot.records.length, patched: 0, matched: 0, claims: 0, changed_ids: [...imported.changed_ids], errors: snapshot.errors.map(({ page_id, error }) => ({ page_id, error })) };
    for (const error of snapshot.errors) {
      const existing = rows.find(r => r.custom_props.company_notion.page_id === error.page_id);
      if (existing && (await markCompanySyncError(pool, existing.id, error.error)).changed) result.changed_ids.push(existing.id);
      await projectCompanyAi(token, notionReq, error.page_id, error.properties, companySyncErrorProperties(error.error));
    }
    for (const kr of rows) {
      const sourceId = kr.custom_props.company_notion.page_id;
      const remote = snapshot.records.find(r => r.page_id === sourceId);
      if (!remote) {
        if (snapshot.errors.some(e => e.page_id === sourceId)) continue;
        let page, sourceError = '来源不在本次完整快照，尚无归档证据';
        try { page = await notionReq(token, `/pages/${sourceId}`, 'GET'); }
        catch (error) { sourceError = `来源缺失，未归档：${error.message}`; }
        if (page && companyPageBelongs(page) && (page.archived || page.in_trash)) {
          const inlet = await ingestCompanyFormal(pool, kr.id, { page_id: sourceId, updated_at: page.last_edited_time }, { archived: true });
          if (inlet.changed) result.changed_ids.push(kr.id);
        } else {
          if ((await markCompanySyncError(pool, kr.id, sourceError)).changed) result.changed_ids.push(kr.id);
          result.errors.push({ page_id: sourceId, error: sourceError });
        }
        continue;
      }
      const inlet = await ingestCompanyFormal(pool, kr.id, remote, { objectiveId: imported.objectives[remote.goal_id] });
      if (inlet.changed) result.changed_ids.push(kr.id);
      if (inlet.claimed) result.claims++;
      if (await projectCompanyAi(token, notionReq, sourceId, remote.properties, companyAiProperties(inlet.kr))) result.patched++;
      result.matched++;
    }
    result.changed_ids = [...new Set(result.changed_ids)];
    lastRun.set(pool, now);
    return result;
  } catch (error) { cycleError = error; throw error; }
  finally {
    inFlight.delete(pool);
    if (lockClient) await releaseProjectionLock(lockClient, locked, cycleError);
  }
}
