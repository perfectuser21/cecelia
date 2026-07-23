/**
 * triage-officer-rank.js — 排序官每日大轮（晨报前产能感知排序）
 *
 * 调度模型：scheduler-jobs.js 60s 轮询 + 本模块自 gate
 *   - 触发窗口：北京时间 07:00（UTC 23:00）± 12.5 分钟
 *   - 当日去重：sentinel key `triage_officer_leaderboard`，TTL 20h
 *
 * 产出写入 working_memory key `triage_officer_leaderboard`：
 *   {generated_at, budget:{top_n,token_slots,time_slots,avg_pr_hours,company_accounts},
 *    leaderboard:[{rank,id,title,priority,task_type,journey_name,queue_age_h}],
 *    line_watermarks:[{journey_name,tasks_7d,burn_rate,anomaly}],
 *    veto_deadline, vetoed}
 *
 * 产能预算算法：min(token余量, 槽数×工时/单PR均时)
 *   - token_slots = available_claude_accounts × 2（TOKEN_SLOTS_PER_ACCOUNT）
 *   - time_slots  = US_M4_PARALLEL_SLOTS × 16h / avg_pr_hours
 *   - avg_pr_hours: 从 tasks 30天历史滚动校准（禁静态表）
 *
 * 两层预算（先两层禁五层）：
 *   Layer 1 公司总供给 = llm_capacity 账号可用数汇总
 *   Layer 2 line水位   = 各线7天 PR 产出/burn rate（软配额只报警不硬拦）
 *
 * 否决窗：90min（默认放行时间 ≈ 08:30 晨报刻）
 */

const TRIGGER_UTC_HOUR = 23;
const TRIGGER_UTC_MINUTE = 0;
const WINDOW_HALF_MIN = 12;
const VETO_WINDOW_MIN = 90;
export const LEADERBOARD_KEY = 'triage_officer_leaderboard';
const TTL_MS = 20 * 60 * 60 * 1000;

const US_M4_PARALLEL_SLOTS = parseInt(process.env.TRIAGE_OFFICER_M4_SLOTS || '7', 10);
const DAILY_WORK_HOURS = 16;
const TOKEN_SLOTS_PER_ACCOUNT = 2;
const DEFAULT_AVG_PR_HOURS = 3;
const TOP_N_MAX = 10;
// 单线每天 >3 PR 触发烧率异常报警
const LINE_ANOMALY_BURN_RATE = 3;

export function isInTriageOfficerRankWindow(now = new Date()) {
  const totalMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const targetMin = TRIGGER_UTC_HOUR * 60 + TRIGGER_UTC_MINUTE;
  return Math.abs(totalMin - targetMin) <= WINDOW_HALF_MIN;
}

async function alreadyRanToday(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
      [LEADERBOARD_KEY],
    );
    if (!rows.length) return false;
    const generatedAt = rows[0].value_json?.generated_at;
    if (!generatedAt) return false;
    return (Date.now() - new Date(generatedAt).getTime()) < TTL_MS;
  } catch (e) {
    console.warn('[triage-officer-rank] sentinel read failed:', e.message);
    return false;
  }
}

/**
 * 从 tasks 滚动校准单 PR 平均工时（30 天，禁静态表）
 */
export async function computeAvgPrHours(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0) AS avg_hours
       FROM tasks
       WHERE status = 'completed'
         AND task_type IN ('dev', 'harness_initiative')
         AND started_at IS NOT NULL
         AND completed_at IS NOT NULL
         AND completed_at >= NOW() - INTERVAL '30 days'`,
    );
    const avg = parseFloat(rows[0]?.avg_hours);
    return Number.isFinite(avg) && avg > 0 ? avg : DEFAULT_AVG_PR_HOURS;
  } catch (e) {
    console.warn('[triage-officer-rank] avg_pr_hours query failed, using default:', e.message);
    return DEFAULT_AVG_PR_HOURS;
  }
}

/**
 * Layer 1 公司总供给：查可用 Claude 账号数
 */
async function computeAvailableAccounts(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM account_usage_cache
       WHERE (is_spending_capped IS DISTINCT FROM TRUE)
         AND (is_auth_failed IS DISTINCT FROM TRUE)`,
    );
    const cnt = parseInt(rows[0]?.cnt, 10);
    return Number.isFinite(cnt) && cnt > 0 ? cnt : 1;
  } catch {
    return 1;
  }
}

/**
 * 产能预算：top_n = min(token_slots, time_slots)，最少 1，最多 TOP_N_MAX
 */
