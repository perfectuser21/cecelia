// Notion 运行舱回读：把主理人在驾驶舱上改的**人工列**读回 Brain。
//
// 方向纪律（决策 2026-09-08）：
//   机器列 Brain→Notion 单向覆盖（真相在 n8n/OpenClaw，人改了会被下轮冲掉）
//   人工列 Notion→Brain 单向读回（真相是人，机器永不覆盖）
// 两个方向各管各的列，不存在同一列双写，所以不会打架。
//
// 停用意图是唯一会反向触达生产的动作——主理人拍板「直接生效，真去停 n8n」。
// 因为不可逆，实现上强制三条：幂等、留痕、失败可见。

import { notionReq, getToken } from './recurring-notion-sync.js';
import { buildOpsManualReadback } from './notion-push-sync.js';

/** 允许被 Notion 回写的列——白名单，防"Notion 上加个列就能往任意列写" */
const MANUAL_COLUMNS = new Set([
  'owner_manual', 'note_manual', 'org_manual', 'role_manual',
  'priority_manual', 'starred', 'stage_manual', 'enable_intent',
]);

/** 只有 ops_* 投影表可被回写 */
const ALLOWED_TABLES = new Set(['ops_workflows', 'ops_agents', 'ops_skills']);

/**
 * 决定要不要真去动 n8n。返回 action=none 时调用方什么都不做。
 * @returns {{action:'none'|'activate'|'deactivate', wf_id?:string, prev_active?:boolean, reason?:string}}
 */
export function planEnableAction(w = {}) {
  // 只有 n8n 流程有启停 API；launchd/gha 行没有，碰不了
  if (w.source && w.source !== 'n8n') return { action: 'none', reason: 'not_n8n' };
  // 从没表达过意图 → 默认不碰生产
  if (typeof w.enable_intent !== 'boolean') return { action: 'none', reason: 'no_intent' };
  // 幂等：意图与 n8n 现状一致就不用动，否则每轮都会重复调
  if (w.enable_intent === w.active) return { action: 'none', reason: 'already_in_sync' };
  // 上次尝试失败过、而人没再改过意图 → 不无限重试，留给人处理（错误已在看板显红）
  if (w.enable_error) {
    const intentAt = w.enable_intent_at ? new Date(w.enable_intent_at).getTime() : 0;
    const appliedAt = w.enable_applied_at ? new Date(w.enable_applied_at).getTime() : 0;
    if (!(intentAt > appliedAt)) return { action: 'none', reason: 'last_attempt_failed' };
  }
  return {
    action: w.enable_intent ? 'activate' : 'deactivate',
    wf_id: w.wf_id,
    prev_active: w.active === true,   // 留痕：改前 n8n 是什么状态
  };
}

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

/** n8n 启停 REST 调用（经 hk-vps）。失败必须抛，由调用方落 enable_error。 */
async function callN8nToggle(execFn, wfId, activate) {
  const verb = activate ? 'activate' : 'deactivate';
  const cmd = 'ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no root@100.86.118.99 '
    + `'docker exec n8n n8n update:workflow --id=${wfId} --active=${activate ? 'true' : 'false'}'`;
  const out = execFn(cmd, { timeoutMs: 60_000 });
  return { verb, out: String(out || '').slice(0, 300) };
}

/**
 * 主流程：拉 Notion 最近编辑过的页 → 读人工列 → 写回 Brain → 需要时落实停用意图。
 * @param {*} pool
 * @param {{execFn?:Function, notionReqFn?:Function, tokenFn?:Function}} opts 便于测试注入
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

  const stats = { read: 0, updated: 0, toggled: 0, failed: 0 };

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
      const patch = buildOpsManualReadback(page);
      if (page.last_edited_time) newest = page.last_edited_time;
      if (Object.keys(patch).length === 0) continue;

      const row = await pool.query(`SELECT * FROM ${t.table} WHERE notion_id = $1`, [page.id]);
      const target = row.rows[0];
      if (!target) continue;

      // 意图变化时打时间戳，供 planEnableAction 判断"人是否改了新意图"
      if ('enable_intent' in patch && patch.enable_intent !== target.enable_intent) {
        patch.enable_intent_at = new Date();
      }
      const upd = buildManualUpdateSql(t.table, target.id, patch);
      if (upd) {
        await pool.query(upd.sql, upd.values);
        stats.updated += 1;
      }
      if (patch.enable_intent_at) {
        await pool.query(`UPDATE ${t.table} SET enable_intent_at = NOW() WHERE id = $1`, [target.id]);
      }

      // 停用意图落实（仅 workflows）
      if (t.table === 'ops_workflows') {
        const fresh = (await pool.query(`SELECT * FROM ops_workflows WHERE id = $1`, [target.id])).rows[0];
        const plan = planEnableAction(fresh);
        if (plan.action !== 'none') {
          const execFn = opts.execFn;
          try {
            if (!execFn) throw new Error('no exec available');
            await callN8nToggle(execFn, plan.wf_id, plan.action === 'activate');
            await pool.query(
              `UPDATE ops_workflows SET enable_applied_at = NOW(), enable_error = NULL WHERE id = $1`,
              [target.id]);
            stats.toggled += 1;
          } catch (err) {
            // 失败必须留痕且可见——看板据 enable_error 显红，绝不静默
            await pool.query(
              `UPDATE ops_workflows SET enable_applied_at = NOW(), enable_error = $2 WHERE id = $1`,
              [target.id, String(err.message).slice(0, 500)]);
            stats.failed += 1;
          }
        }
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
