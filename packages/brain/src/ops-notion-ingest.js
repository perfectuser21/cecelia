// Notion 运行舱回读：把主理人在驾驶舱上改的**人工列**读回 Brain。
//
// 方向纪律（决策 2026-09-08）：
//   机器列 Brain→Notion 单向覆盖（真相在 n8n/OpenClaw，人改了会被下轮冲掉）
//   人工列 Notion→Brain 单向读回（真相是人，机器永不覆盖）
// 两个方向各管各的列，不存在同一列双写，所以不会打架。
//
// n8n 启停已退役；这里只回读非执行类人工列，不接受旧Enabled控制意图。

import { notionReq, getToken } from './recurring-notion-sync.js';
import { buildOpsManualReadback } from './notion-push-sync.js';

/** 允许被 Notion 回写的列——白名单，防"Notion 上加个列就能往任意列写" */
const MANUAL_COLUMNS = new Set([
  'owner_manual', 'note_manual', 'org_manual', 'role_manual',
  'priority_manual', 'starred', 'stage_manual',
]);

/** 只有 ops_* 投影表可被回写 */
const ALLOWED_TABLES = new Set(['ops_workflows', 'ops_agents', 'ops_skills']);

/**
 * 构造只更新人工列的 UPDATE。未知字段静默丢弃，表名走白名单。
 * @returns {{sql:string, values:Array}|null} 无可更新字段时返回 null
 */
export function buildManualUpdateSql(table, id, patch = {}) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`buildManualUpdateSql: 表 ${table} 不在回写白名单内`);
  }
  const cols = Object.keys(patch).filter((k) => MANUAL_COLUMNS.has(k));
  if (cols.length === 0) return null;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const values = cols.map((c) => patch[c]);
  values.push(id);
  return {
    sql: `UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
    values,
  };
}

/**
 * 主流程：拉 Notion 最近编辑过的页 → 读人工列 → 写回 Brain。
 * @param {*} pool
 * @param {{notionReqFn?:Function, tokenFn?:Function}} opts 便于测试注入
 */
export async function runOpsNotionIngest(pool, opts = {}) {
  const notionCall = opts.notionReqFn || notionReq;
  const tokenFn = opts.tokenFn || getToken;
  let token;
  try {
    token = tokenFn();
  } catch {
    return { ok: false, reason: 'no_token' };
  }

  const dbsRow = await pool.query(`SELECT value_json FROM working_memory WHERE key = 'ops_notion_dbs'`);
  const dbs = dbsRow.rows[0]?.value_json;
  if (!dbs || dbs.disabled) return { ok: false, reason: 'not_configured' };

  const targets = [
    { key: 'workflows', dbId: dbs.workflows_db, table: 'ops_workflows' },
    { key: 'agents', dbId: dbs.graph_db, table: 'ops_agents' },
    { key: 'skills', dbId: dbs.skills_db, table: 'ops_skills' },
  ].filter((t) => t.dbId);

  const stats = { read: 0, updated: 0, failed: 0 };

  for (const t of targets) {
    const cur = await pool.query(
      `SELECT last_seen FROM ops_notion_ingest_cursor WHERE db_key = $1`, [t.key]);
    const since = cur.rows[0]?.last_seen;
    const filter = since
      ? { timestamp: 'last_edited_time', last_edited_time: { after: new Date(since).toISOString() } }
      : undefined;

    let pages;
    try {
      const res = await notionCall(token, `/databases/${t.dbId}/query`, 'POST', {
        ...(filter ? { filter } : {}),
        sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
        page_size: 50,
      });
      pages = res?.results || [];
    } catch (err) {
      console.warn(`[ops-notion-ingest] ${t.key} 查询失败: ${err.message}`);
      stats.failed += 1;
      continue;
    }

    let newest = since;
    for (const page of pages) {
      stats.read += 1;
      let patch = Object.fromEntries(Object.entries(buildOpsManualReadback(page)).filter(([column]) => MANUAL_COLUMNS.has(column)));
      if (page.last_edited_time) newest = page.last_edited_time;
      if (Object.keys(patch).length === 0) continue;

      const row = await pool.query(`SELECT * FROM ${t.table} WHERE notion_id = $1`, [page.id]);
      const target = row.rows[0];
      if (!target) continue;
      patch = Object.fromEntries(Object.entries(patch).filter(([key,value]) => value !== (target[key] ?? null)));

      const upd = buildManualUpdateSql(t.table, target.id, patch);
      if (upd) {
        await pool.query(upd.sql, upd.values);
        stats.updated += 1;
      }

    }

    if (newest && newest !== since) {
      await pool.query(
        `INSERT INTO ops_notion_ingest_cursor (db_key, last_seen, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (db_key) DO UPDATE SET last_seen = EXCLUDED.last_seen, updated_at = NOW()`,
        [t.key, newest]);
    }
  }

  return { ok: true, ...stats };
}
