/**
 * canary-drill-scheduler.js — A8-3 nightly 金丝雀演习定时器
 *
 * 在 tick loop 中，UTC 19:25~19:35 窗口触发（北京时间 03:25~03:35）
 * 幂等：同一日历日（UTC）只触发一次
 *
 * 导出：
 *   maybeScheduleCanaryDrill({ now?, execFn?, pool? }) — BEHAVIOR-8 接口（可注入依赖）
 *   runCanaryDrillIfNeeded() — tick-runner.js 调用的简化入口
 */
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(_execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 进程内幂等状态（正常 tick loop 中永远不跨日历日重置）
let lastDrillDate = null;

/**
 * 可注入依赖版本（供测试直接调用，BEHAVIOR-8）
 *
 * @param {{
 *   now?: Date,
 *   execFn?: Function,
 *   pool?: object
 * }} opts
 * @returns {Promise<{triggered: boolean, skipped?: boolean, reason?: string}>}
 */
export async function maybeScheduleCanaryDrill({ now = new Date(), execFn = null, pool = null } = {}) {
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();
  const todayUTC = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // UTC 19:25~19:35 窗口（北京时间 03:25~03:35）
  const inWindow = utcHour === 19 && utcMin >= 25 && utcMin <= 35;
  if (!inWindow) {
    return { triggered: false, skipped: true, reason: 'out_of_window' };
  }

  // 幂等：同日历日只触发一次（内存 + 可选 DB 双重保护）
  if (lastDrillDate === todayUTC) {
    return { triggered: false, skipped: true, reason: 'already_ran_today' };
  }

  // 可选：DB 层幂等检查（pool 注入时）
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM design_docs
         WHERE type = 'drill_report'
           AND created_at::date = $1
         LIMIT 1`,
        [todayUTC]
      );
      if (rows.length > 0) {
        lastDrillDate = todayUTC;
        return { triggered: false, skipped: true, reason: 'db_already_ran_today' };
      }
    } catch {
      // DB 查询失败不阻塞演习
    }
  }

  lastDrillDate = todayUTC;

  const drillScript = path.resolve(__dirname, '../../../scripts/canary-death-drill.mjs');
  const modes = ['oom', 'kill9', 'interactive_stuck'];
  // 按日期轮换 mode
  const dayIndex = Math.floor(now.getTime() / 86400000);
  const mode = modes[dayIndex % modes.length];

  console.log(`[canary-drill-scheduler] 触发 nightly 演习 mode=${mode} date=${todayUTC}`);

  const exec = execFn || (async (script, args) => {
    await execFileAsync('node', [script, ...args], {
      timeout: 20 * 60 * 1000,
      env: { ...process.env },
    });
  });

  try {
    await exec(drillScript, [mode]);
    console.log('[canary-drill-scheduler] 演习完成 PASS');
    return { triggered: true };
  } catch (e) {
    console.error('[canary-drill-scheduler] 演习失败:', e.message);
    // Bark 告警由 canary-death-drill.mjs 本身触发
    return { triggered: true, error: e.message };
  }
}

/**
 * 简化入口 — 供 tick-runner.js 调用
 */
export async function runCanaryDrillIfNeeded() {
  return maybeScheduleCanaryDrill();
}
