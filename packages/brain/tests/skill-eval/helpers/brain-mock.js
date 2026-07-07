/**
 * Brain Tick 模拟器 — 用于调度逻辑单元测试
 */

export function createMockBrainTick({
  db,
  MAX_CONCURRENT_SKILL_EVAL = 1,
  SKILL_EVAL_TIMEOUT = 30 * 60, // 秒
  SKILL_EVAL_PENDING_LIMIT = 20,
  dockerExecutor = null,
  feishuFn = async () => {},
} = {}) {
  const feishuAlerts = [];

  async function sendFeishuAlert(payload) {
    feishuAlerts.push(payload);
    await feishuFn(payload);
  }

  async function schedule() {
    // 查询当前 running 数量
    const { running_count } = await db.one(
      `SELECT COUNT(*) as running_count FROM skill_eval_tasks WHERE status='running'`
    );

    if (parseInt(running_count) >= MAX_CONCURRENT_SKILL_EVAL) {
      return; // slot 已满，不调度
    }

    // 取最早的 pending 任务
    const pending = await db.oneOrNone(
      `SELECT task_id FROM skill_eval_tasks WHERE status='pending'
       ORDER BY created_at ASC LIMIT 1`
    );

    if (!pending) return;

    // 转为 running
    await db.none(
      `UPDATE skill_eval_tasks
       SET status='running', started_at=NOW(), updated_at=NOW()
       WHERE task_id=$1`,
      [pending.task_id]
    );
  }

  async function checkTimeouts() {
    const timedOut = await db.manyOrNone(
      `SELECT task_id, container_id FROM skill_eval_tasks
       WHERE status='running'
         AND started_at < NOW() - INTERVAL '${SKILL_EVAL_TIMEOUT} seconds'`
    );

    for (const task of timedOut) {
      // 强杀容器
      if (dockerExecutor && task.container_id) {
        dockerExecutor.kill(task.container_id);
      }

      // 更新任务状态
      await db.none(
        `UPDATE skill_eval_tasks
         SET status='failed', failure_reason='timeout', updated_at=NOW(), completed_at=NOW()
         WHERE task_id=$1`,
        [task.task_id]
      );

      // 触发飞书告警
      await sendFeishuAlert({ type: 'timeout', task_id: task.task_id });
    }
  }

  return {
    schedule,
    checkTimeouts,
    sendFeishuAlert,
    getAlerts: () => feishuAlerts,
  };
}
