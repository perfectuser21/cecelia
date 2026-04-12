/** @module diary-scheduler
 * diary-scheduler.js
 *
 * 每日管家日报生成调度器
 *
 * 每次 Tick 末尾调用 generateDailyDiaryIfNeeded()，
 * 内部判断是否到达每日触发时间（15:00 UTC = 23:00 上海）。
 * 若是，则生成今日日报写入 design_docs（type='diary'），去重。
 *
 * 日报内容（v1）：
 *   - 今日数据：PR 合并数、决策新增数、任务完成数
 *   - KR 进度：所有活跃 KR 的名称与进度百分比
 *   - 异常告警：今日失败/隔离任务数
 */

// 每日触发时间（UTC 小时）15:00 UTC = 23:00 上海时间
const DIARY_HOUR_UTC = 15;

/**
 * 判断当前是否在日报生成窗口内（每次 tick 2min，窗口 2min）
 * @param {Date} now
 * @returns {boolean}
 */
export function shouldGenerateDiary(now = new Date()) {
  return now.getUTCHours() === DIARY_HOUR_UTC && now.getUTCMinutes() < 2;
}

/**
 * 查询所有活跃 KR 的标题和进度。
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{title: string, progress: number}>>}
 */
export async function fetchKRProgress(pool) {
  const { rows } = await pool.query(
    `SELECT title, progress FROM key_results WHERE status = 'active' ORDER BY title`
  );
  return rows;
}

/**
 * 查询今日失败/隔离任务数。
 * @param {import('pg').Pool} pool
 * @param {string} today - YYYY-MM-DD
 * @returns {Promise<number>}
 */
export async function fetchTodayFailedTasks(pool, today) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt
     FROM tasks
     WHERE status IN ('failed', 'quarantined')
       AND DATE(updated_at) = $1`,
    [today]
  );
  return rows[0]?.cnt || 0;
}

/**
 * 生成日报内容
 * @param {{ today: string, prs: number, decisions: number, completedTasks: number, krProgress: Array<{title: string, progress: number}>, failedTasks: number }} stats
 * @returns {string}
 */
export function buildDiaryContent({ today, prs, decisions, completedTasks, krProgress = [], failedTasks = 0 }) {
  const lines = [
    `# ${today} 管家日报`,
    '',
    `> 生成时间：${new Date().toISOString()}（UTC）`,
    '',
    '## 今日数据',
    '',
    `- PR 合并：${prs} 个`,
    `- 决策新增：${decisions} 条`,
    `- 任务完成：${completedTasks} 个`,
    '',
  ];

  // ── KR 进度 ─────────────────────────────────────────────────────────────
  lines.push('## KR 进度');
  lines.push('');
  if (krProgress.length === 0) {
    lines.push('- 暂无活跃 KR');
  } else {
    for (const kr of krProgress) {
      const bar = buildProgressBar(kr.progress);
      lines.push(`- ${kr.title}：${bar} ${kr.progress}%`);
    }
  }
  lines.push('');

  // ── 异常告警 ────────────────────────────────────────────────────────────
  lines.push('## 异常告警');
  lines.push('');
  if (failedTasks === 0) {
    lines.push('✅ 今日无失败/隔离任务，系统运行正常。');
  } else {
    lines.push(`⚠️ 今日失败/隔离任务：${failedTasks} 个，请及时排查。`);
  }
  lines.push('');

  lines.push('---');
  lines.push('此日报由 Cecelia Brain 自动生成。用户可在标注区追加备注。');

  return lines.join('\n');
}

/**
 * 将进度数值转为简单的文本进度条（10格）。
 * @param {number} pct - 0~100
 * @returns {string}
 */
function buildProgressBar(pct) {
  const filled = Math.round((pct / 100) * 10);
  return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]`;
}

/**
 * 每日管家日报生成（去重：同一天只生成一次）
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

    // 并发查询所有数据
    const [prsResult, decisionsResult, tasksResult, krProgress, failedTasks] = await Promise.all([
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
      fetchKRProgress(pool),
      fetchTodayFailedTasks(pool, today),
    ]);

    const stats = {
      today,
      prs: parseInt(prsResult.rows[0].count),
      decisions: parseInt(decisionsResult.rows[0].count),
      completedTasks: parseInt(tasksResult.rows[0].count),
      krProgress,
      failedTasks,
    };

    const content = buildDiaryContent(stats);

    await pool.query(
      `INSERT INTO design_docs (type, title, content, diary_date, author)
       VALUES ('diary', $1, $2, $3, 'cecelia')`,
      [`${today} 管家日报`, content, today]
    );

    console.log(`[diary-scheduler] 管家日报已生成: ${today}`);
  } catch (err) {
    console.error(`[diary-scheduler] 日报生成失败（非致命）: ${err.message}`);
  }
}
