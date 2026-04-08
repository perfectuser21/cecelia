/**
 * weekly-content-report-generator.js
 *
 * 周报自动生成器。
 * 从 content_analytics 表聚合指定周期数据，写入 weekly_content_reports 表。
 *
 * 主要导出：
 *   - generateWeeklyContentReport(pool, weekLabel?) — 生成指定周（默认上周）的周报
 *   - getWeekRange(weekLabel)                        — 解析 "2026-W14" → { start, end }
 */

/**
 * 解析 ISO 周标签为日期范围。
 * @param {string} weekLabel - 如 "2026-W14"
 * @returns {{ start: Date, end: Date }}
 */
export function getWeekRange(weekLabel) {
  const [yearStr, weekStr] = weekLabel.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);

  // ISO 8601: 第 1 周包含当年第一个周四
  const jan4 = new Date(year, 0, 4); // 1月4日一定在第1周
  const jan4DayOfWeek = jan4.getDay() || 7; // 转为 1=周一, 7=周日
  const mondayOfWeek1 = new Date(jan4.getTime() - (jan4DayOfWeek - 1) * 86400000);

  const start = new Date(mondayOfWeek1.getTime() + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start, end };
}

/**
 * 获取上周的 ISO 周标签。
 * @returns {string} 如 "2026-W13"
 */
export function getLastWeekLabel() {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7; // 1=周一, 7=周日
  const lastMonday = new Date(now.getTime() - (dayOfWeek + 6) * 86400000);
  const year = lastMonday.getFullYear();
  const start = new Date(year, 0, 4);
  const startDayOfWeek = start.getDay() || 7;
  const mondayOfWeek1 = new Date(start.getTime() - (startDayOfWeek - 1) * 86400000);
  const week = Math.round((lastMonday - mondayOfWeek1) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * 聚合指定时间段内 content_analytics 数据。
 * @param {import('pg').Pool} pool
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {Promise<object>} 聚合结果
 */
async function aggregateContentAnalytics(pool, periodStart, periodEnd) {
  // 取每篇内容在周期内的最新快照（避免多次采集重复计算）
  const summaryRes = await pool.query(`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (platform, COALESCE(content_id, title))
        platform, views, likes, comments, shares, title, content_id
      FROM content_analytics
      WHERE collected_at >= $1 AND collected_at < $2
      ORDER BY platform, COALESCE(content_id, title), collected_at DESC
    )
    SELECT
      COUNT(*) AS total_pieces,
      COALESCE(SUM(views), 0) AS total_views,
      COALESCE(SUM(likes), 0) AS total_likes,
      COALESCE(SUM(comments), 0) AS total_comments,
      COALESCE(SUM(shares), 0) AS total_shares
    FROM latest_snapshots
  `, [periodStart, periodEnd]);

  const byPlatformRes = await pool.query(`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (platform, COALESCE(content_id, title))
        platform, views, likes, comments, shares
      FROM content_analytics
      WHERE collected_at >= $1 AND collected_at < $2
      ORDER BY platform, COALESCE(content_id, title), collected_at DESC
    )
    SELECT
      platform,
      COUNT(*) AS pieces,
      COALESCE(SUM(views), 0) AS views,
      COALESCE(SUM(likes), 0) AS likes,
      COALESCE(SUM(comments), 0) AS comments,
      COALESCE(SUM(shares), 0) AS shares
    FROM latest_snapshots
    GROUP BY platform
    ORDER BY views DESC
  `, [periodStart, periodEnd]);

  const topContentRes = await pool.query(`
    SELECT DISTINCT ON (platform, COALESCE(content_id, title))
      platform, title, views, likes, comments, shares, published_at
    FROM content_analytics
    WHERE collected_at >= $1 AND collected_at < $2
    ORDER BY platform, COALESCE(content_id, title), collected_at DESC
  `, [periodStart, periodEnd]);

  // 取每个平台 top 3，按 views 排序
  const topContentByPlatform = topContentRes.rows
    .sort((a, b) => Number(b.views) - Number(a.views))
    .slice(0, 10)
    .map(r => ({
      platform: r.platform,
      title: r.title || '(无标题)',
      views: Number(r.views),
      likes: Number(r.likes),
      comments: Number(r.comments),
      shares: Number(r.shares),
      published_at: r.published_at,
    }));

  const summary = summaryRes.rows[0];
  return {
    summary: {
      total_pieces: Number(summary.total_pieces),
      total_views: Number(summary.total_views),
      total_likes: Number(summary.total_likes),
      total_comments: Number(summary.total_comments),
      total_shares: Number(summary.total_shares),
    },
    by_platform: byPlatformRes.rows.map(r => ({
      platform: r.platform,
      pieces: Number(r.pieces),
      views: Number(r.views),
      likes: Number(r.likes),
      comments: Number(r.comments),
      shares: Number(r.shares),
    })),
    top_content: topContentByPlatform,
  };
}

/**
 * 计算与上周对比的增长率。
 * @param {import('pg').Pool} pool
 * @param {object} currentSummary
 * @param {Date} lastWeekStart
 * @param {Date} lastWeekEnd
 * @returns {Promise<object>}
 */
async function calcGrowthVsLastWeek(pool, currentSummary, lastWeekStart, lastWeekEnd) {
  const lastWeekRes = await pool.query(`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (platform, COALESCE(content_id, title))
        views, likes, shares
      FROM content_analytics
      WHERE collected_at >= $1 AND collected_at < $2
      ORDER BY platform, COALESCE(content_id, title), collected_at DESC
    )
    SELECT
      COALESCE(SUM(views), 0) AS total_views,
      COALESCE(SUM(likes), 0) AS total_likes,
      COUNT(*) AS total_pieces
    FROM latest_snapshots
  `, [lastWeekStart, lastWeekEnd]);

  const lw = lastWeekRes.rows[0];
  const calcGrowth = (curr, prev) => {
    const p = Number(prev);
    if (p === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - p) / p) * 100);
  };

  return {
    views_growth_pct: calcGrowth(currentSummary.total_views, lw.total_views),
    likes_growth_pct: calcGrowth(currentSummary.total_likes, lw.total_likes),
    pieces_growth_pct: calcGrowth(currentSummary.total_pieces, lw.total_pieces),
  };
}

