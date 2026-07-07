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
  quotaProvider = null,
  onAlert = null,
} = {}) {
  const feishuAlerts = [];

  // tick 对象先定义，让各方法可以通过 tick.sendFeishuAlert 调用（支持 vi.spyOn）
  const tick = {
    async sendFeishuAlert(payload) {
      feishuAlerts.push(payload);
      await feishuFn(payload);
      if (onAlert) await onAlert(payload);
    },

    async schedule() {
      // 查询当前 running 数量
      const { running_count } = await db.one(
        `SELECT COUNT(*) as running_count FROM skill_eval_tasks WHERE status='running'`
      );

      if (parseInt(running_count) >= MAX_CONCURRENT_SKILL_EVAL) {
        return; // slot 已满，不调度
      }

      // 额度预检
      if (quotaProvider) {
        const quota = await quotaProvider.getSonnetQuota();
        const insufficient5h = quota.remaining_5h_pct < 85;
        const insufficient7d = quota.remaining_7d_pct < 90;
        if (insufficient5h || insufficient7d) {
          // 更新所有 pending 任务的 pending_reason
          const reason = `quota_insufficient: 5h=${quota.remaining_5h_pct}% 7d=${quota.remaining_7d_pct}%`;
          await db.none(
            `UPDATE skill_eval_tasks SET pending_reason=$1, updated_at=NOW() WHERE status='pending'`,
            [reason]
          );
          await tick.sendFeishuAlert({ type: 'quota_insufficient', quota });
          return;
        }
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
    },

    async checkTimeouts() {
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

        // 触发飞书告警（通过 tick.sendFeishuAlert，支持 vi.spyOn）
        await tick.sendFeishuAlert({ type: 'timeout', task_id: task.task_id });
      }
    },

    getAlerts: () => feishuAlerts,
  };

  return tick;
}
