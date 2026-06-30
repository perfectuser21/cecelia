/**
 * evolution-scanner-loop.js — 独立进化扫描循环（接回 live tick）。
 *
 * 根因（2026-06-30 审计）：PR #3469 把 scanEvolutionIfNeeded 移进 executeTick()，
 * 但 executeTick() 自 Wave 2（2026-05-04）起从不被调用（tick-loop.js 改调 runScheduler()）。
 * scanner 自 2026-06-18 不再运行，probe=PROBE_FAIL_EVOLUTION(scanner_stale)。
 *
 * 修复：仿 recovery-loop / harness-watchdog-loop / pipeline-patrol-loop 接回独立 setInterval，
 * 不依赖 runScheduler 跑完（不被 circuit_open / no_goals 早 return 跳过）。
 * scanEvolutionIfNeeded 内部有每日门控（working_memory.evolution_last_scan_date），
 * 扫描间隔 30 分钟即可（门控保证每天最多扫一次，不会轰炸 GitHub API）。
 */

import pool from './db.js';

const SCAN_INTERVAL_MS = Number(process.env.CECELIA_EVOLUTION_SCAN_INTERVAL_MS) || 30 * 60 * 1000; // 默认 30 分钟

let _loopTimer = null;
let _isRunning = false;

/**
 * 跑一次进化扫描（日志扫描 + 每周叙事合成）。
 * 两条彼此独立 try/catch，一条失败不拖累另一条。
 * @param {{ pool?: any, scanEvolutionIfNeeded?: Function, synthesizeEvolutionIfNeeded?: Function }} [opts]
 */
export async function runEvolutionScanOnce(opts = {}) {
  const dbPool = opts.pool || pool;
  let scanResult = null;
  let synthResult = null;

  try {
    const fn = opts.scanEvolutionIfNeeded
      || (await import('./evolution-scanner.js')).scanEvolutionIfNeeded;
    scanResult = await fn(dbPool);
  } catch (err) {
    console.warn(`[evolution-scanner-loop] scanEvolutionIfNeeded failed (non-fatal): ${err.message}`);
  }

  try {
    const fn = opts.synthesizeEvolutionIfNeeded
      || (await import('./evolution-scanner.js')).synthesizeEvolutionIfNeeded;
    synthResult = await fn(dbPool);
  } catch (err) {
    console.warn(`[evolution-scanner-loop] synthesizeEvolutionIfNeeded failed (non-fatal): ${err.message}`);
  }

  const scanSkipped = scanResult?.skipped || null;
  const synthSkipped = synthResult?.skipped || null;

  console.log(
    `[evolution-scanner-loop] scan=${scanSkipped ?? (scanResult?.ok === false ? 'error' : 'ran')}` +
    ` synth=${synthSkipped ?? (synthResult?.ok === false ? 'error' : 'ran')}`
  );

  return { scanResult, synthResult };
}

/**
 * 启动独立进化扫描循环（默认每 30 分钟，env CECELIA_EVOLUTION_SCAN_INTERVAL_MS 可覆盖）。
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} false=已在运行
 */
export function startEvolutionScannerLoop({ intervalMs = SCAN_INTERVAL_MS } = {}) {
  if (_loopTimer) {
    console.log('[evolution-scanner-loop] 循环已在运行，跳过重复启动');
    return false;
  }

  _loopTimer = setInterval(async () => {
    if (_isRunning) {
      console.warn('[evolution-scanner-loop] 上次扫描未完成，跳过本次');
      return;
    }
    _isRunning = true;
    try {
      await runEvolutionScanOnce();
    } catch (err) {
      console.warn(`[evolution-scanner-loop] loop tick failed (non-fatal): ${err.message}`);
    } finally {
      _isRunning = false;
    }
  }, intervalMs);

  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[evolution-scanner-loop] 独立进化扫描循环已启动（间隔 ${Math.round(intervalMs / 60000)} 分钟）`);
  return true;
}

/** 停止进化扫描循环（测试用 / 关闭用）。 */
export function stopEvolutionScannerLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
  _isRunning = false;
}

export default {
  runEvolutionScanOnce,
  startEvolutionScannerLoop,
  stopEvolutionScannerLoop,
};
