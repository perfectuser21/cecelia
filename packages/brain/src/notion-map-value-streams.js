/**
 * notion-map-value-streams.js — Brain 结构地图价值流 → Notion「价值流 Value Streams」只读镜子
 * （决策 e00d9cc3 / 9d5fce74：价值流以 map_projection_* 的 active run 为准，Notion 只是投影）。
 *
 * 一行 = 一条价值流：active run 的 value_stream 节点 + contains 边指向的 capability 名逐行列出。
 * 记账不在真身表上（map_projection_nodes 每次重投影整行换新 run_id），另立 notion_map_node_pages，
 * 主键 (scope, node_key)——跨 run 稳定的身份。
 *  - 指纹 = 将发送 properties（不含「同步时间」）的稳定哈希；不变不打 Notion
 *  - active run 里已不存在的节点 → 页面「状态」标「已归档」（PATCH，不删页面）；地图整体读空时不归档（防空投影抹镜子）
 *  - 库 id 只认 notion_projection_map（brain_table=记账表 notion_map_node_pages，push+active），未登记整段跳过；
 *    登记记账表而非真身表：守夜 A7 查带 notion_id 列的表、A8 按 brain_table.notion_id 置空指纹触发覆盖回
 * 失败只记日志，Postgres 才是真相源。
 */
import { notionReq as defaultNotionReq, getToken } from './recurring-notion-sync.js';
import { propsDigest, resolveDbId, isPageGoneError } from './lib/notion-projection-engine.js';
import { ensureOpsDbProps } from './ops-quota-notion.js';
import { VALUE_STREAM_DB_PROPS } from './ops-notion-schema.js';

const RT_MAX = 1900;
export const LEDGER_TABLE = 'notion_map_node_pages';
const ARCHIVED_PROPS = { '状态': { select: { name: '已归档' } } };

const rich = (text) => {
  const s = text === null || text === undefined ? '' : String(text);
  return { rich_text: s === '' ? [] : [{ type: 'text', text: { content: s.slice(0, RT_MAX) } }] };
};
const orderOf = (v) => (Number.isFinite(Number(v)) ? Number(v) : Number.MAX_SAFE_INTEGER);

/** active run 的价值流 + 其 contains→capability 子节点（每个 scope 至多一个 active run）。 */
export async function loadValueStreams(pool) {
  const { rows } = await pool.query(
    `SELECT r.scope_key, m.version AS manifest_version, r.manifest_digest,
            vs.node_key, vs.name, vs.attributes,
            COALESCE(jsonb_agg(jsonb_build_object('key', c.node_key, 'name', c.name, 'order', c.attributes->'order'))
                     FILTER (WHERE c.node_id IS NOT NULL), '[]'::jsonb) AS capabilities
       FROM map_projection_runs r
       JOIN map_manifest_versions m ON m.id = r.manifest_version_id
       JOIN map_projection_nodes vs ON vs.run_id = r.id AND vs.node_type = 'value_stream'
       LEFT JOIN map_projection_edges e
              ON e.run_id = r.id AND e.edge_type = 'contains' AND e.from_node_id = vs.node_id
       LEFT JOIN map_projection_nodes c
              ON c.run_id = r.id AND c.node_id = e.to_node_id AND c.node_type = 'capability'
      WHERE r.status = 'active'
      GROUP BY r.scope_key, m.version, r.manifest_digest, vs.node_key, vs.name, vs.attributes
      ORDER BY r.scope_key, vs.node_key`);
  return rows;
}

/** 一条价值流 → 库 properties（不含「同步时间」，指纹按此算）。 */
export function buildValueStreamProps(vs) {
  const attrs = vs.attributes && typeof vs.attributes === 'object' ? vs.attributes : {};
  const caps = [...(Array.isArray(vs.capabilities) ? vs.capabilities : [])]
    .sort((a, b) => orderOf(a.order) - orderOf(b.order) || String(a.key).localeCompare(String(b.key)));
  return {
    Name: { title: [{ type: 'text', text: { content: String(vs.name || vs.node_key).slice(0, 200) } }] },
    Key: rich(vs.node_key),
    Scope: { select: { name: String(vs.scope_key) } },
    Persona: rich(attrs.perceiver ?? attrs.persona ?? ''),
    '能力': rich(caps.map((c) => `${c.key} ${c.name}`).join('\n')),
    '能力数': { number: caps.length },
    '地图版本': rich(`v${vs.manifest_version} · ${String(vs.manifest_digest || '').slice(0, 8)}`),
    '状态': { select: { name: '在册' } },
  };
}

export function valueStreamDigest(vs) {
  return propsDigest(buildValueStreamProps(vs));
}

const withSyncTime = (props) => ({ ...props, '同步时间': { date: { start: new Date().toISOString() } } });

