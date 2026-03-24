/** @module diary-scheduler
 * diary-scheduler.js
 *
 * 每日日报生成调度器
 *
 * 每次 Tick 末尾调用 generateDailyDiaryIfNeeded()，
 * 内部判断是否到达每日触发时间（15:00 UTC = 23:00 上海）。
 * 若是，则生成今日日报写入 design_docs（type='diary'），去重。
 */

/* global console */

// 每日触发时间（UTC 小时）15:00 UTC = 23:00 上海时间
const DIARY_HOUR_UTC = 15;

/**
 * 判断当前是否在日报生成窗口内（每次 tick 2min，窗口 2min）
 * @param {Date} now
 * @returns {boolean}
 */
function shouldGenerateDiary(now = new Date()) {
  return now.getUTCHours() === DIARY_HOUR_UTC && now.getUTCMinutes() < 2;
}

/**
 * 生成日报内容
 * @param {{ today: string, prs: number, decisions: number, completedTasks: number }} stats
 * @returns {string}
 */
function buildDiaryContent({ today, prs, decisions, completedTasks }) {
  const lines = [
    `# ${today} 日报`,
    '',
    `> 生成时间：${new Date().toISOString()}（UTC）`,
    '',
    '## 今日数据',
    '',
    `- PR 合并：${prs} 个`,
    `- 决策新增：${decisions} 条`,
    `- 任务完成：${completedTasks} 个`,
    '',
    '## 说明',
    '',
    '此日报由 Cecelia Brain 自动生成。用户可在标注区追加备注。',
  ];
  return lines.join('\n');
}

/**
 * 每日日报生成（去重：同一天只生成一次）
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
export async function generateDailyDiaryIfNeeded(pool) {
  if (!shouldGenerateDiary()) return;

  const today = new Date().toISOString().slice(0, 10);

  try {
    // 去重检查：今天是否已生成
    const { rows: existing } = await pool.query(
      `SELECT id FROM design_docs WHERE type = 'diary' AND diary_date = $1`,
      [today]
    );
    if (existing.length > 0) return;

    // 汇总今日数据
    const [prsResult, decisionsResult, tasksResult] = await Promise.all([
      pool.query(
        `SELECT count(*) FROM dev_records WHERE merged_at::date = $1`,
        [today]
      ),
      pool.query(
        `SELECT count(*) FROM decisions WHERE created_at::date = $1`,
        [today]
      ),
      pool.query(
        `SELECT count(*) FROM tasks WHERE completed_at::date = $1`,
        [today]
      ),
    ]);

    const stats = {
      today,
      prs: parseInt(prsResult.rows[0].count),
      decisions: parseInt(decisionsResult.rows[0].count),
      completedTasks: parseInt(tasksResult.rows[0].count),
    };

    const content = buildDiaryContent(stats);

    await pool.query(
      `INSERT INTO design_docs (type, title, content, diary_date, author)
       VALUES ('diary', $1, $2, $3, 'cecelia')`,
      [`${today} 日报`, content, today]
    );

    console.log(`[diary-scheduler] 日报已生成: ${today}`);
  } catch (err) {
    console.error(`[diary-scheduler] 日报生成失败（非致命）: ${err.message}`);
  }
}
