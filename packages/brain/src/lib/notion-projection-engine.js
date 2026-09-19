/**
 * notion-projection-engine.js — 统一推送引擎（三面模型 PR②a，决策 297ffee5）
 *
 * 一根主动脉替代九份复制粘贴：调用方只负责「选哪些行」与「行→Notion properties」，
 * 引擎负责 指纹比对 / PATCH 或 POST / 回写 id·指纹·synced / 404·错库自愈 / stale relation 止损。
 * 指纹按将要发送的 properties 计算（键序无关），存 <table>.notion_digest；
 * 指纹相同不打 Notion——这是防限流、也是"改了就同步、没改不重推"的判据。
 */
import { createHash } from 'node:crypto';

/** 稳定序列化（键排序）后 sha1 */
export function propsDigest(properties, children) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((o, k) => { o[k] = stable(v[k]); return o; }, {});
    }
    return v;
  };
  const payload = JSON.stringify({ p: stable(properties || {}), c: children ? stable(children) : null });
  return createHash('sha1').update(payload).digest('hex');
}

/** 注册表优先取库 id：brain_table 对应且 direction∈{push,both} 且 active；缺则回退常量 */
export async function resolveDbId(pool, table, fallbackDbId = null) {
  try {
    const { rows } = await pool.query(
      `SELECT notion_db_id FROM notion_projection_map
        WHERE brain_table = $1 AND direction IN ('push','both') AND status = 'active'
        ORDER BY title LIMIT 1`, [table]);
    if (rows[0]?.notion_db_id) return rows[0].notion_db_id;
  } catch { /* 注册表未落表（未 promote）时静默回退 */ }
  return fallbackDbId;
}

const default404 = (err) => /404/.test(err?.message || '');

/**
 * 推送一批行。
 * @param {object} pool
 * @param {string} token
 * @param {object} o
 * @param {string}   o.table          真身表名（用于回写）
 * @param {string}   o.dbId           目标 Notion 库 id
 * @param {object[]} o.rows           已选出的行（需含 id / notion_id / notion_digest）
 * @param {Function} o.buildProps     (row) => properties
 * @param {Function} [o.buildChildren] (row) => children blocks（仅创建时附带）
 * @param {Function} o.notionReq      (token, path, method, body) => json
 * @param {Function} [o.logSyncError] (pool, msg)
 * @param {Function} [o.isStaleRelationError] (err) => bool
 * @param {Function} [o.isWrongDatabaseError] (err) => bool
 * @param {Function} [o.onFatal]      (err) => bool  返回 true 表示整批终止（如 ops 库不可达）
 * @param {string}   [o.label]        日志前缀
 */
export async function pushRegisteredRows(pool, token, o) {
  const {
    table, dbId, rows, buildProps, buildChildren, notionReq,
    logSyncError = async () => {}, isStaleRelationError = () => false,
    isWrongDatabaseError = () => false, onFatal = () => false, label = table,
  } = o;
  const stat = { created: 0, patched: 0, skipped: 0, failed: 0, cleared: 0 };
  for (const r of rows) {
    let properties;
    try {
      properties = buildProps(r);
      const digest = propsDigest(properties);
      if (r.notion_id && r.notion_digest === digest) {
        // 指纹同：不打 Notion；但要把 synced 抬到现在，否则 updated_at > notion_synced_at 的行
        // 会在每轮 LIMIT 里永久占位，把别的行饿死
        await pool.query(`UPDATE ${table} SET notion_synced_at = NOW() WHERE id = $1`, [r.id]).catch(() => {});
        stat.skipped++; continue;
      }
      if (r.notion_id) {
        await notionReq(token, `/pages/${r.notion_id}`, 'PATCH', { properties });
        await pool.query(
          `UPDATE ${table} SET notion_digest = $2, notion_synced_at = NOW() WHERE id = $1`, [r.id, digest]);
        stat.patched++;
      } else {
        const children = buildChildren ? buildChildren(r) : undefined;
        const page = await notionReq(token, '/pages', 'POST',
          { parent: { database_id: dbId }, properties, ...(children?.length ? { children } : {}) });
        await pool.query(
          `UPDATE ${table} SET notion_id = $2, notion_digest = $3, notion_synced_at = NOW() WHERE id = $1`,
          [r.id, page.id, digest]);
        stat.created++;
      }
    } catch (err) {
      if (onFatal(err)) { stat.failed++; return stat; }
      if ((default404(err) && r.notion_id) || isWrongDatabaseError(err)) {
        await pool.query(`UPDATE ${table} SET notion_id = NULL, notion_digest = NULL WHERE id = $1`, [r.id]).catch(() => {});
        stat.cleared++;
        continue;
      }
      stat.failed++;
      console.warn(`[notion-push-sync] ${label} ${r.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
      if (isStaleRelationError(err)) {
        await pool.query(`UPDATE ${table} SET notion_synced_at = NOW() WHERE id = $1`, [r.id]).catch(() => {});
      }
    }
  }
  return stat;
}
