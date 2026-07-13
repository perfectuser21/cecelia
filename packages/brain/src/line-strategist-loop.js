/**
 * line-strategist-loop.js — 独立巡航循环（接回 live tick）。
 *
 * 根因：line-strategist 派发逻辑若像 pipeline-patrol 一样挂在 Wave-2 废弃的 executeTick 上，
 * runScheduler 迁移后从不调用，终态派发通道整条死代码。仿 pipeline-patrol-loop.js 用独立
 * setInterval 接回，不依赖 runScheduler 跑完。
 */

import pool from './db.js';
import { dispatchStrategistDecisions } from './line-strategist-dispatch.js';

const LINE_STRATEGIST_LOOP_INTERVAL_MS =
  Number(process.env.CECELIA_LINE_STRATEGIST_LOOP_INTERVAL_MS) || 10 * 60 * 1000; // 默认 10 分钟

let _loopTimer = null;
let _isRunning = false;

/**
 * 跑一次派发扫描。
 * @param {{ pool?: any, dispatchStrategistDecisions?: Function }} [opts]
 * @returns {Promise<{ scanned: number, dispatched: number, skipped_duplicate: number, marked: number }>}
 */
export async function runLineStrategistDispatchOnce(opts = {}) {
  const dbPool = opts.pool || pool;
  const fn = opts.dispatchStrategistDecisions || dispatchStrategistDecisions;

  try {
    const r = await fn(dbPool);
    console.log(`[line-strategist-loop] scanned=${r.scanned} dispatched=${r.dispatched} skipped_dup=${r.skipped_duplicate}`);
    return r;
  } catch (err) {
    console.warn(`[line-strategist-loop] dispatch failed (non-fatal): ${err.message}`);
    return { scanned: 0, dispatched: 0, skipped_duplicate: 0, marked: 0, error: err.message };
  }
}

/**
 * 启动独立巡航循环（默认每 10 分钟，env CECELIA_LINE_STRATEGIST_LOOP_INTERVAL_MS 可覆盖）。
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} false=已在运行
 */
export function startLineStrategistLoop({ intervalMs = LINE_STRATEGIST_LOOP_INTERVAL_MS } = {}) {
  if (_loopTimer) {
    console.log('[line-strategist-loop] 循环已在运行，跳过重复启动');
    return false;
  }

  _loopTimer = setInterval(async () => {
    if (_isRunning) {
      console.warn('[line-strategist-loop] 上次扫描未完成，跳过本次');
      return;
    }
    _isRunning = true;
    try {
      await runLineStrategistDispatchOnce();
    } catch (err) {
      console.warn(`[line-strategist-loop] loop tick failed (non-fatal): ${err.message}`);
    } finally {
      _isRunning = false;
    }
  }, intervalMs);

  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[line-strategist-loop] 独立巡航循环已启动（间隔 ${Math.round(intervalMs / 60000)} 分钟）`);
  return true;
}

/** 停止巡航循环（测试用 / 关闭用）。 */
export function stopLineStrategistLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
  _isRunning = false;
}

export default {
  runLineStrategistDispatchOnce,
  startLineStrategistLoop,
  stopLineStrategistLoop,
};
