/**
 * 守卫 1：任务的 goal_id 给了就必须是 KR 级（key_results.id）。
 * 决策 105a5868（决策分档）· 链 bf5088a3 棒5 · 任务 3fad28e0
 *
 * 病根：tick 派发白名单是 `key_results WHERE status IN (active,in_progress,decomposing)` 的 id
 * （tick-runner.js / tick-scheduler.js）。任务挂 Objective id 会被 selectNextDispatchableTask
 * 静默过滤——永远 queued、没有任何日志（近 14 天 tick 派出的 39 个任务 goal_id 全为 NULL，无人察觉）。
 * 不给 goal_id 的行为保持不变（本守卫不强制必填，必填由 actions.createTask 按任务类型另管）。
 */

/** tick 派发白名单里的 KR 状态（与 tick-runner.js 的 SQL 一致；KR 不在其中只提示、不拒绝）。 */
export const DISPATCHABLE_KR_STATUSES = ['active', 'in_progress', 'decomposing'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GoalGuardError extends Error {
  /** @param {string} message @param {{goal_id: string, is_objective: boolean, key_results: object[]}} details */
  constructor(message, details) {
    super(message);
    this.name = 'GoalGuardError';
    this.code = 'goal_id_not_key_result';
    this.details = details;
  }
}

/**
 * @param {{query: Function}} db pool 或事务 client
 * @param {string|null|undefined} goalId
 * @returns {Promise<{warning: string|null}>}
 * @throws {GoalGuardError}
 */
export async function assertGoalIsKeyResult(db, goalId) {
  if (goalId == null || goalId === '') return { warning: null };

  const id = String(goalId);
  if (!UUID_RE.test(id)) {
    throw new GoalGuardError(
      `goal_id 必须是 KR 级 id（key_results.id，uuid），收到非 uuid 值：${id.slice(0, 60)}`,
      { goal_id: id, is_objective: false, key_results: [] },
    );
  }

  const kr = await db.query('SELECT id, status FROM key_results WHERE id = $1::uuid', [id]);
  if (kr.rows.length > 0) {
    const status = kr.rows[0].status;
    if (!DISPATCHABLE_KR_STATUSES.includes(status)) {
      return {
        warning: `goal_id 指向的 KR 状态为 ${status}，不在 tick 派发白名单（${DISPATCHABLE_KR_STATUSES.join('/')}），任务不会被自动派发`,
      };
    }
    return { warning: null };
  }

  const obj = await db.query('SELECT id, title FROM objectives WHERE id = $1::uuid', [id]);
  const isObjective = obj.rows.length > 0;
  let keyResults = [];
  if (isObjective) {
    const list = await db.query(
      'SELECT id, title, status FROM key_results WHERE objective_id = $1::uuid ORDER BY created_at LIMIT 20',
      [id],
    );
    keyResults = list.rows;
  }
  throw new GoalGuardError(
    isObjective
      ? `goal_id ${id} 是 Objective id，不是 KR id：tick 派发白名单只认 key_results.id，挂 Objective 的任务会被静默过滤、永远 queued。请改用其名下 KR 的 id`
      : `goal_id ${id} 不存在于 key_results（必须是 KR 级 id）`,
    { goal_id: id, is_objective: isObjective, key_results: keyResults },
  );
}
