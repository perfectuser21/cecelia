/**
 * account-rotation middleware — Brain v2 Layer 3 attempt-loop 内循环第 a 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2 + §5.3。
 *
 * 职责：根据 opts.env.CECELIA_CREDENTIALS（或空）+ cascade，选一个合适的账号，
 * 支持 capped/auth-failed fallback。**不**做模型降级（那是 cascade middleware 的事）。
 *
 * v2 P2 PR 3（本 PR）：纯代码搬家，从 docker-executor.js:368-395 抽出。
 * 接口和原 resolveAccountForOpts 完全一致。
 *
 * @param {object} opts  { env, cascade, task }
 * @param {object} ctx   { taskId?, deps? } — deps 用于测试注入
 * @returns {Promise<void>} — 原地修改 opts.env
 */
export async function resolveAccount(opts, ctx = {}) {
  opts.env = opts.env || {};
  try {
    const deps = ctx.deps || await import('../../account-usage.js');
    const { isSpendingCapped, isAuthFailed, selectBestAccount } = deps;
    const explicit = opts.env.CECELIA_CREDENTIALS;
    const capped = explicit ? isSpendingCapped(explicit) : false;
    const authFailed = explicit ? isAuthFailed(explicit) : false;
    const needsFallback = !explicit || capped || authFailed;
    if (!needsFallback) return;
    const selection = await selectBestAccount({ cascade: opts.cascade });
    if (!selection || !selection.accountId) return;
    const taskId = ctx.taskId || opts.task?.id || 'unknown';
    if (explicit && explicit !== selection.accountId) {
      const reason = capped ? 'spending-capped' : (authFailed ? 'auth-failed' : 'unset');
      console.log(`[account-rotation] rotate: ${explicit} ${reason} → ${selection.accountId} (task=${taskId})`);
    } else if (!explicit) {
      console.log(`[account-rotation] select: ${selection.accountId} model=${selection.model} (task=${taskId})`);
    }
    opts.env.CECELIA_CREDENTIALS = selection.accountId;
    if (selection.modelId && !opts.env.CLAUDE_MODEL_OVERRIDE) {
      opts.env.CECELIA_MODEL = selection.modelId;
    }
  } catch (err) {
    console.warn(`[account-rotation] middleware failed (keeping caller env): ${err.message}`);
  }
}
