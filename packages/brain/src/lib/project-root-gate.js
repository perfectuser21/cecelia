/**
 * 登记闸：多刀工作必须挂 project 根。链 bf5088a3 棒5·PR B · 任务 3fad28e0 · 决策 105a5868
 *
 * 「有表不填」的根因是没有闸：同一次工作登记 ≥2 个有依赖关系的任务，却没人强制挂 task_type='project' 根，
 * 于是 Notion 看板看不见项目与依赖，接力棒（parent_task_id / sequence_no）也串不起来。
 *
 * 「多刀」= 登记时 depends_on 非空，或 payload.multi_task===true（/dev 在决策/spec 声明多刀时带）。
 * 多刀任务必须挂到 project 根下：parent_task_id 沿祖先链（含自身，≤12 层）找到 task_type='project'。
 * 声明 multi_task 且父下已有兄弟、却没写 depends_on 键 → depends_on_required
 * （显式 depends_on: [] = 声明「刻意无依赖、并行」）。project 根自身豁免。
 * 闸在 Brain 建单入口（POST /tasks 与依赖 API），/dev Phase 0 走 POST /tasks 天然被闸，不需要改 engine。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PROJECT_TASK_TYPE = 'project';
const MAX_DEPTH = 12;

export class ProjectRootGateError extends Error {
  constructor(code, message, { hint = null, details = {} } = {}) {
    super(message);
    this.name = 'ProjectRootGateError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

const ROOT_HINT = '先建一个 task_type=project 的根任务，再让本任务的 parent_task_id 挂到它（多刀工作必须挂 project 根，否则 Notion 看板看不见项目与依赖）';

/** @returns {boolean} 本次登记是否算「多刀」 */
export function isMultiTaskRegistration({ dependsOn, payload }) {
  return (Array.isArray(dependsOn) && dependsOn.length > 0) || payload?.multi_task === true;
}

/**
 * 沿 parent_task_id 祖先链（含自身）找 project 根。
 * @returns {Promise<{id: string}|null>}
 */
export async function findProjectRoot(db, taskId) {
  if (typeof taskId !== 'string' || !UUID_RE.test(taskId)) return null;
  const { rows } = await db.query(
    `WITH RECURSIVE up(id, parent_task_id, task_type, depth) AS (
       SELECT id, parent_task_id, task_type, 0 FROM tasks WHERE id = $1::uuid
       UNION ALL
       SELECT t.id, t.parent_task_id, t.task_type, up.depth + 1
         FROM tasks t JOIN up ON t.id = up.parent_task_id
        WHERE up.depth < ${MAX_DEPTH}
     )
     SELECT id FROM up WHERE task_type = '${PROJECT_TASK_TYPE}' ORDER BY depth LIMIT 1`,
    [taskId],
  );
  return rows[0] ? { id: rows[0].id } : null;
}

/**
 * 建单入口调用。dependsOn 为 normalizeDependsOn 的结果（null = 没声明该键，[] = 显式空）。
 * @throws {ProjectRootGateError}
 */
export async function assertProjectRootForMultiTask(db, { taskType, parentTaskId, dependsOn, payload }) {
  if (taskType === PROJECT_TASK_TYPE) return;
  if (!isMultiTaskRegistration({ dependsOn, payload })) return;

  const root = parentTaskId ? await findProjectRoot(db, parentTaskId) : null;
  if (!root) {
    throw new ProjectRootGateError(
      'project_root_required',
      '多刀工作（带 depends_on 或 multi_task）必须挂 project 根：parent_task_id 的祖先链上没有 task_type=project 的任务',
      { hint: ROOT_HINT, details: { parent_task_id: parentTaskId ?? null } },
    );
  }

  if (payload?.multi_task === true && dependsOn === null) {
    const { rows } = await db.query('SELECT 1 AS one FROM tasks WHERE parent_task_id = $1::uuid LIMIT 1', [parentTaskId]);
    if (rows.length > 0) {
      throw new ProjectRootGateError(
        'depends_on_required',
        '声明 multi_task 且父任务下已有兄弟任务：必须写 payload.depends_on（刻意并行请显式写 depends_on: []）',
        { hint: '依赖写进 payload.depends_on（uuid 数组），或登记后用 POST /api/brain/tasks/:id/dependencies', details: { parent_task_id: parentTaskId } },
      );
    }
  }
}
