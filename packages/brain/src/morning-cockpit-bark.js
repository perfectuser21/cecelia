/**
 * morning-cockpit-bark.js — 晨报 Bark 推送（主理人指挥舱 FR-09）
 *
 * Task ID: 80a5be84-059a-4d86-a55c-a1e38f84e043
 * Sprint:  sprints/07162300-owner-cockpit
 *
 * 调度模型：scheduler-jobs.js 60s 轮询 + 本模块自 gate
 *   - 触发窗口：北京时间 08:30（UTC 00:30）± 5 分钟
 *   - 当日去重：sentinel key `morning-cockpit-bark`，TTL 20h
 *   - 无硬编码 BARK_TOKEN：复用 notifier.js 的 sendBark()
 *
 * 推送内容：指挥舱 Dashboard 链接 + 当日简报（任务数/完成率）
 */

import { sendBark } from './notifier.js';
import { LEADERBOARD_KEY } from './triage-officer-rank.js';

/** 触发小时（UTC）= 北京时间 08:30 */
const TRIGGER_HOUR_UTC = 0;
/** 触发分钟（UTC）*/
const TRIGGER_MINUTE_UTC = 30;
/** 触发窗口 ±5 分钟 */
const WINDOW_MINUTES = 5;

const DASHBOARD_URL = 'http://localhost:5174/';
const SENTINEL_KEY = 'morning-cockpit-bark';

/**
 * 判断当前时间是否在晨报触发窗口内（北京 08:25–08:35）。
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInMorningCockpitWindow(now = new Date()) {
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const totalMin = utcH * 60 + utcM;
  const targetMin = TRIGGER_HOUR_UTC * 60 + TRIGGER_MINUTE_UTC;
  return Math.abs(totalMin - targetMin) <= WINDOW_MINUTES;
}

/**
 * 当日去重检查（working_memory sentinel）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>} true = 今日已推送，跳过
 */
async function alreadySentToday(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
      [SENTINEL_KEY],
    );
    if (!rows.length) return false;
    const record = rows[0].value_json;
    const sentAt = record?.sent_at;
    if (!sentAt) return false;
    const diff = Date.now() - new Date(sentAt).getTime();
    // 20 小时内视为当日已推送
    return diff < 20 * 60 * 60 * 1000;
  } catch (e) {
    console.warn('[morning-cockpit-bark] sentinel read failed:', e.message);
    return false;
  }
}

/**
 * 写入 sentinel（已推送记录）。
 * @param {import('pg').Pool} pool
 */
async function writeSentinel(pool) {
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [SENTINEL_KEY, JSON.stringify({ sent_at: new Date().toISOString() })],
    );
  } catch (e) {
    console.warn('[morning-cockpit-bark] sentinel write failed:', e.message);
  }
}

/**
 * 读取排序官榜单（best-effort，失败降级 null）
 * @param {import('pg').Pool} pool
 * @returns {Promise<{leaderboard: Array, budget: object, veto_deadline: string, anomaly_lines: string[]} | null>}
 */
async function fetchTriageLeaderboard(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
      [LEADERBOARD_KEY],
    );
    if (!rows.length) return null;
    const record = rows[0].value_json;
    if (!record?.leaderboard?.length) return null;
    const generatedAt = record.generated_at ? new Date(record.generated_at) : null;
    // 超过 20h 的榜单不展示
    if (generatedAt && (Date.now() - generatedAt.getTime()) > 20 * 60 * 60 * 1000) return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * 格式化否决截止时间（北京时间 HH:mm）
 */
function fmtVetoDeadline(isoStr) {
  if (!isoStr) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoStr));
  } catch {
    return '';
  }
}

/**
 * 采集简报数据：完成率 + 在途任务数。
 * @param {import('pg').Pool} pool
 * @returns {Promise<{completionRate: string, inProgressCount: number}>}
 */
async function buildBriefData(pool) {
  try {
    const [statsRow, taskRow] = await Promise.allSettled([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) AS total
         FROM harness_pipelines
         WHERE created_at >= NOW() - INTERVAL '30 days'`
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'in_progress'`
      ),
    ]);

    let completionRate = '--';
    if (statsRow.status === 'fulfilled') {
      const r = statsRow.value.rows[0];
      const total = parseInt(r?.total ?? '0', 10);
      const completed = parseInt(r?.completed ?? '0', 10);
      if (total > 0) {
        completionRate = `${Math.round((completed / total) * 100)}%`;
      }
    }

    let inProgressCount = 0;
    if (taskRow.status === 'fulfilled') {
      inProgressCount = parseInt(taskRow.value.rows[0]?.cnt ?? '0', 10);
    }

    return { completionRate, inProgressCount };
  } catch (e) {
    console.warn('[morning-cockpit-bark] brief data fetch failed:', e.message);
    return { completionRate: '--', inProgressCount: 0 };
  }
}

/**
 * 晨报 Bark 推送主函数（由 scheduler-jobs.js 轮询调用）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<{skipped?: boolean, reason?: string, sent?: boolean}>}
 */
export async function runMorningCockpitBark(pool) {
  // 1. 时间窗口 gate
  if (!isInMorningCockpitWindow()) {
    return { skipped: true, reason: 'outside_window' };
  }

  // 2. 当日去重 gate
  const alreadySent = await alreadySentToday(pool);
  if (alreadySent) {
    console.log('[morning-cockpit-bark] 今日已推送，跳过');
    return { skipped: true, reason: 'already_sent_today' };
  }

  // 3. 采集简报数据 + 榜单（并行，榜单 best-effort）
  const [{ completionRate, inProgressCount }, triageBoard] = await Promise.all([
    buildBriefData(pool),
    fetchTriageLeaderboard(pool),
  ]);

  // 4. 构造推送内容
  const title = '☀️ 主理人指挥舱晨报';
  const lines = [
    `完成率 ${completionRate}｜进行中 ${inProgressCount} 个任务`,
  ];

  if (triageBoard?.leaderboard?.length) {
    const topItems = triageBoard.leaderboard.slice(0, 3);
    lines.push(`今日排序官 Top${triageBoard.budget?.top_n ?? topItems.length}：`);
    topItems.forEach((item) => {
      lines.push(`  ${item.rank}. [${item.priority}] ${item.title.slice(0, 30)}`);
    });
    const anomaly = (triageBoard.anomaly_lines ?? []);
    if (anomaly.length) {
      lines.push(`⚠️ 烧率异常线：${anomaly.join('、')}`);
    }
    const vetoTime = fmtVetoDeadline(triageBoard.veto_deadline);
    if (vetoTime) lines.push(`否决窗至 ${vetoTime}，逾时自动放行`);
  }

  lines.push(`点击进入指挥舱 → ${DASHBOARD_URL}`);
  const body = lines.join('\n');

  // 5. 发送 Bark（复用 notifier.js sendBark，dedupeKey 二重去重）
  const dedupeKey = `morning-cockpit-bark:${new Date().toISOString().slice(0, 10)}`;
  const sent = await sendBark(title, body, {
    dedupeKey,
    dedupeTtlSec: 20 * 60 * 60,
  });

  // 6. 写入 sentinel（无论 Bark 是否 token 可用，避免重复调 API）
  await writeSentinel(pool);

  console.log(`[morning-cockpit-bark] 推送完成 sent=${sent} board_items=${triageBoard?.leaderboard?.length ?? 0}`);
  return { sent: true, completionRate, inProgressCount, triage_items: triageBoard?.leaderboard?.length ?? 0 };
}
