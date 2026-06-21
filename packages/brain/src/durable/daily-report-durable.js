/**
 * daily-report-durable.js
 *
 * daily-report 的 durable 版本：把既有 step 函数（从 daily-report-generator.js 复用，
 * 零重写）各包一层 DBOS.registerStep，组合成 DBOS.registerWorkflow。
 *
 * 崩溃恢复语义：workflow 任意步崩溃 → 重启 DBOS.launch() 自动 recover → 从断点续，
 * 已完成的 step 不重跑（结果从 dbos schema 读回），sendFeishu 等副作用 exactly-once。
 *
 * ⚠️ DBOS 约束（已实测）：registerStep / registerWorkflow 必须在 DBOS.launch() **之前**
 * 完成。因此本模块在加载时（module top-level）一次性注册 step/workflow；运行时依赖
 * （pool / sendFeishu / trace）通过 configureDurableDeps() 在 launch 前注入到模块级 holder，
 * step body 从 holder 取。日期等可序列化参数作为 workflow 入参传入。
 * 生产入口（dbos-runtime.js）**静态 import 本模块**，保证注册早于 launch（见 C1 修复）。
 *
 * 触发窗口 + 今日去重守卫（C2）：durableDailyReport 在调 workflow 之前复用原
 * isInReportTriggerWindow + hasTodayReport，行为对齐原 generateDailyReport——
 * 窗口外 / 今日已生成则直接返回 {generated:false}，不发飞书。
 *
 * 复用而非重写：所有数据查询 / 生成 / 存库逻辑直接 import daily-report-generator.js 导出
 * 的 step 函数；发飞书默认复用 notifier.js 的 sendFeishu（测试中可注入 mock 计数器）。
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  isInReportTriggerWindow,
  getYesterdayString,
  hasTodayReport,
  fetchYesterdayContentOutput,
  fetchYesterdayPublishStats,
  fetchYesterdayEngagementData,
  fetchYesterdayFailureCount,
  buildReportText,
  saveReportToWorkingMemory,
  markTodayDone,
} from '../daily-report-generator.js';
import { sendFeishu as defaultSendFeishu } from '../notifier.js';
import pool from '../db.js';

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

// ── 模块级依赖 holder（launch 前注入；step body 从此取，使注册可在 launch 前完成） ──
const _deps = {
  pool, // 默认指向 brain db.js 的 pool
  sendFeishu: defaultSendFeishu,
  trace: async () => {}, // 测试钩子，默认 no-op
  // I1：崩溃注入 seam（默认 no-op）。测试注入后在 saveReport 之前触发崩溃，
  // 取代曾经烤进 step body 的 process.exit(137)。生产永不设置。
  beforeSave: async () => {},
};

/**
 * 注入 durable workflow 的运行时依赖。必须在 DBOS.launch() 之前调用。
 * @param {object} deps
 * @param {import('pg').Pool} [deps.pool]
 * @param {(text: string) => Promise<any>} [deps.sendFeishu]
 * @param {(step: string) => Promise<void>} [deps.trace]
 * @param {() => Promise<void>} [deps.beforeSave] - 测试崩溃 seam（仅非生产）
 */
export function configureDurableDeps(deps = {}) {
  if (deps.pool) _deps.pool = deps.pool;
  if (deps.sendFeishu) _deps.sendFeishu = deps.sendFeishu;
  if (deps.trace) _deps.trace = deps.trace;
  // beforeSave 仅在非 production 允许注入（I1 守卫）
  if (deps.beforeSave && process.env.NODE_ENV !== 'production') {
    _deps.beforeSave = deps.beforeSave;
  }
}

