import { notionRequest } from '../notion-capture-ingest.js';
import { recordProjectionCommand } from './commands.js';

const TASK_STATUS = {
  pending: 'Waiting',
  queued: 'Waiting',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  paused: 'Blocked',
  completed: 'Done',
  failed: 'Failed',
  quarantined: 'Failed',
  cancelled: 'Cancelled',
};

function text(content) {
  return [{ type: 'text', text: { content: String(content ?? '').slice(0, 2000) } }];
}

export function buildNotionTaskProperties(task, projectExternalId = null) {
  const properties = {
    Name: { title: text(task.title || '未命名任务') },
    'Brain ID': { rich_text: text(task.id) },
    Status: { select: { name: TASK_STATUS[task.status] || 'Waiting' } },
    Priority: { select: { name: task.priority || 'P2' } },
    Type: { select: { name: task.task_type || 'dev' } },
    Command: { select: { name: 'None' } },
    Note: { rich_text: [] },
    'Last Brain Sync': { date: { start: new Date().toISOString() } },
  };
  if (projectExternalId) properties.Project = { relation: [{ id: projectExternalId }] };
  return properties;
}

export function buildNotionProjectProperties(project) {
  return {
    Name: { title: text(project.title || project.name || '未命名项目') },
    'Brain ID': { rich_text: text(project.id) },
    Status: { select: { name: project.status || 'active' } },
    'Last Brain Sync': { date: { start: new Date().toISOString() } },
  };
}

export function commandFromNotionTask({ notionStatus, brainStatus, explicitCommand }) {
  if (explicitCommand === 'Start') return 'start_requested';
  if (explicitCommand === 'Cancel') return 'cancel_requested';
  if (notionStatus === 'In Progress' && ['queued', 'pending'].includes(brainStatus)) return 'start_requested';
  if (notionStatus === 'Cancelled' && ['queued', 'pending', 'blocked', 'paused'].includes(brainStatus)) return 'cancel_requested';
  return null;
}

async function getConfig(pool) {
  const { rows } = await pool.query(
    `SELECT enabled, config FROM projection_targets WHERE target='notion' LIMIT 1`
  ).catch(() => ({ rows: [] }));
  const stored = rows[0]?.config ?? {};
  return {
    enabled: rows[0]?.enabled ?? true,
    token: process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_INBOX_TOKEN || null,
    taskDbId: stored.task_db_id || process.env.NOTION_TASKS_DB_ID || null,
    projectDbId: stored.project_db_id || process.env.NOTION_PROJECTS_DB_ID || null,
    commandCursor: stored.command_cursor || null,
  };
}

async function loadEntity(pool, event) {
  if (event.entity_type === 'tasks') {
    const { rows } = await pool.query(
      `SELECT t.*,
              COALESCE(t.project_id, oi.project_id, os.project_id) AS canonical_project_id
       FROM tasks t
       LEFT JOIN okr_initiatives oi ON oi.id=t.okr_initiative_id
       LEFT JOIN okr_scopes os ON os.id=oi.scope_id
       WHERE t.id=$1`,
      [event.entity_id]
    );
    return rows[0] ?? null;
  }
  if (event.entity_type === 'projects') {
    const { rows } = await pool.query('SELECT * FROM okr_projects WHERE id=$1', [event.entity_id]);
    return rows[0] ?? null;
  }
  return null;
}

export async function syncNotionEntity(pool, event) {
  if (event.target !== 'notion') return { skipped: true, reason: 'unsupported_target' };
  const config = await getConfig(pool);
  if (!config.enabled || !config.token || !config.taskDbId || !config.projectDbId) {
    return { skipped: true, reason: 'not_configured' };
  }

  const entity = await loadEntity(pool, event);
  if (!entity) return { skipped: true, reason: 'entity_not_found' };

  const { rows: linkRows } = await pool.query(
    `SELECT external_id FROM projection_links
     WHERE target='notion' AND entity_type=$1 AND entity_id=$2`,
    [event.entity_type, event.entity_id]
  );
  const existingExternalId = linkRows[0]?.external_id ?? null;

  let properties;
  let databaseId;
  if (event.entity_type === 'tasks') {
    databaseId = config.taskDbId;
    let projectExternalId = null;
    if (entity.canonical_project_id) {
      const { rows } = await pool.query(
        `SELECT external_id FROM projection_links
         WHERE target='notion' AND entity_type='projects' AND entity_id=$1`,
        [entity.canonical_project_id]
      );
      projectExternalId = rows[0]?.external_id ?? null;
    }
    properties = buildNotionTaskProperties(entity, projectExternalId);
  } else {
    databaseId = config.projectDbId;
    properties = buildNotionProjectProperties(entity);
  }

  const page = existingExternalId
    ? await notionRequest(config.token, `/pages/${existingExternalId}`, 'PATCH', { properties })
    : await notionRequest(config.token, '/pages', 'POST', {
        parent: { database_id: databaseId },
        properties,
      });
  const externalId = page.id || existingExternalId;

  await pool.query(
    `INSERT INTO projection_links (target, entity_type, entity_id, external_id, last_synced_at)
     VALUES ('notion',$1,$2,$3,NOW())
     ON CONFLICT (target, entity_type, entity_id) DO UPDATE
       SET external_id=EXCLUDED.external_id, last_synced_at=NOW(), updated_at=NOW()`,
    [event.entity_type, event.entity_id, externalId]
  );
  const table = event.entity_type === 'tasks' ? 'tasks' : 'okr_projects';
  await pool.query(
    `UPDATE ${table} SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2`,
    [externalId, event.entity_id]
  );
  return { externalId };
}

