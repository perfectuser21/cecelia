/**
 * kr-health-daily-plugin.js — Brain v2 Phase D1.7c
 *
 * 把 tick-runner.js 中 inline 的 [感知] KR 可信度日巡检段落抽出。
 * 每 24 小时一次，记录 warn/critical 状态供运维审计。
 *
 * 节流门：KR_HEALTH_INTERVAL_MS（默认 24h，env 可覆盖）
 *
 * 与原 inline 区别：
 *   - 原 inline 是 await 调用（kr-verifier dynamic import）→ tick 阻塞
 *   - 本 plugin 维持 await 语义（与 inline 一致），由 tick-runner 决定是否 await
 *
 * 返回值：成功时 { action: 'kr_health_check', summary, issues_count, issues }，
 * 供 tick-runner 决定是否 push 到 actionsTaken。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = parseInt(
  process.env.CECELIA_CLEANUP_INTERVAL_MS || String(60 * 60 * 1000),
  10
);
// 默认与原 inline 等价：CLEANUP_INTERVAL_MS * 24
const DEFAULT_INTERVAL_MS = CLEANUP_INTERVAL_MS * 24;

/**
 * @param {{
 *   tickState: { lastKrHealthDailyTime: number },
 *   tickLog?: (...args: any[]) => void,
 *   intervalMs?: number,
 *   loadHealth?: () => Promise<{ summary: object, verifiers: Array<{ health: string, kr_title: string, issues: string[] }> }>,
 * }} ctx
 */
export async function tick({ tickState, tickLog, intervalMs, loadHealth } = {}) {
  if (!tickState) throw new Error('kr-health-daily-plugin: tickState required');
  const interval = intervalMs ?? DEFAULT_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastKrHealthDailyTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastKrHealthDailyTime = Date.now();

  try {
    let getKrVerifierHealth = loadHealth;
    if (!getKrVerifierHealth) {
      const mod = await import('./kr-verifier.js');
      getKrVerifierHealth = mod.getKrVerifierHealth;
    }
    const healthResult = await getKrVerifierHealth();
    const { summary, verifiers: vList } = healthResult;
    tickLog?.(`[TICK] KR 可信度日巡检: healthy=${summary.healthy} warn=${summary.warn} critical=${summary.critical}`);
    const problematics = (vList || []).filter(v => v.health !== 'healthy');
    for (const v of problematics) {
      console.warn(`[TICK] KR 可信度问题 [${v.health.toUpperCase()}] "${v.kr_title}": issues=${(v.issues || []).join(',')}`);
    }
    return {
      action: 'kr_health_check',
      summary,
      issues_count: problematics.length,
      issues: problematics,
    };
  } catch (err) {
    console.error('[tick] KR health check failed (non-fatal):', err.message);
    return { error: err.message };
  }
}

export default { tick };
// export DAY_MS for test introspection
export { DAY_MS };
