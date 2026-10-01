/** 人补写原设备退回页：只恢复同一 task，让下一次正常派发重新查台账。 */
import { loadRegistryPool } from '../routing/cheap-gates.js';
import { resolvePhone } from '../routing/phone-resolver.js';
import { readPageContent } from './notion-page-content.js';

const ROUTE_KEYS = ['qiumi_route', 'run_id', 'provider', 'model', 'engine', 'qiumi_department',
  'qiumi_kind', 'qiumi_workflow_ref', 'workflow_ref', 'timeout_sec', 'thinking', 'acceptance'];
const normId = (s) => String(s ?? '').replace(/-/g, '').toLowerCase();
const validUserId = (id) => typeof id === 'string'
  && /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(id);

// 页面作者可为仅object/id的partial user；每次读页重新确认，不缓存编辑者身份。
async function confirmedHuman(page, token, notionReq) {
  const author = page.last_edited_by;
  if (author?.object !== 'user' || !validUserId(author.id)) return false;
  if (author.type !== undefined) return author.type === 'person';
  let timer;
  try {
    const user = await Promise.race([
      notionReq(token, `/users/${encodeURIComponent(author.id)}`, 'GET'),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 30000); }),
    ]);
    return user?.object === 'user' && validUserId(user.id)
      && normId(user.id) === normId(author.id) && user.type === 'person';
  } catch { return false; }
  finally { clearTimeout(timer); }
}
const editable = (page, row, parsePage) => {
  const zh = parsePage(page);
  return normId(page.id) === normId(row.payload.notion_zh_page_id)
    && zh.taskNo === `brain:${row.id}` && ['进行中', '委派'].includes(zh.status)
    && !page.archived && !page.in_trash && !zh.archived
    && !!page.last_edited_time;
};

// 通用 reader 对正文增强采用部分成功；恢复派发必须要求每次请求完整成功。
async function readCompleteBody(pageId, token, notionReq) {
  let failure;
  const visited = new Set();
  const body = await readPageContent(pageId, {
    maxChars: Infinity, maxDepth: Infinity,
    request: async (path) => {
      try {
        if (visited.has(path)) throw new Error('Notion blocks cursor or child cycle');
        visited.add(path);
        const response = await notionReq(token, path, 'GET');
        if (!Array.isArray(response?.results) || (response.has_more && !response.next_cursor)) {
          throw new Error('Notion blocks response incomplete');
        }
        return response;
      } catch (err) { failure = err; throw err; }
    },
  });
  if (failure) throw failure;
  return body;
}

// 只在独立借出的client上开短事务；Notion与台账解析都已在事务外完成。
async function queueWithReceipt(pool, row, source, resolution, page) {
  const client = await pool.connect();
  const pageId = row.payload.notion_zh_page_id;
  const original = row.payload.qiumi_source;
  let begun = false;
  let discardClient = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const updated = await client.query(
        `UPDATE tasks SET status = 'queued', blocked_reason = NULL, blocked_at = NULL,
           blocked_until = NULL, blocked_detail = NULL, error_message = NULL, claimed_by = NULL, claimed_at = NULL,
           payload = (COALESCE(payload, '{}'::jsonb) - $2::text[]) || jsonb_build_object('qiumi_source', $3::jsonb),
           notion_props = COALESCE(notion_props, '{}'::jsonb) - 'qiumi_pushed_status', updated_at = NOW()
         WHERE id = $1 AND status = 'blocked' AND blocked_reason = 'device_unresolved' AND task_type = 'qiumi_task'
           AND payload->>'notion_zh_page_id' = $5 AND payload->'qiumi_source' = $4::jsonb
           AND payload->>'device_task_id' IS NULL RETURNING id`,
        [row.id, ROUTE_KEYS, JSON.stringify(source), JSON.stringify(original), pageId],
      );
    if (!updated.rows?.length) { await client.query('ROLLBACK'); return false; }
    const evidence = {
      actor: 'notion-human', page_id: pageId, serial: resolution.phone.serial, matched_by: resolution.matchedBy,
      last_edited_time: page.last_edited_time, reason: 'device_unresolved_source_updated',
    };
    await client.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at) VALUES ($1, $2, $3::jsonb, NOW())`,
      [row.id, 'qiumi_device_rerouted', JSON.stringify(evidence)],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    if (begun) {
      try { await client.query('ROLLBACK'); } catch { discardClient = true; }
    } else discardClient = true;
    throw err;
  } finally { client.release(discardClient); }
}

export async function rerouteUnresolvedDevices(pool, token, { notionReq, parsePage }) {
  const stats = { rerouted: 0 };
  const { rows = [] } = await pool.query(
    `SELECT id, task_type, status, blocked_reason, payload FROM tasks
     WHERE task_type = 'qiumi_task' AND status = 'blocked' AND blocked_reason = 'device_unresolved'
       AND payload->>'notion_zh_page_id' IS NOT NULL ORDER BY updated_at, id`,
  );
  const candidates = rows.filter((r) => r.task_type === 'qiumi_task' && r.status === 'blocked'
    && r.blocked_reason === 'device_unresolved' && r.payload?.notion_zh_page_id
    && r.payload.qiumi_source && typeof r.payload.qiumi_source === 'object' && !Array.isArray(r.payload.qiumi_source) && !r.payload.device_task_id);
  if (!candidates.length) return stats;
  const registry = await loadRegistryPool(pool.query.bind(pool));
  if (registry.phoneSource !== 'phone_registry') return stats;
  for (const row of candidates) {
    try {
      const pageId = row.payload.notion_zh_page_id;
      const page = await notionReq(token, `/pages/${pageId}`, 'GET');
      if (!editable(page, row, parsePage) || !await confirmedHuman(page, token, notionReq)) continue;
      const zh = parsePage(page);
      const body = await readCompleteBody(pageId, token, notionReq);
      const original = row.payload.qiumi_source;
      const source = { ...original, title: zh.title, remark: zh.remark, body };
      if (['title', 'remark', 'body'].every((key) => String(source[key] ?? '').trim() === String(original[key] ?? '').trim())) continue;
      const resolution = resolvePhone([source.title, source.remark, source.body].join('\n'), registry.phoneRows);
      if (resolution.status !== 'unique') continue;
      // 正文读取可能跨多个请求；任何人工急停、页归属变化或新编辑都推迟到下一轮。
      const latest = await notionReq(token, `/pages/${pageId}`, 'GET');
      if (!editable(latest, row, parsePage) || latest.last_edited_time !== page.last_edited_time
        || JSON.stringify(latest.properties) !== JSON.stringify(page.properties)
        || !await confirmedHuman(latest, token, notionReq)) continue;
      if (await queueWithReceipt(pool, row, source, resolution, page)) stats.rerouted += 1;
    } catch (err) {
      console.warn(`[qiumi-device-reroute] 保持原退回 task=${row.id}: ${err.message}`);
    }
  }
  return stats;
}
