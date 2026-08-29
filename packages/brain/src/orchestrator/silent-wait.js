/**
 * silent-wait.js —— 静默等待停摆检测（r80 run 5100560e 案卷，第 46 批）
 *
 * 控制循环的纯等待分支（人审去重等待 / wait:running / 基础设施退避 / Commander
 * 在途）只心跳不落行、无上限：r80 每 90s 照常续租却 4h39m 一行不写，监工 SQL、
 * watchdog、Commander 三层全瞎。本模块只回答一个问题：决策日志上一行距今多久。
 * 超过阈值由 loop 落 result:wait_stalled 行并发 run.wait_stalled 事件——停摆本身
 * 变成可观察、可唤醒 Commander 的事实，且每落一行计时归零（15 分钟一拍的心跳行）。
 */
export const SILENT_WAIT_STALL_MS = 15 * 60 * 1000;

function rowTimestampMs(row) {
  const raw = row?.created_at;
  if (raw == null) return null;
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @returns {{stalled:boolean, idle_ms:number|null, last_hop:number|null,
 *            last_action:string|null, last_row_at:string|null}}
 * 没有任何一行带 created_at（旧快照 / fake）→ 不判停摆，宁可漏报不误报。
 */
export function detectSilentWaitStall({
  decisionLog,
  now,
  thresholdMs = SILENT_WAIT_STALL_MS,
}) {
  let latest = null;
  let latestMs = null;
  for (const row of Array.isArray(decisionLog) ? decisionLog : []) {
    const ms = rowTimestampMs(row);
    if (ms == null) continue;
    if (latestMs == null || ms > latestMs || (ms === latestMs && Number(row.hop) > Number(latest?.hop))) {
      latest = row;
      latestMs = ms;
    }
  }
  if (latest == null) {
    return { stalled: false, idle_ms: null, last_hop: null, last_action: null, last_row_at: null };
  }
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const idleMs = Math.max(0, nowMs - latestMs);
  return {
    stalled: idleMs >= thresholdMs,
    idle_ms: idleMs,
    last_hop: Number.isFinite(Number(latest.hop)) ? Number(latest.hop) : null,
    last_action: typeof latest.action === 'string' ? latest.action : null,
    last_row_at: new Date(latestMs).toISOString(),
  };
}
