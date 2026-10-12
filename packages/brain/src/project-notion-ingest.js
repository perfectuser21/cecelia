/** Projects 工作面回灌：人工列合并、身份恢复、完整分页后推进游标。 */
import { notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { readHuman, mergeHuman, notionText, NOTION_TO_PROJECT_STATUS, PROJECTS_DB } from './lib/project-notion-human.js';

const OUTCOME = Symbol('projectNotionIngest');
const BRAIN_ID = /^brain:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function outcome(root, imported, updated) {
  Object.defineProperty(root, OUTCOME, { value: { imported, updated }, configurable: true });
  return root;
}

async function importPage(client, page, dbId) {
  const name = notionText(page.properties?.Name?.title).trim();
  if (!name) throw new Error(`Projects 页面 ${page.id} 标题为空`);
  const human = readHuman(page);
  const status = NOTION_TO_PROJECT_STATUS[human.status];
  if (!status) throw new Error(`Projects 页面 ${page.id} 状态无法识别：${human.status}`);
  const props = { notion_id: page.id, project_db: dbId, human_baseline: human };
  const { rows } = await client.query(
    `INSERT INTO projects (name, status, custom_props, end_date, ai_tier, metadata, notion_props)
     VALUES ($1, $2, $3::jsonb, $4, $5, '{"source":"notion"}'::jsonb, $6::jsonb) RETURNING *`,
    [name, status, JSON.stringify({ priority: human.priority, remark: human.remark }), human.due,
      human.ai_tier, JSON.stringify(props)],
  );
  return outcome(rows[0], true, false);
}

async function mergePage(client, root, page, dbId) {
  const merged = mergeHuman(root, readHuman(page));
  const metadata = { ...merged.root.metadata };
  if (merged.overrides.length) {
    metadata.notion_overrides = [...(Array.isArray(metadata.notion_overrides) ? metadata.notion_overrides : []),
      ...merged.overrides].slice(-20);
  }
  const props = { ...root.notion_props, notion_id: page.id, project_db: dbId, human_baseline: merged.baseline };
  delete props.pending_human_push;
  const shouldWrite = merged.changed || JSON.stringify(metadata) !== JSON.stringify(root.metadata || {})
    || JSON.stringify(props) !== JSON.stringify(root.notion_props || {});
  if (!shouldWrite) return outcome(root, false, false);
  const { rows } = await client.query(
    `UPDATE projects SET status = $2, custom_props = $3::jsonb, end_date = $4, ai_tier = $5,
       metadata = $6::jsonb, notion_props = $7::jsonb, updated_at = ${merged.changed ? 'NOW()' : 'updated_at'}
     WHERE id = $1 RETURNING *`,
    [root.id, merged.root.status, JSON.stringify(merged.root.custom_props || {}), merged.root.end_date,
      merged.root.ai_tier, JSON.stringify(metadata), JSON.stringify(props)],
  );
  return outcome(rows[0], false, true);
}

/** 调用方持有全轮 advisory lock；每页数据库改动独立提交，外部身份回填可重放。 */
export async function ingestProjectPage(client, token, page, {
  notionReq = defaultNotionReq, dbId = PROJECTS_DB,
} = {}) {
  if (!page?.id) throw new Error('Projects 回灌页面缺少 id');
  if (page.archived || page.in_trash) return null;
  const runId = notionText(page.properties?.['Run ID']?.rich_text).trim();
  const isArchived = page.properties?.Archive?.checkbox === true;
  let root;
  await client.query('BEGIN');
  try {
    const linked = await client.query("SELECT * FROM projects WHERE notion_props->>'notion_id' = $1 FOR UPDATE", [page.id]);
    root = linked.rows[0];
    if (!root && runId) {
      const match = runId.match(BRAIN_ID);
      if (match) {
        root = (await client.query('SELECT * FROM projects WHERE id = $1 FOR UPDATE', [match[1]])).rows[0];
        if (root?.notion_props?.notion_id && root.notion_props.notion_id !== page.id) {
          if (isArchived) root = null; // 历史副本留档，不重新认领或阻断活跃页。
          else throw new Error(`Projects 页面 ${page.id} 的 Run ID 已关联其他页面`);
        }
      }
    }
    if (root) root = await mergePage(client, root, page, dbId);
    else if (!runId && !isArchived) root = await importPage(client, page, dbId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  if (!root) return null;
  // 数据库先持久化身份：远端失败后，下一轮凭 notion_id 找回同一行继续补写。
  if (runId !== `brain:${root.id}`) {
    await notionReq(token, `/pages/${page.id}`, 'PATCH', {
      properties: { 'Run ID': { rich_text: [{ type: 'text', text: { content: `brain:${root.id}` } }] } },
    });
  }
  return root;
}

/** 任一读取/回写失败都不推进游标，调度入口据 failed 停止本轮后续推送。 */
export async function pullProjects(client, token, {
  notionReq = defaultNotionReq, dbId = PROJECTS_DB, log = console, now = new Date(),
} = {}) {
  const stat = { read: 0, imported: 0, updated: 0, failed: 0 };
  const startedAt = new Date(typeof now === 'function' ? now() : now).toISOString();
  try {
    const { rows } = await client.query('SELECT last_seen FROM ops_notion_ingest_cursor WHERE db_key = $1', ['projects']);
    const since = rows[0]?.last_seen;
    const filter = since ? { timestamp: 'last_edited_time', last_edited_time: {
      on_or_after: new Date(new Date(since).getTime() - 120000).toISOString(),
    } } : undefined;
    const seenCursors = new Set();
    let cursor;
    do {
      const response = await notionReq(token, `/databases/${dbId}/query`, 'POST', {
        page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
        ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}),
      });
      if (!Array.isArray(response?.results)) throw new Error('Projects 查询未返回完整页面列表');
      for (const page of response.results) {
        stat.read++;
        try {
          const root = await ingestProjectPage(client, token, page, { notionReq, dbId });
          if (root?.[OUTCOME]?.imported) stat.imported++;
          if (root?.[OUTCOME]?.updated) stat.updated++;
        } catch (err) {
          stat.failed++;
          log.warn(`[projects-notion] 页面 ${page?.id} 回灌失败：${err.message}`);
        }
      }
      cursor = response.has_more ? response.next_cursor : null;
      if (response.has_more && (!cursor || seenCursors.has(cursor))) throw new Error('Projects 分页游标缺失或重复');
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    if (!stat.failed) {
      await client.query(
        `INSERT INTO ops_notion_ingest_cursor (db_key, last_seen, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (db_key) DO UPDATE SET last_seen = GREATEST(ops_notion_ingest_cursor.last_seen, EXCLUDED.last_seen), updated_at = NOW()`,
        ['projects', startedAt],
      );
    }
  } catch (err) {
    stat.failed++;
    log.warn(`[projects-notion] 查询或游标提交失败：${err.message}`);
  }
  return stat;
}
