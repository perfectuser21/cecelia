/**
 * cleanup-worker-plugin.js — Brain v2 Phase D1.7c
 *
 * 把 tick-runner.js 中 inline 的 [R4] Orphan worktree 清理段落抽出。
 * 每 10 分钟调用一次 cleanup-worker.js（旧的薄壳，不动），
 * 旧文件保留：它包装 shell 脚本（cleanup-merged-worktrees.sh）的 exec，
 * 本 plugin 在它之上加节流门 + tickState 计时 + 日志统计。
 *
 * 节流门：CLEANUP_WORKER_INTERVAL_MS（默认 10min，env 可覆盖）
 * MINIMAL_MODE → 跳过
 */

const CLEANUP_WORKER_INTERVAL_MS = parseInt(
  process.env.CECELIA_CLEANUP_WORKER_INTERVAL_MS || String(10 * 60 * 1000),
  10
);

/**
 * @param {{
 *   tickState: { lastCleanupWorkerTime: number },
 *   tickLog?: (...args: any[]) => void,
 *   MINIMAL_MODE?: boolean,
 *   intervalMs?: number,
 *   loadWorker?: () => Promise<{ runCleanupWorker: (opts?: object) => Promise<any> }>,
 * }} ctx
 */
export async function tick({ tickState, tickLog, MINIMAL_MODE = false, intervalMs, loadWorker } = {}) {
  if (!tickState) throw new Error('cleanup-worker-plugin: tickState required');
  if (MINIMAL_MODE) return { skipped: true, reason: 'minimal_mode' };

  const interval = intervalMs ?? CLEANUP_WORKER_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastCleanupWorkerTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastCleanupWorkerTime = Date.now();

  try {
    let runCleanupWorker;
    if (loadWorker) {
      const mod = await loadWorker();
      runCleanupWorker = mod.runCleanupWorker;
    } else {
      const mod = await import('./cleanup-worker.js');
      runCleanupWorker = mod.runCleanupWorker;
    }
    const r = await runCleanupWorker();
    if (r?.stdout) {
      const lines = r.stdout.split('\n').filter(Boolean);
      const cleaned = lines.filter(l => l.includes('[cleanup] removed')).length;
      if (cleaned > 0) {
        tickLog?.(`[tick] cleanup-worker: cleaned=${cleaned} lines=${lines.length}`);
      }
    }
    if (!r?.success && r?.error) {
      console.warn('[tick] cleanup-worker failed (non-fatal):', r.error);
    }
    return r;
  } catch (err) {
    console.warn('[tick] cleanup-worker threw (non-fatal):', err.message);
    return { error: err.message };
  }
}

export default { tick };
