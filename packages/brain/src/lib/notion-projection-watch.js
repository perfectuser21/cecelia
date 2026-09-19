/**
 * notion-projection-watch.js — 守夜遍历注册表（三面模型 PR③，决策 297ffee5）
 *
 * 对账不再一根一根手写：遍历 notion_projection_map，每根血管自带断言，漂了进 nightly 失败 → Bark/晨报。
 *  A7 registry_coverage   有 notion_id 列却未登记的表（新表接了列不登记 = 纸门）
 *  A8 mirror_tampered     🔒 镜子库 24h 内被非机器人改过：留痕 notion_sync_log(direction=mirror_tamper)，
 *                         并把该行 notion_digest 置 NULL → 下轮 push 用真身覆盖回去（铁律四：机器被覆盖值留痕）
 *  A9 constants_match     代码里的库常量 / working_memory.ops_notion_dbs 必须 == 注册表；全绿后 resolveDbId 才能翻转为注册表优先
 *  A10 projection_counts  🔒 push 库：Brain 有 notion_id 的行数 == Notion 页数（人往镜子里加行会被抓）；Notion 不可达 → degraded 不红
 */
import { loadProjectionMap, findUnregisteredNotionTables, normalizeNotionId } from './notion-projection-registry.js';

const SINCE_HOURS = 24;
const PAGE_CAP = 20; // 单库最多翻 20 页（2000 行），超出按 ≥ 记

