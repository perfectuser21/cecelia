/**
 * daily-report-generator.js
 *
 * 自动日报生成器。
 *
 * 每次 Tick 末尾调用 generateDailyReport()，内部判断是否到达每日触发时间（UTC 01:00 = 北京时间 09:00）。
 * 如果是，则汇总运行检查结果，保存日报并推送飞书。
 *
 * 触发窗口：UTC 01:00 - 01:05（北京时间 09:00 - 09:05）
 * 幂等机制：working_memory key='daily_report_triggered_{DATE}'
 * 日报存储：working_memory key='daily_report_{DATE}'
 */

import pool from './db.js';
import { sendFeishu } from './notifier.js';
import { findBareRuns } from './lib/task-run.js';
import { detectSkillBindingDrift, renderSkillBindingSection } from './lib/skill-binding-registry.js';
import { EXECUTOR_SKILL_MAP } from './lib/task-type-registry.js';
import { readSkillDistState, renderSkillDistSection } from './lib/skill-dist-report.js';
import { readRescanStalenessState, renderRescanStalenessSection } from './lib/rescan-staleness-report.js';
import { readAssertionRedState, renderAssertionRedSection } from './lib/assertion-red-report.js';
import { readMirrorDbState, renderMirrorDbSection } from './lib/mirror-db-report.js';

// 业务断言红灯板块（链 bf5088a3 棒4 消费）：与 renderBareRunSection 并列对外导出，渲染实现在 lib
// 单独一条 export（而非合并成一条）是因为 smoke/assertion-red-report-smoke.sh 对本行做精确字符串匹配
export { renderAssertionRedSection };
// 镜子库失联板块（决策 24a37029）
export { renderMirrorDbSection };

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 每日触发时间（UTC 小时）= 北京时间 09:00 */
const targetHour = 1; // UTC 01:00

/** 触发窗口分钟数 */
const TRIGGER_WINDOW_MINUTES = 5;

/** working_memory key 前缀：幂等触发记录 */
const WM_TRIGGER_KEY_PREFIX = 'daily_report_triggered_';

/** working_memory key 前缀：日报内容存储 */
const WM_REPORT_KEY_PREFIX = 'daily_report_';

// ─── 时间工具 ─────────────────────────────────────────────────────────────────

/**
 * 判断当前时间是否在日报触发窗口内（UTC 01:00 ± 5 分钟）。
 *
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {boolean}
 */
export function isInReportTriggerWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === targetHour && utcMinute < TRIGGER_WINDOW_MINUTES;
}

/**
 * 将 Date 转为 YYYY-MM-DD 字符串（UTC 日期）。
 *
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * 计算昨日 UTC 日期字符串。
 *
 * @param {Date} now
 * @returns {string}
 */
export function getYesterdayString(now) {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return toDateString(yesterday);
}

// ─── 幂等检查 ─────────────────────────────────────────────────────────────────

/**
 * 检查今天是否已经生成过日报。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} today - YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
export async function hasTodayReport(dbPool, today) {
  const key = WM_TRIGGER_KEY_PREFIX + today;
  const { rows } = await dbPool.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [key]
  );
  if (rows.length === 0) return false;
  return rows[0].value_json?.already_done === true;
}

/**
 * 记录今日已触发，防止重复生成。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} today - YYYY-MM-DD
 */
export async function markTodayDone(dbPool, today) {
  const key = WM_TRIGGER_KEY_PREFIX + today;
  const val = JSON.stringify({ already_done: true, triggered_at: new Date().toISOString() });
  await dbPool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, val]
  );
}

// ─── 数据查询 ─────────────────────────────────────────────────────────────────

/**
 * 裸跑检测板块（链 bf5088a3 棒1，需求④ 出口）：窗口内有 dispatch_events(dispatched)、
 * 却没有对应 task_runs 行的执行——run 原语漏接或写入失败，留痕缺口，标 🟡 AMBER。
 * 无裸跑返回不含 AMBER 标记的一行说明（不误报）。
 *
 * @param {Array<{task_id: string, dispatched_at?: string|Date}>} bareRuns findBareRuns 的返回
 * @returns {string}
 */
export function renderBareRunSection(bareRuns) {
  const list = Array.isArray(bareRuns) ? bareRuns : [];
  const lines = ['== 裸跑检测 =='];
  if (list.length === 0) {
    lines.push('无裸跑执行（每次派发都有对应 run 记录）。');
    return lines.join('\n');
  }
  lines.push(`🟡 AMBER 裸跑执行 ${list.length} 个（有 dispatch_events 无 task_runs，留痕缺口）：`);
  for (const r of list.slice(0, 20)) {
    const at = r.dispatched_at ? new Date(r.dispatched_at).toISOString() : '未知时间';
    lines.push(`  - 🟡 AMBER 裸跑 task_id=${r.task_id} 派发于 ${at}`);
  }
  if (list.length > 20) lines.push(`  …另有 ${list.length - 20} 个未列出`);
  return lines.join('\n');
}

/**
 * 生成 Brain 运行日报，汇总派发留痕、Skill 漂移、断言及镜子库检查。
 * @param {string} reportDate 日报日期
 * @param {string} yesterday 检查覆盖日期
 * @param {object} state 已采集的运行检查结果；不可用的检查为 null
 */