async function upsertLedger(pool, vs, notionId, digest) {
  await pool.query(
    `INSERT INTO notion_map_node_pages (scope, node_key, notion_id, notion_digest, notion_synced_at, archived_at)
     VALUES ($1, $2, $3, $4, NOW(), NULL)
     ON CONFLICT (scope, node_key) DO UPDATE
        SET notion_id = EXCLUDED.notion_id, notion_digest = EXCLUDED.notion_digest,
            notion_synced_at = NOW(), archived_at = NULL`,
    [vs.scope_key, vs.node_key, notionId, digest]);
}

async function pushOne(pool, token, dbId, vs, ledgerRow, notionReq, stat) {
  const props = buildValueStreamProps(vs);
  const digest = propsDigest(props);
  if (ledgerRow?.notion_id && ledgerRow.notion_digest === digest && !ledgerRow.archived_at) {
    stat.skipped++;
    return;
  }
  if (ledgerRow?.notion_id) {
    try {
      await notionReq(token, `/pages/${ledgerRow.notion_id}`, 'PATCH', { properties: withSyncTime(props) });
      await upsertLedger(pool, vs, ledgerRow.notion_id, digest);
      stat.patched++;
      return;
    } catch (err) {
      if (!isPageGoneError(err)) throw err;
      // 页面被删或进了回收站 → 落到下面重建
    }
  }
  const page = await notionReq(token, '/pages', 'POST',
    { parent: { database_id: dbId }, properties: withSyncTime(props) });
  await upsertLedger(pool, vs, page.id, digest);
  stat.created++;
}

async function archiveOne(pool, token, row, notionReq, stat) {
  await notionReq(token, `/pages/${row.notion_id}`, 'PATCH', { properties: withSyncTime(ARCHIVED_PROPS) });
  await pool.query(
    `UPDATE notion_map_node_pages
        SET archived_at = NOW(), notion_digest = $3, notion_synced_at = NOW()
      WHERE scope = $1 AND node_key = $2`,
    [row.scope, row.node_key, propsDigest(ARCHIVED_PROPS)]);
  stat.archived++;
}

/**
 * 价值流镜子推送一轮。返回 null = 库未登记（跳过）；否则计数。
 * @param {object} deps { notionReq, logSyncError }
 */
export async function pushMapValueStreams(pool, token, deps = {}) {
  const notionReq = deps.notionReq ?? defaultNotionReq;
  const logSyncError = deps.logSyncError ?? (async () => {});
  const dbId = await resolveDbId(pool, LEDGER_TABLE);
  if (!dbId) return null;
  try {
    const { added } = await ensureOpsDbProps(token, dbId, VALUE_STREAM_DB_PROPS, { notionReq });
    if (added.length) console.log(`[value-stream-mirror] 补列: ${added.join(', ')}`);
  } catch (err) {
    await logSyncError(pool, `[value-stream-mirror] 补列失败: ${err.message}`);
  }

  const streams = await loadValueStreams(pool);
  const { rows: ledger } = await pool.query(
    `SELECT scope, node_key, notion_id, notion_digest, archived_at FROM notion_map_node_pages`);
  const byKey = new Map(ledger.map((l) => [`${l.scope}\u0000${l.node_key}`, l]));
  const stat = { created: 0, patched: 0, skipped: 0, archived: 0, failed: 0 };

  const live = new Set();
  for (const vs of streams) {
    const key = `${vs.scope_key}\u0000${vs.node_key}`;
    live.add(key);
    try {
      await pushOne(pool, token, dbId, vs, byKey.get(key), notionReq, stat);
    } catch (err) {
      stat.failed++;
      console.warn(`[value-stream-mirror] ${vs.scope_key}/${vs.node_key} 推送失败: ${err.message}`);
      await logSyncError(pool, `[value-stream-mirror] ${vs.scope_key}/${vs.node_key}: ${err.message}`);
    }
  }

  if (streams.length === 0) return stat; // 地图读空：不归档，防空投影抹镜子
  for (const row of ledger) {
    if (live.has(`${row.scope}\u0000${row.node_key}`) || !row.notion_id || row.archived_at) continue;
    try {
      await archiveOne(pool, token, row, notionReq, stat);
    } catch (err) {
      stat.failed++;
      console.warn(`[value-stream-mirror] 归档 ${row.scope}/${row.node_key} 失败: ${err.message}`);
      await logSyncError(pool, `[value-stream-mirror] 归档 ${row.scope}/${row.node_key}: ${err.message}`);
    }
  }
  return stat;
}

/** 供 notion-push-sync.runNotionPushSync 末尾挂接：吞错，不连坐同轮其它推送。 */
export async function runValueStreamMirror(pool, { token, notionReq, logSyncError } = {}) {
  try {
    return await pushMapValueStreams(pool, token ?? getToken(), { notionReq, logSyncError });
  } catch (err) {
    console.warn(`[value-stream-mirror] 投影失败（非阻断）: ${err.message}`);
    return { error: err.message };
  }
}