export async function computeCapacityBudget(pool) {
  const [avgPrHours, companyAccounts] = await Promise.all([
    computeAvgPrHours(pool),
    computeAvailableAccounts(pool),
  ]);
  const tokenSlots = companyAccounts * TOKEN_SLOTS_PER_ACCOUNT;
  const timeSlots = Math.floor(US_M4_PARALLEL_SLOTS * DAILY_WORK_HOURS / avgPrHours);
  const topN = Math.max(1, Math.min(TOP_N_MAX, Math.min(tokenSlots, timeSlots)));
  return { top_n: topN, token_slots: tokenSlots, time_slots: timeSlots, avg_pr_hours: avgPrHours, company_accounts: companyAccounts };
}

/**
 * 从 queued 队列排序取 top_n 条（priority → task_type → 入队时长）
 */
export async function buildRankedLeaderboard(pool, topN) {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.priority, t.task_type,
              t.queued_at,
              (t.payload->>'journey_id') AS journey_id,
              j.name AS journey_name,
              EXTRACT(EPOCH FROM (NOW() - t.queued_at)) / 3600.0 AS queue_age_h
       FROM tasks t
       LEFT JOIN journeys j ON j.id = (t.payload->>'journey_id')::uuid
       WHERE t.status = 'queued'
         AND t.task_type IN ('dev', 'harness_initiative')
         AND t.claimed_by IS NULL
       ORDER BY
         CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
         CASE t.task_type WHEN 'dev' THEN 0 ELSE 1 END,
         t.queued_at ASC
       LIMIT $1`,
      [topN],
    );
    return rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      title: r.title,
      priority: r.priority ?? 'P2',
      task_type: r.task_type,
      journey_name: r.journey_name ?? null,
      queue_age_h: Math.round((parseFloat(r.queue_age_h) || 0) * 10) / 10,
    }));
  } catch (e) {
    console.warn('[triage-officer-rank] leaderboard query failed:', e.message);
    return [];
  }
}

/**
 * Layer 2 line水位：7天 PR 产出 + burn rate，异常进晨报
 */
export async function computeLineWatermarks(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT j.name AS journey_name,
              COUNT(t.id)::int AS tasks_7d,
              ROUND((COUNT(t.id) / 7.0)::numeric, 2) AS burn_rate
       FROM tasks t
       JOIN journeys j ON j.id = (t.payload->>'journey_id')::uuid
       WHERE t.status = 'completed'
         AND t.completed_at >= NOW() - INTERVAL '7 days'
       GROUP BY j.name
       ORDER BY tasks_7d DESC
       LIMIT 10`,
    );
    return rows.map((r) => {
      const burnRate = parseFloat(r.burn_rate) || 0;
      return {
        journey_name: r.journey_name,
        tasks_7d: r.tasks_7d,
        burn_rate: burnRate,
        anomaly: burnRate > LINE_ANOMALY_BURN_RATE,
      };
    });
  } catch (e) {
    console.warn('[triage-officer-rank] line_watermarks query failed:', e.message);
    return [];
  }
}

/**
 * 排序官每日大轮主函数（由 scheduler-jobs.js 轮询调用）
 */
export async function maybeRunTriageOfficerRank(pool) {
  if (!isInTriageOfficerRankWindow()) {
    return { skipped: true, reason: 'outside_window' };
  }
  if (await alreadyRanToday(pool)) {
    return { skipped: true, reason: 'already_ran_today' };
  }

  const budget = await computeCapacityBudget(pool);
  const [leaderboard, lineWatermarks] = await Promise.all([
    buildRankedLeaderboard(pool, budget.top_n),
    computeLineWatermarks(pool),
  ]);
  const generatedAt = new Date().toISOString();
  const vetoDl = new Date(Date.now() + VETO_WINDOW_MIN * 60 * 1000).toISOString();
  const anomalyLines = lineWatermarks.filter((w) => w.anomaly).map((w) => w.journey_name);

  const record = {
    generated_at: generatedAt,
    budget,
    leaderboard,
    line_watermarks: lineWatermarks,
    anomaly_lines: anomalyLines,
    veto_deadline: vetoDl,
    vetoed: false,
  };

  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [LEADERBOARD_KEY, JSON.stringify(record)],
    );
  } catch (e) {
    console.warn('[triage-officer-rank] sentinel write failed:', e.message);
  }

  console.log(`[triage-officer-rank] 榜单生成 top_n=${budget.top_n} items=${leaderboard.length} avg_pr_h=${budget.avg_pr_hours.toFixed(1)} veto=${vetoDl}`);
  return { ok: true, top_n: budget.top_n, leaderboard_count: leaderboard.length, veto_deadline: vetoDl, anomaly_lines: anomalyLines };
}
