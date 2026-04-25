/**
 * heartbeat-plugin.js — Brain v2 Phase D1.7c-plugin1
 *
 * 抽出 tick-runner.js HEARTBEAT.md 灵活巡检段（原 §0.13 「Heartbeat 巡检：每 30 分钟」）。
 *
 * 行为（与原 inline 严格等价）：
 *  - 节流：HEARTBEAT_INTERVAL_MS 由 heartbeat-inspector 模块决定（默认 30min）
 *  - **仅在成功后更新 tickState.lastHeartbeatTime**（失败下次 tick 立即重试）
 *  - 失败非致命：吞错打 console.error
 *  - 返回 { ran: boolean, actions: Array }
 *
 * 注意：原 inline 代码每个 tick 都 await import('./heartbeat-inspector.js')
 * 拿 HEARTBEAT_INTERVAL_MS 才判断时间窗口；这里复用同样模式，避免顶层 import
 * 引发的循环 / TDZ 问题。
 */

/**
 * Plugin tick: Heartbeat 灵活巡检（每 30min）
 *
 * @param {Date} _now
 * @param {object} tickState - 必带 lastHeartbeatTime: number
 * @returns {Promise<{ran:boolean, actions:Array<object>}>}
 */
export async function tick(_now, tickState) {
  if (!tickState) return { ran: false, actions: [] };

  // 动态 import：HEARTBEAT_INTERVAL_MS 在 heartbeat-inspector 中定义
  let HEARTBEAT_INTERVAL_MS;
  let runHeartbeatInspection;
  try {
    const mod = await import('./heartbeat-inspector.js');
    HEARTBEAT_INTERVAL_MS = mod.HEARTBEAT_INTERVAL_MS;
    runHeartbeatInspection = mod.runHeartbeatInspection;
  } catch (loadErr) {
    console.error('[tick] heartbeat-inspector load failed (non-fatal):', loadErr.message);
    return { ran: false, actions: [] };
  }

  const elapsed = Date.now() - tickState.lastHeartbeatTime;
  if (elapsed < HEARTBEAT_INTERVAL_MS) {
    return { ran: false, actions: [] };
  }

  const actions = [];
  try {
    const { default: pool } = await import('./db.js');
    const hbResult = await runHeartbeatInspection(pool);
    // 仅成功后更新（与原 inline 行为一致，失败下次 tick 立即重试）
    tickState.lastHeartbeatTime = Date.now();
    if (!hbResult.skipped && hbResult.actions_count > 0) {
      console.log(`[TICK] Heartbeat 巡检: ${hbResult.actions_count} 个行动`);
      actions.push({
        action: 'heartbeat_inspection',
        actions_count: hbResult.actions_count,
      });
    }
    return { ran: true, actions };
  } catch (hbErr) {
    console.error('[tick] Heartbeat inspection failed (non-fatal):', hbErr.message);
    // 不更新 lastHeartbeatTime，下次 tick 立即重试
    return { ran: true, actions };
  }
}