async function countNotionPages(notionReq, token, dbId, extraBody = {}) {
  let n = 0, cursor, pages = 0, capped = false;
  do {
    const r = await notionReq(token, `/databases/${dbId}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...extraBody });
    n += (r?.results ?? []).length;
    cursor = r?.has_more ? r?.next_cursor : null;
    if (++pages >= PAGE_CAP && cursor) { capped = true; break; }
  } while (cursor);
  return { n, capped };
}

const titleOf = (page) => {
  for (const v of Object.values(page?.properties ?? {})) if (v?.type === 'title') return (v.title ?? []).map(t => t.plain_text ?? '').join('').slice(0, 40);
  return page?.id ?? '?';
};

/**
 * @param {object} pool
 * @param {{notionReq:Function, token:string, botUserId:string, constants:Record<string,string>}} deps
 *   constants: brain_table → 代码里硬编码的库 id（notion-push-sync 导出的 LEGACY_DB_CONSTANTS）
 */
export async function buildProjectionAssertions(pool, { notionReq, token, botUserId, constants = {}, dryRun = false }) {
  const results = [];
  const map = await loadProjectionMap(pool);
  const active = map.rows.filter(r => r.status === 'active');

  // ── A7 注册表覆盖 ─────────────────────────────────────────
  const missing = await findUnregisteredNotionTables(pool);
  results.push({
    key: 'registry_coverage', label: '投影注册表覆盖',
    ok: missing.length === 0,
    detail: missing.length === 0 ? `带 notion_id 列的表全部已登记（${map.rows.length} 条登记）` : `${missing.length} 张表带 notion_id 列却未登记：${missing.join(', ')}`,
  });

  // ── A8 镜子被人改 ─────────────────────────────────────────
  const mirrors = active.filter(r => r.face === 'mirror' && ['push', 'both'].includes(r.direction) && r.brain_table);
  const since = new Date(Date.now() - SINCE_HOURS * 3600e3).toISOString();
  const tampered = []; let a8Degraded = 0;
  for (const r of mirrors) {
    try {
      const q = await notionReq(token, `/databases/${r.notion_db_id}/query`, 'POST', {
        page_size: 50, filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } },
      });
      for (const page of q?.results ?? []) {
        const by = page?.last_edited_by?.id;
        if (!by || by === botUserId) continue;
        tampered.push({ lib: r.title, table: r.brain_table, page: page.id, title: titleOf(page), by });
        if (dryRun) continue; // 只诊断不留痕不置指纹（proven-to-fire 对生产只读跑）
        await pool.query(
          `INSERT INTO notion_sync_log (direction, records_synced, records_failed, error_message, details)
           VALUES ('mirror_tamper', 0, 1, $1, $2::jsonb)`,
          [`🔒 ${r.title} 被非机器人编辑：${titleOf(page)}`, JSON.stringify({ db: r.notion_db_id, table: r.brain_table, page: page.id, by })],
        ).catch(() => {});
        await pool.query(`UPDATE ${r.brain_table} SET notion_digest = NULL WHERE notion_id = $1`, [page.id]).catch(() => {});
      }
    } catch { a8Degraded++; }
  }
  results.push({
    key: 'mirror_tampered', label: '镜子库被人改',
    ok: tampered.length === 0, degraded: a8Degraded > 0,
    detail: tampered.length === 0
      ? `${mirrors.length} 个镜子库 ${SINCE_HOURS}h 内无非机器人编辑${a8Degraded ? `（${a8Degraded} 库查询失败按 degraded）` : ''}`
      : `${tampered.length} 处人改了镜子（已留痕并置指纹下轮覆盖回）：` + tampered.slice(0, 5).map(t => `${t.lib}·${t.title}`).join('；'),
  });

  // ── A9 常量 == 注册表 ─────────────────────────────────────
  const mismatch = [];
  for (const [table, constId] of Object.entries(constants)) {
    const reg = map.byTable.get(table);
    if (!reg) { mismatch.push(`${table}: 注册表无此表`); continue; }
    if (normalizeNotionId(reg.notion_db_id) !== normalizeNotionId(constId)) mismatch.push(`${table}: 代码=${String(constId).slice(0, 8)} 注册表=${reg.notion_db_id.slice(0, 8)}`);
  }
  try {
    const { rows } = await pool.query(`SELECT value_json FROM working_memory WHERE key = 'ops_notion_dbs'`);
    const ops = rows[0]?.value_json || {};
    for (const [k, table] of Object.entries({ graph_db: 'ops_agents', skills_db: 'ops_skills', workflows_db: 'ops_workflows', runs_db: 'ops_runs' })) {
      const reg = map.byTable.get(table);
      if (ops[k] && reg && normalizeNotionId(ops[k]) !== normalizeNotionId(reg.notion_db_id)) mismatch.push(`${table}: working_memory=${String(ops[k]).slice(0, 8)} 注册表=${reg.notion_db_id.slice(0, 8)}`);
    }
  } catch { /* working_memory 不可读不算漂 */ }
  results.push({
    key: 'constants_match', label: '代码常量 == 注册表',
    ok: mismatch.length === 0,
    detail: mismatch.length === 0 ? `${Object.keys(constants).length} 个代码常量 + ops 四库均与注册表一致` : `${mismatch.length} 处不一致：${mismatch.join('；')}`,
  });

  // ── A10 逐库行数对账 ──────────────────────────────────────
  const pushMirrors = mirrors.filter(r => r.direction === 'push' && r.brain_table && /^notion-push-sync/.test(r.vessel || ''));
  const diffs = []; let a10Degraded = 0, checked = 0;
  for (const r of pushMirrors) {
    try {
      const { rows } = await pool.query(`SELECT count(*)::int AS count FROM ${r.brain_table} WHERE notion_id IS NOT NULL`);
      const brain = Number(rows[0]?.count ?? 0);
      const { n, capped } = await countNotionPages(notionReq, token, r.notion_db_id);
      checked++;
      if (!capped && n !== brain) diffs.push(`${r.title}：Brain ${brain} vs Notion ${n}`);
    } catch { a10Degraded++; }
  }
  results.push({
    key: 'projection_counts', label: '镜子库行数对账',
    ok: diffs.length === 0, degraded: a10Degraded > 0,
    detail: diffs.length === 0
      ? `${checked} 个镜子库行数一致${a10Degraded ? `（${a10Degraded} 库 Notion 不可达按 degraded 不计红）` : ''}`
      : `${diffs.length} 个库对不上：${diffs.join('；')}`,
  });

  return results;
}