// ── 注册 step（module load 时一次性，早于 launch） ──
const stepFetchContent = DBOS.registerStep(
  async (yesterday) => { await _deps.trace('fetchContentOutput'); return fetchYesterdayContentOutput(_deps.pool, yesterday); },
  { name: 'fetchContentOutput' }
);
const stepFetchPublish = DBOS.registerStep(
  async (yesterday) => { await _deps.trace('fetchPublishStats'); return fetchYesterdayPublishStats(_deps.pool, yesterday); },
  { name: 'fetchPublishStats' }
);
const stepFetchEngagement = DBOS.registerStep(
  async (yesterday) => { await _deps.trace('fetchEngagement'); return fetchYesterdayEngagementData(_deps.pool, yesterday); },
  { name: 'fetchEngagement' }
);
const stepFetchFailure = DBOS.registerStep(
  async (yesterday) => { await _deps.trace('fetchFailureCount'); return fetchYesterdayFailureCount(_deps.pool, yesterday); },
  { name: 'fetchFailureCount' }
);
const stepGenerate = DBOS.registerStep(
  async ({ today, yesterday, contentOutput, publishStats, engagementData, failureCount }) => {
    await _deps.trace('generateReport');
    return buildReportText(today, yesterday, contentOutput, publishStats, engagementData, failureCount);
  },
  { name: 'generateReport' }
);
const stepSave = DBOS.registerStep(
  async ({ today, reportText }) => {
    // I1：崩溃通过 _deps.beforeSave seam 注入（测试态才非 no-op）；shipped body 里没有 process.exit。
    await _deps.beforeSave();
    await saveReportToWorkingMemory(_deps.pool, today, reportText);
    await markTodayDone(_deps.pool, today);
  },
  { name: 'saveReport' }
);
const stepSendFeishu = DBOS.registerStep(
  async (reportText) => { await _deps.sendFeishu(reportText); },
  { name: 'sendFeishu' }
);

// ── 注册 workflow（module load 时一次性，早于 launch；日期作为可序列化入参） ──
export const durableDailyReportWorkflow = DBOS.registerWorkflow(
  async ({ today, yesterday }) => {
    const contentOutput = await stepFetchContent(yesterday);
    const publishStats = await stepFetchPublish(yesterday);
    const engagementData = await stepFetchEngagement(yesterday);
    const failureCount = await stepFetchFailure(yesterday);
    const reportText = await stepGenerate({ today, yesterday, contentOutput, publishStats, engagementData, failureCount });
    await stepSave({ today, reportText });
    await stepSendFeishu(reportText);
    return { generated: true, date: today };
  },
  { name: 'durableDailyReport' }
);

/**
 * tick-runner 接线入口：运行 durable daily-report workflow。
 * 与原 generateDailyReport(pool, now) 调用形态对齐（接受 pool + now），并复用同样的
 * 触发窗口 + 今日去重守卫，返回同样形状 {generated, date, skipped_window, skipped_dup}。
 *
 * 注意：DBOS 必须已 launch（server.js initDurable）；deps 在 launch 前已注入默认或自定义。
 *
 * @param {import('pg').Pool} [dbPool] - 业务查询连接池（默认 brain pool）
 * @param {Date} [now] - 当前时间（默认 new Date()）
 * @param {object} [deps] - 测试注入 _runWorkflow / _hasTodayReport（生产留空走真实）
 * @returns {Promise<{generated: boolean, date: string, skipped_window: boolean, skipped_dup: boolean}>}
 */
export async function durableDailyReport(dbPool, now = new Date(), deps = {}) {
  if (dbPool) _deps.pool = dbPool;
  const runWorkflow = deps._runWorkflow || durableDailyReportWorkflow;
  const checkHasReport = deps._hasTodayReport || hasTodayReport;

  // C2 守卫 1：触发窗口（UTC 01:00 ± 5min）
  if (!isInReportTriggerWindow(now)) {
    return { generated: false, date: toDateString(now), skipped_window: true, skipped_dup: false };
  }

  const today = toDateString(now);
  const yesterday = getYesterdayString(now);

  // C2 守卫 2：今日去重（同一天重复触发只执行一次）
  if (await checkHasReport(_deps.pool, today)) {
    return { generated: false, date: today, skipped_window: false, skipped_dup: true };
  }

  const result = await runWorkflow({ today, yesterday });
  return {
    generated: result?.generated ?? true,
    date: result?.date ?? today,
    skipped_window: false,
    skipped_dup: false,
  };
}
