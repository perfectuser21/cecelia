/**
 * notion-verdict-ingest.js — WS3 裁决窄口回读：从 Notion Inbox 消费主理人裁决
 *
 * FR-2：白名单字段仅三个（放行/不放行/批注），非白名单返回 skipped
 * - 放行=true → PATCH tasks status=completed + INSERT decisions + consumed_at 幂等锚
 * - 不放行=true → PATCH tasks status=cancelled + consumed_at 更新
 * - 批注非空（放行=false，不放行=false）→ UPDATE tasks description，不改 status
 * - 非白名单字段 → fail-closed，返回 {skipped:true}
 *
 * 幂等：检查 captures.consumed_at NOT NULL → already_consumed
 * 凭据缺失：NOTION_INBOX_TOKEN / NOTION_INBOX_DB_ID 未配置 → not_configured
 */

/** 白名单字段名列表（checkbox 类型） */
const VERDICT_CHECKBOX_FIELDS = ['放行', '不放行', '需拍板'];
/** 批注字段名 */
const VERDICT_ANNOTATION_FIELD = '批注';
/** 任务ID字段名 */
const VERDICT_TASK_ID_FIELD = '任务ID';

/**
 * 获取裁决回读凭据配置（从 process.env）
 * @returns {{token: string|null, dbId: string|null}}
 */
export function getVerdictIngestConfig() {
  return {
    token: process.env.NOTION_INBOX_TOKEN ?? null,
    dbId: process.env.NOTION_INBOX_DB_ID ?? null,
  };
}

/**
 * 从 Notion 页面提取 checkbox 字段值（fail-closed：非 checkbox 类型返回 undefined）
 * @param {object} properties - Notion 页面属性
 * @param {string} fieldName - 字段名
 * @returns {boolean|undefined}
 */
function extractCheckbox(properties, fieldName) {
  const prop = properties[fieldName];
  if (!prop || prop.type !== 'checkbox') return undefined;
  return !!prop.checkbox;
}

/**
 * 从 Notion 页面属性中提取 rich_text 纯文本
 * @param {object} properties - Notion 页面属性
 * @param {string} fieldName - 字段名
 * @returns {string}
 */
function extractRichText(properties, fieldName) {
  const prop = properties[fieldName];
  if (!prop || prop.type !== 'rich_text') return '';
  return (prop.rich_text ?? []).map(t => t.plain_text ?? '').join('');
}

/**
 * 消费单个 Notion Inbox 页面中的主理人裁决
 *
 * @param {object} pool - PostgreSQL 连接池
 * @param {object} page - Notion 页面对象（含 id, properties）
 * @returns {Promise<object>} 消费结果
 */