function richText(properties, key) {
  return (properties?.[key]?.rich_text ?? []).map(item => item.plain_text ?? '').join('').trim();
}

export function __resetNotionTaskCommandIngestForTest() {
  // Cursor 已持久化在 projection_targets；保留测试入口以兼容旧调用方。
}

export async function runNotionTaskCommandIngest(pool) {
  const config = await getConfig(pool);
  if (!config.enabled || !config.token || !config.taskDbId) {
    return { skipped: true, reason: 'not_configured' };
  }
  const after = config.commandCursor || new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const syncAt = new Date().toISOString();
  const pages = [];
  let startCursor = null;
  do {
    const body = {
      filter: { timestamp: 'last_edited_time', last_edited_time: { after } },
      page_size: 100,
    };
    if (startCursor) body.start_cursor = startCursor;
    const response = await notionRequest(config.token, `/databases/${config.taskDbId}/query`, 'POST', body);
    pages.push(...(response.results ?? []));
    startCursor = response.has_more ? response.next_cursor : null;
  } while (startCursor);

  let recorded = 0;
  for (const page of pages) {
    const taskId = richText(page.properties, 'Brain ID');
    if (!taskId) continue;
    const { rows } = await pool.query('SELECT id, status FROM tasks WHERE id=$1', [taskId]);
    const task = rows[0];
    if (!task) continue;
    const notionStatus = page.properties?.Status?.status?.name || page.properties?.Status?.select?.name || null;
    const explicitCommand = page.properties?.Command?.select?.name || null;
    const commandType = commandFromNotionTask({ notionStatus, brainStatus: task.status, explicitCommand });
    const annotation = richText(page.properties, 'Note');
    const effectiveCommand = commandType || (annotation ? 'annotate_requested' : null);
    if (!effectiveCommand) continue;
    await recordProjectionCommand(pool, {
      target: 'notion',
      externalId: `${page.id}:${page.last_edited_time}`,
      entityId: task.id,
      commandType: effectiveCommand,
      payload: annotation ? { annotation } : {},
    });
    recorded += 1;
  }
  await pool.query(
    `UPDATE projection_targets
     SET config=jsonb_set(config, '{command_cursor}', to_jsonb($1::text), true),
         last_success_at=NOW(), last_error=NULL, updated_at=NOW()
     WHERE target='notion'`,
    [syncAt]
  );
  return { pages: pages.length, recorded };
}

export async function bootstrapNotionDatabases(pool, parentPageId) {
  if (!parentPageId) throw new Error('parent_page_id is required');
  const token = process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_INBOX_TOKEN;
  if (!token) throw new Error('Notion token is not configured');

  const existing = await getConfig(pool);
  if (existing.taskDbId && existing.projectDbId) {
    try {
      await Promise.all([
        notionRequest(token, `/databases/${existing.taskDbId}`, 'GET'),
        notionRequest(token, `/databases/${existing.projectDbId}`, 'GET'),
      ]);
      return { task_db_id: existing.taskDbId, project_db_id: existing.projectDbId, reused: true };
    } catch {
      // 已存配置属于失效 workspace 时，继续在新 parent 下创建并替换配置。
    }
  }

  const projectDb = await notionRequest(token, '/databases', 'POST', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: text('Cecelia Projects'),
    properties: {
      Name: { title: {} },
      'Brain ID': { rich_text: {} },
      Status: { select: { options: ['planning', 'active', 'completed', 'cancelled'].map(name => ({ name })) } },
      'Last Brain Sync': { date: {} },
    },
  });
  const taskDb = await notionRequest(token, '/databases', 'POST', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: text('Cecelia Tasks'),
    properties: {
      Name: { title: {} },
      'Brain ID': { rich_text: {} },
      Status: { select: { options: ['Waiting', 'In Progress', 'Blocked', 'Done', 'Failed', 'Cancelled'].map(name => ({ name })) } },
      Priority: { select: { options: ['P0', 'P1', 'P2'].map(name => ({ name })) } },
      Type: { select: {} },
      Project: { relation: { database_id: projectDb.id, single_property: {} } },
      Command: { select: { options: ['None', 'Start', 'Cancel'].map(name => ({ name })) } },
      Note: { rich_text: {} },
      'Last Brain Sync': { date: {} },
    },
  });
  await configureNotionProjection(pool, { taskDbId: taskDb.id, projectDbId: projectDb.id, parentPageId });
  return { task_db_id: taskDb.id, project_db_id: projectDb.id };
}

export async function configureNotionProjection(pool, { taskDbId, projectDbId, parentPageId = null }) {
  if (!taskDbId || !projectDbId) throw new Error('task_db_id and project_db_id are required');
  const token = process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_INBOX_TOKEN;
  if (!token) throw new Error('Notion token is not configured');
  await Promise.all([
    notionRequest(token, `/databases/${taskDbId}`, 'GET'),
    notionRequest(token, `/databases/${projectDbId}`, 'GET'),
  ]);
  await pool.query(
    `INSERT INTO projection_targets (target, enabled, config, updated_at)
     VALUES ('notion', TRUE, $1, NOW())
     ON CONFLICT (target) DO UPDATE SET enabled=TRUE, config=EXCLUDED.config, updated_at=NOW()`,
    [JSON.stringify({
      task_db_id: taskDbId,
      project_db_id: projectDbId,
      parent_page_id: parentPageId,
      command_cursor: new Date().toISOString(),
    })]
  );
  return { task_db_id: taskDbId, project_db_id: projectDbId };
}