/**
 * 生成指定周的内容周报。
 *
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {string} [options.weekLabel]  - ISO 周标签，如 "2026-W14"（默认上周）
 * @param {boolean} [options.dryRun]    - 仅返回数据不写入 DB
 * @returns {Promise<object>} 周报数据
 */
export async function generateWeeklyContentReport(pool, { weekLabel, dryRun = false } = {}) {
  const label = weekLabel || getLastWeekLabel();
  const { start, end } = getWeekRange(label);
  const periodEnd = new Date(end.getTime() + 86400000); // 周日结束后一天（不含）

  // 聚合本周数据
  const aggregated = await aggregateContentAnalytics(pool, start, periodEnd);

  // 对比上周
  const { start: lwStart, end: lwEnd } = getWeekRange(getPrevWeekLabel(label));
  const lwEnd2 = new Date(lwEnd.getTime() + 86400000);
  const vsLastWeek = await calcGrowthVsLastWeek(pool, aggregated.summary, lwStart, lwEnd2);

  const content = {
    ...aggregated,
    vs_last_week: vsLastWeek,
  };

  const metadata = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    data_rows: aggregated.summary.total_pieces,
  };

  if (dryRun) {
    return { week_label: label, period_start: start, period_end: end, content, metadata };
  }

  // 写入 DB（UPSERT）
  const res = await pool.query(`
    INSERT INTO weekly_content_reports (week_label, period_start, period_end, content, metadata)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (week_label) DO UPDATE
      SET content = EXCLUDED.content,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
    RETURNING id, week_label, period_start, period_end, created_at, updated_at
  `, [label, start, end, JSON.stringify(content), JSON.stringify(metadata)]);

  return { ...res.rows[0], content, metadata };
}

/**
 * 获取上一个 ISO 周标签。
 * @param {string} weekLabel - 如 "2026-W14"
 * @returns {string} 如 "2026-W13"
 */
function getPrevWeekLabel(weekLabel) {
  const { start } = getWeekRange(weekLabel);
  const prevMonday = new Date(start.getTime() - 7 * 86400000);
  const year = prevMonday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const mondayOfWeek1 = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
  const week = Math.round((prevMonday - mondayOfWeek1) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
