/* global console */
/**
 * Action Pipeline — 去重检查 + 自动写入 tasks 队列
 *
 * 接收解析出的 [ACTION:] 动作数组，执行去重后写入 tasks 表。
 * 用于 cortex 等模块在分析后将建议任务持久化到队列。
 */
import pool from './db.js';

/**
 * 查询当前最早创建的活跃 Initiative（兜底 project_id）
 * @returns {Promise<string|null>}
 */
async function getDefaultInitiativeId() {
  try {
    const result = await pool.query(
      `SELECT id FROM projects
       WHERE type = 'initiative' AND status IN ('active', 'in_progress')
       ORDER BY created_at ASC
       LIMIT 1`
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    console.warn('[action-pipeline] 获取默认 initiative 失败:', err.message);
    return null;
  }
}

/**
 * 将一批动作入队到 tasks 表，执行去重检查。
 *
 * @param {Array<{title: string, description?: string, priority?: string, project_id?: string}>} actions
 *   要入队的动作列表，每项至少需要 title
 * @param {Object} [context={}]
 *   调用上下文
 * @param {string} [context.project_id]
 *   优先使用的 initiative id；为空时查询活跃 initiative 兜底
 * @returns {Promise<{created: number, skipped: number}>}
 *   created: 新建任务数，skipped: 因重复或无效跳过数
 */
export async function enqueueActions(actions, context = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { created: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;

  // 懒加载 fallbackProjectId：context 优先，否则在首次需要时查询活跃 initiative
  const contextProjectId = context.project_id || null;
  let resolvedFallbackProjectId;
  let fallbackResolved = false;

  async function getFallbackProjectId() {
    if (fallbackResolved) return resolvedFallbackProjectId;
    fallbackResolved = true;
    resolvedFallbackProjectId = contextProjectId || await getDefaultInitiativeId();
    return resolvedFallbackProjectId;
  }

  for (const action of actions) {
    const title = typeof action.title === 'string' ? action.title.trim() : '';
    if (!title) {
      console.warn('[action-pipeline] 跳过无 title 的动作:', JSON.stringify(action).slice(0, 80));
      skipped++;
      continue;
    }

    // 去重：相同 title 且状态非终态则跳过
    let dedupRow;
    try {
      const dedupResult = await pool.query(
        `SELECT 1 FROM tasks
         WHERE title = $1
           AND status NOT IN ('completed', 'failed', 'quarantined')
         LIMIT 1`,
        [title]
      );
      dedupRow = dedupResult.rows[0];
    } catch (err) {
      console.error('[action-pipeline] 去重查询失败:', err.message);
      skipped++;
      continue;
    }

    if (dedupRow) {
      console.log(`[action-pipeline] 跳过重复任务: "${title}"`);
      skipped++;
      continue;
    }

    const projectId = action.project_id || await getFallbackProjectId();
    const description = action.description || null;
    const priority = action.priority || 'P2';

    try {
      await pool.query(
        `INSERT INTO tasks (title, description, task_type, priority, project_id, status, trigger_source)
         VALUES ($1, $2, 'dev', $3, $4, 'queued', 'cortex')`,
        [title, description, priority, projectId]
      );
      console.log(`[action-pipeline] 已创建任务: "${title}" (project_id=${projectId})`);
      created++;
    } catch (err) {
      console.error(`[action-pipeline] 任务写入失败 "${title}":`, err.message);
      skipped++;
    }
  }

  console.log(`[action-pipeline] 完成 — created=${created}, skipped=${skipped}`);
  return { created, skipped };
}