export async function consumeVerdictFromNotion(pool, page) {
  // INV-6: 凭据缺失静默跳过
  const { token } = getVerdictIngestConfig();
  if (!token) {
    return { skipped: true, reason: 'not_configured', action: null, task_id: null };
  }

  const properties = page?.properties ?? {};

  // INV-1 / INV-2: fail-closed — 检查是否包含白名单 checkbox 字段
  const [approvedField, rejectedField, reviewField] = VERDICT_CHECKBOX_FIELDS;
  const approvedValue = extractCheckbox(properties, approvedField);
  const rejectedValue = extractCheckbox(properties, rejectedField);
  const reviewRequired = extractCheckbox(properties, reviewField);

  // 如果白名单 checkbox 字段都不存在（undefined），说明页面没有裁决字段 → fail-closed
  if (approvedValue === undefined && rejectedValue === undefined) {
    return { skipped: true, reason: 'non_whitelist', action: null, task_id: null };
  }

  // 提取任务ID
  const taskId = extractRichText(properties, VERDICT_TASK_ID_FIELD);

  // INV-3: review_required=true 且 放行=false 时，等待拍板，跳过
  if (reviewRequired === true && !approvedValue) {
    return { skipped: true, reason: 'awaiting_approval', action: null, task_id: taskId || null };
  }

  // INV-4: 幂等检查——查 captures 表 consumed_at
  const capResult = await pool.query(
    `SELECT id, consumed_at, task_id FROM captures WHERE notion_page_id = $1 LIMIT 1`,
    [page.id]
  );

  // 如果没有找到 captures 记录，尝试用 taskId 查找
  let capture = capResult.rows[0] ?? null;
  if (!capture && taskId) {
    const capByTask = await pool.query(
      `SELECT id, consumed_at, task_id FROM captures WHERE task_id = $1 LIMIT 1`,
      [taskId]
    );
    capture = capByTask.rows[0] ?? null;
  }

  if (capture?.consumed_at != null) {
    return { skipped: true, reason: 'already_consumed', action: null, task_id: taskId || null };
  }

  const resolvedTaskId = taskId || capture?.task_id || null;

  // 提取批注内容
  const annotation = extractRichText(properties, VERDICT_ANNOTATION_FIELD);

  let action = null;

  if (approvedValue === true) {
    // 放行路径：PATCH tasks status=completed + INSERT decisions
    action = 'approved';

    if (resolvedTaskId) {
      // 写 decisions 表
      await pool.query(
        `INSERT INTO decisions (task_id, decision_type, decided_at, source, description)
         VALUES ($1, 'approved', NOW(), 'notion_verdict', '主理人通过 Notion Inbox 裁决放行')
         ON CONFLICT DO NOTHING`,
        [resolvedTaskId]
      );

      // 更新 tasks status
      await pool.query(
        `UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [resolvedTaskId]
      );
    }
  } else if (rejectedValue === true) {
    // 不放行路径：PATCH tasks status=cancelled
    action = 'rejected';

    if (resolvedTaskId) {
      await pool.query(
        `UPDATE tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [resolvedTaskId]
      );
    }
  } else if (annotation) {
    // 批注路径：追加 description，不改 status
    action = 'annotated';

    if (resolvedTaskId) {
      await pool.query(
        `UPDATE tasks SET description = COALESCE(description, '') || $1, updated_at = NOW() WHERE id = $2`,
        [`\n[Notion批注] ${annotation}`, resolvedTaskId]
      );
    }
  } else {
    // 没有任何有效裁决
    return { skipped: true, reason: 'no_verdict_fields', action: null, task_id: resolvedTaskId };
  }

  // 更新 captures.consumed_at 幂等锚
  if (capture?.id) {
    await pool.query(
      `UPDATE captures SET consumed_at = NOW() WHERE id = $1`,
      [capture.id]
    );
  }

  return {
    skipped: false,
    reason: null,
    action,
    task_id: resolvedTaskId,
  };
}

/**
 * 批量从 Notion Inbox DB 读取待裁决页面，逐页调用 consumeVerdictFromNotion
 * 替代 scheduler-jobs.js 中裸调 consumeVerdictFromNotion(pool, {}) 的接线错误
 *
 * @param {object} pool - PostgreSQL 连接池
 * @returns {Promise<object>} 汇总结果 {consumed, skipped_pages, errors}
 */
export async function runNotionVerdictIngest(pool) {
  const { token, dbId } = getVerdictIngestConfig();
  if (!token || !dbId) {
    return { skipped: true, reason: 'not_configured', consumed: 0, skipped_pages: 0, errors: 0 };
  }

  // 动态 import 避免循环依赖
  const { notionRequest } = await import('./notion-capture-ingest.js');
  let pages = [];
  try {
    const resp = await notionRequest(token, `/databases/${dbId}/query`, 'POST', {
      filter: {
        or: [
          { property: '放行', checkbox: { equals: true } },
          { property: '不放行', checkbox: { equals: true } },
        ],
      },
      page_size: 50,
    });
    pages = resp.results ?? [];
  } catch (e) {
    console.error('[notion-verdict-ingest] query failed:', e.message);
    return { skipped: false, consumed: 0, skipped_pages: 0, errors: 1 };
  }

  let consumed = 0, skipped_pages = 0, errors = 0;
  for (const page of pages) {
    try {
      const result = await consumeVerdictFromNotion(pool, page);
      if (result.skipped) skipped_pages++;
      else consumed++;
    } catch (e) {
      console.error('[notion-verdict-ingest] consume error:', e.message);
      errors++;
    }
  }
  return { consumed, skipped_pages, errors };
}
