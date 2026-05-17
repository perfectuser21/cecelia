/**
 * kr-progress-sync-plugin.js — Brain v2 Phase D1.7c-plugin1
 *
 * 抽出 tick-runner.js KR 进度验证段（原 §0.12 「KR 进度验证：每小时一次」）。
 *
 * 行为：
 *  - 节流：每 CLEANUP_INTERVAL_MS（默认 1h）一次，使用 tickState.lastKrProgressSyncTime
 *  - 优先 kr-verifier（基于外部数据源），fallback 到 kr-progress（数 initiative 完成率）
 *  - 失败非致命；任何异常吞掉打 console.error，不抛
 *  - 返回 { ran: boolean, actions: Array } —— actions 由 caller 推到 actionsTaken
 *
 * 设计说明：
 *  - tick-runner.js 旧 inline 段在 mark 时间戳之后即使内部抛错也不会重试，
 *    plugin 保留同样语义（先 mark 再 try）。
 *  - 不直接 push 进 actionsTaken（没传入），改返回数组让 caller 控制。
 */

const CLEANUP_INTERVAL_MS = parseInt(
  process.env.CECELIA_CLEANUP_INTERVAL_MS || String(60 * 60 * 1000),
  10
);

/**
 * Plugin tick: KR 进度同步（每小时一次）
 *
 * @param {Date} _now
 * @param {object} tickState - 必带 lastKrProgressSyncTime: number
 * @returns {Promise<{ran:boolean, actions:Array<object>}>}
 */
export async function tick(_now, tickState) {
  if (!tickState) return { ran: false, actions: [] };

  const elapsed = Date.now() - tickState.lastKrProgressSyncTime;
  if (elapsed < CLEANUP_INTERVAL_MS) {
    return { ran: false, actions: [] };
  }

  // mark 时间戳：保持与原 inline 行为一致（即使后续抛错也不重试）
  tickState.lastKrProgressSyncTime = Date.now();

  const actions = [];
  try {
    // 优先 kr-verifier（基于外部数据源，不可伪造）
    const { runAllVerifiers } = await import('./kr-verifier.js');
    const verifierResult = await runAllVerifiers();
    if (verifierResult.updated > 0) {
      console.log(
        `[TICK] KR 指标验证: ${verifierResult.updated} 个 KR 已更新（基于数据源）`
      );
      actions.push({
        action: 'kr_verifier_sync',
        updated_count: verifierResult.updated,
        errors: verifierResult.errors,
      });
    }

    // fallback：对没有 verifier 的 KR，用旧方式（数 initiative 完成率）
    const { default: pool } = await import('./db.js');
    const { syncAllKrProgress } = await import('./kr-progress.js');
    const krResult = await syncAllKrProgress(pool);
    if (krResult.updated > 0) {
      console.log(`[TICK] KR 进度同步（fallback）: ${krResult.updated} 个 KR 已更新`);
      actions.push({
        action: 'kr_progress_sync',
        updated_count: krResult.updated,
      });
    }
  } catch (krErr) {
    console.error('[tick] KR verifier/progress sync failed (non-fatal):', krErr.message);
  }

  return { ran: true, actions };
}

// 测试钩子：暴露常量用于 unit test
export const _CLEANUP_INTERVAL_MS = CLEANUP_INTERVAL_MS;
