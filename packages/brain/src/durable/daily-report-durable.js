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
 *
 * 复用而非重写：所有数据查询 / 生成 / 存库逻辑直接 import daily-report-generator.js 导出
 * 的 step 函数；发飞书默认复用 notifier.js 的 sendFeishu（测试中可注入 mock 计数器）。
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  getYesterdayString,
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
};

/**
 * 注入 durable workflow 的运行时依赖。必须在 DBOS.launch() 之前调用。
 * @param {object} deps
 * @param {import('pg').Pool} [deps.pool]
 * @param {(text: string) => Promise<any>} [deps.sendFeishu]
 * @param {(step: string) => Promise<void>} [deps.trace]
 */
export function configureDurableDeps(deps = {}) {
  if (deps.pool) _deps.pool = deps.pool;
  if (deps.sendFeishu) _deps.sendFeishu = deps.sendFeishu;
  if (deps.trace) _deps.trace = deps.trace;
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
    // 测试钩子（仅当 DBOS_TEST_CRASH_BEFORE_SAVE=1）：在 save/feishu 之前硬崩溃，
    // 用于验证 recover 后 generate 等已完成 step 不重跑、feishu exactly-once。
    // 生产环境 env 不设 → no-op，零影响。
    if (process.env.DBOS_TEST_CRASH_BEFORE_SAVE === '1') {
      // eslint-disable-next-line no-console
      console.log(`[durable-test] CRASH before saveReport (pid ${process.pid})`);
      process.exit(137);
    }
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
 * 与原 generateDailyReport(pool) 调用形态对齐（接受 pool）。
 * 注意：DBOS 必须已 launch（server.js initDurable）；deps 在 launch 前已注入默认或自定义。
 *
 * @param {import('pg').Pool} [dbPool] - 业务查询连接池（默认 brain pool）
 * @param {Date} [now] - 当前时间（默认 new Date()）
 * @returns {Promise<{generated: boolean, date: string}>}
 */
export async function durableDailyReport(dbPool, now = new Date()) {
  if (dbPool) _deps.pool = dbPool;
  const today = toDateString(now);
  const yesterday = getYesterdayString(now);
  return durableDailyReportWorkflow({ today, yesterday });
}