export function buildReportText(reportDate, yesterday, { bareRuns = null, skillDrift = null, skillDist = null, rescanStaleness = null, assertionRed = null, mirrorDb = null } = {}) {
  const lines = [`Cecelia Brain 运行日报 ${reportDate}`, `检查范围：${yesterday} 全天`, ''];

  // ── 板块五：裸跑检测（run 原语留痕缺口，AMBER）─────────────────────────────
  if (Array.isArray(bareRuns)) {
    lines.push(renderBareRunSection(bareRuns));
    lines.push('');
  }

  // ── 板块六：skill 绑定漂移（skill_registry 账本 vs 硬编码兜底，AMBER；链 bf5088a3 棒7）──
  if (skillDrift) {
    lines.push(renderSkillBindingSection(skillDrift));
    lines.push('');
  }

  // ── 板块七：skill 分发漂移（真身 vs 跑场机清单哈希，AMBER；链 bf5088a3 棒8）──
  if (skillDist) {
    lines.push(renderSkillDistSection(skillDist));
    lines.push('');
  }

  // ── 板块八：地图照相层 rescan 停滞哨兵（fact_snapshot_headers 账龄，AMBER；P0 9dfd873a 案）──
  if (rescanStaleness) {
    lines.push(renderRescanStalenessSection(rescanStaleness));
    lines.push('');
  }

  // ── 板块九：业务断言红灯（探针 24h FAIL 回执，RED/AMBER；链 bf5088a3 棒4 消费）──
  if (assertionRed) {
    lines.push(renderAssertionRedSection(assertionRed));
    lines.push('');
  }

  // ── 板块十：镜子库失联（守夜 A11 探活 in_trash/archived/404，RED；决策 24a37029）──
  if (mirrorDb) {
    lines.push(renderMirrorDbSection(mirrorDb));
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`由 Cecelia Brain 自动生成 · ${new Date().toISOString()}`);

  return lines.join('\n');
}

// ─── 日报写入 working_memory ──────────────────────────────────────────────────

/**
 * 将日报文本写入 working_memory，key 格式为 daily_report_{YYYY-MM-DD}。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} date - YYYY-MM-DD（日报日期，即今天）
 * @param {string} reportText
 */
export async function saveReportToWorkingMemory(dbPool, date, reportText) {
  const key = WM_REPORT_KEY_PREFIX + date;
  const val = JSON.stringify({ date, report: reportText, generated_at: new Date().toISOString() });
  await dbPool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, val]
  );
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/** 共享给普通路径与 durable step；不访问内容业务表。 */
export async function collectOperationalReportState(dbPool) {
  // 3.5 裸跑检测（run 原语）：查询失败降级为 null（不出该板块，不拖垮日报）
  const bareRuns = await findBareRuns(dbPool, { windowMinutes: 24 * 60 }).catch((err) => {
    console.warn(`[daily-report-generator] 裸跑检测失败（非阻断）: ${err.message}`);
    return null;
  });

  // 3.6 skill 绑定漂移检测：检测不可用（查询失败/列未迁移）返回 null，不出该板块
  const skillDrift = await detectSkillBindingDrift(dbPool, EXECUTOR_SKILL_MAP);

  // 3.7 skill 分发漂移（读 skill-dist-drift job 落在 working_memory 的结果）：无数据/读取失败返回 null，不出该板块
  const skillDist = await readSkillDistState(dbPool);

  // 3.8 地图照相层 rescan 停滞哨兵（读 rescan-staleness-patrol job 落在 working_memory 的结果）：无数据/读取失败返回 null，不出该板块
  const rescanStaleness = await readRescanStalenessState(dbPool);

  // 3.9 业务断言红灯（直查 journey_assertion_receipts 24h 探针 FAIL）：无 FAIL/查询失败返回 null，不出该板块
  const assertionRed = await readAssertionRedState(dbPool);

  // 3.10 镜子库失联（读 promise-map-nightly 落在 working_memory 的 A11 探活结果）：无失联/读取失败返回 null，不出该板块
  const mirrorDb = await readMirrorDbState(dbPool);

  return { bareRuns, skillDrift, skillDist, rescanStaleness, assertionRed, mirrorDb };
}

/**
 * 每日运行日报生成器。由 tick.js 在每次 Tick 末尾调用。
 *
 * @param {import('pg').Pool} [dbPool] - PostgreSQL 连接池（默认使用 db.js 的 pool）
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {Promise<{generated: boolean, date: string, skipped_window: boolean, skipped_dup: boolean}>}
 */
export async function generateDailyReport(dbPool = pool, now = new Date()) {
  // 1. 判断是否在触发窗口内（UTC 01:00 ± 5 分钟）
  if (!isInReportTriggerWindow(now)) {
    return { generated: false, date: toDateString(now), skipped_window: true, skipped_dup: false };
  }

  const today = toDateString(now);
  const yesterday = getYesterdayString(now);

  // 2. 幂等：今日是否已生成（同一天内重复触发只执行一次）
  if (await hasTodayReport(dbPool, today)) {
    return { generated: false, date: today, skipped_window: false, skipped_dup: true };
  }

  console.log(`[daily-report-generator] 开始生成 ${today} 日报，统计范围：${yesterday}`);

  try {
    const state = await collectOperationalReportState(dbPool);
    const reportText = buildReportText(today, yesterday, state);

    // 5. 写入 working_memory，key=daily_report_{YYYY-MM-DD}
    await saveReportToWorkingMemory(dbPool, today, reportText);

    // 6. 标记今日已完成（幂等锁，在推送前写入，避免推送失败导致重复生成）
    await markTodayDone(dbPool, today);

    // 7. 飞书推送（通过 notifier.js，不重复实现飞书推送逻辑；推送失败不影响幂等锁）
    await sendFeishu(reportText).catch(err => {
      console.error(`[daily-report-generator] 飞书推送失败（日报已存储）: ${err.message}`);
    });

    console.log(`[daily-report-generator] 日报生成并推送完成 (${today})`);
    return { generated: true, date: today, skipped_window: false, skipped_dup: false };
  } catch (err) {
    console.error(`[daily-report-generator] 日报生成失败: ${err.message}`);
    throw err;
  }
}
