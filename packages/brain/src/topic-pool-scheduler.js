/**
 * topic-pool-scheduler.js
 *
 * 主理人选题池调度器 v1。
 * 每次 tick 末尾调用 triggerTopicPoolSchedule()，内部判断是否需要触发。
 *
 * 触发窗口：UTC 01:00-12:00（北京时间 09:00-20:00）
 * 幂等保证：同一天已创建的 topic-pool pipeline 数量 >= daily_limit → 跳过
 * 触发逻辑：
 *   1. 读取节奏配置（topics_rhythm_config.daily_limit，默认 1）
 *   2. 检查今日已通过 topic-pool 触发创建的 pipeline 数
 *   3. 不足 daily_limit → 从 topics 表取高优先级的 status='已通过' 条目
 *   4. 为每个 topic 创建 content-pipeline task，payload 含 topic_id
 *   5. 回写 topics.status='已发布' + pipeline_task_id
 */

import pool from './db.js';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 触发窗口：UTC 01:00-12:00（北京 09:00-20:00） */
const TRIGGER_START_UTC = 1;
const TRIGGER_END_UTC = 12;

/** 内容生成 KR goal_id */
const CONTENT_KR_GOAL_ID = '65b4142d-242b-457d-abfa-c0c38037f1e9';

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 主理人选题池触发器。由 tick.js 在每次 Tick 末尾调用。
 *
 * @param {import('pg').Pool} dbPool
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {Promise<{triggered: number, skipped: boolean, reason?: string}>}
 */
export async function triggerTopicPoolSchedule(dbPool = pool, now = new Date()) {
  const utcHour = now.getUTCHours();

  // 窗口检查
  if (utcHour < TRIGGER_START_UTC || utcHour >= TRIGGER_END_UTC) {
    return { triggered: 0, skipped: true, reason: 'outside_window' };
  }

  try {
    // 1. 读取节奏配置
    const rhythmResult = await dbPool.query(
      `SELECT daily_limit FROM topics_rhythm_config ORDER BY id LIMIT 1`
    );
    const dailyLimit = rhythmResult.rows[0]?.daily_limit ?? 1;

    if (dailyLimit === 0) {
      return { triggered: 0, skipped: true, reason: 'daily_limit_zero' };
    }

    // 2. 今日已通过 topic-pool 创建的 pipeline 数（幂等）
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
    const countResult = await dbPool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM tasks
       WHERE task_type = 'content-pipeline'
         AND (payload->>'trigger_source') = 'topic_pool'
         AND DATE(created_at AT TIME ZONE 'UTC') = $1`,
      [today]
    );
    const alreadyToday = countResult.rows[0]?.cnt ?? 0;

    if (alreadyToday >= dailyLimit) {
      return { triggered: 0, skipped: true, reason: 'daily_limit_reached', already: alreadyToday };
    }

    const remaining = dailyLimit - alreadyToday;

    // 3. 取高优先级的 status='已通过' topics
    const { rows: topics } = await dbPool.query(
      `SELECT id, title, angle, priority, target_platforms
       FROM topics
       WHERE status = '已通过'
       ORDER BY priority DESC, created_at ASC
       LIMIT $1`,
      [remaining]
    );

    if (topics.length === 0) {
      return { triggered: 0, skipped: true, reason: 'no_approved_topics' };
    }

    // 4. 为每个 topic 创建 content-pipeline task
    let triggered = 0;
    for (const topic of topics) {
      try {
        const title = `[内容流水线] ${topic.title} ${today}`;
        const payload = JSON.stringify({
          keyword: topic.title,
          pipeline_keyword: topic.title,
          content_type: 'solo-company-case',
          topic_id: topic.id,
          topic_angle: topic.angle || '',
          target_platforms: topic.target_platforms || [],
          trigger_source: 'topic_pool',
          triggered_date: today,
        });

        const { rows: taskRows } = await dbPool.query(
          `INSERT INTO tasks (
             title, task_type, status, priority,
             goal_id, created_by, payload, trigger_source, location, domain
           )
           VALUES (
             $1, 'content-pipeline', 'queued', 'P1',
             $2, 'cecelia-brain', $3, 'brain_auto', 'us', 'content'
           )
           RETURNING id`,
          [title, CONTENT_KR_GOAL_ID, payload]
        );

        const taskId = taskRows[0]?.id;

        // 5. 回写 topics 状态
        await dbPool.query(
          `UPDATE topics SET status = '已发布', pipeline_task_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [taskId, topic.id]
        );

        triggered++;
        console.log(`[topic-pool-scheduler] 已触发 topic="${topic.title}" → task ${taskId}`);
      } catch (topicErr) {
        console.error(`[topic-pool-scheduler] 处理 topic ${topic.id} 失败:`, topicErr.message);
      }
    }

    return { triggered, skipped: false };
  } catch (err) {
    console.error('[topic-pool-scheduler] 调度失败:', err.message);
    return { triggered: 0, skipped: true, reason: 'error', error: err.message };
  }
}
