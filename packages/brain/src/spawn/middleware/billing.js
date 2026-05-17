/**
 * billing middleware — Brain v2 Layer 3 外层（Koa 洋葱）的归账步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：spawn 结束后把 "哪个账号跑的" 写到 tasks.payload.dispatched_account，
 * 方便后续熔断分析和成本追溯。当前 executor.js:3083 已做类似事，本 middleware 统一到 spawn 层。
 *
 * v2 P2 PR 9（本 PR）：建立模块 + 单测，暂不接线 executeInDocker。
 * 未来外层整合 PR 在 runDocker 返回后调 recordBilling。
 *
 * @param {object} result  runDocker 返回
 * @param {object} opts    executeInDocker 输入 { task, env }
 * @param {object} ctx     { deps? } — 测试注入 { updateTaskPayload }
 * @returns {Promise<{ recorded: boolean, account: string|null }>}
 */
export async function recordBilling(result, opts, ctx = {}) {
  const taskId = opts?.task?.id;
  const account = opts?.env?.CECELIA_CREDENTIALS || null;
  if (!taskId || !account) {
    return { recorded: false, account };
  }
  const payload = {
    dispatched_account: account,
    dispatched_model: opts?.env?.CECELIA_MODEL || null,
    dispatched_at: new Date().toISOString(),
    exit_code: result?.exit_code,
    duration_ms: result?.duration_ms,
    cost_usd: result?.cost_usd,
  };
  try {
    const updateFn = ctx.deps?.updateTaskPayload;
    if (!updateFn) {
      // 无 deps 视为纯日志路径，跳过 DB 写入
      return { recorded: false, account };
    }
    await updateFn(taskId, payload);
    return { recorded: true, account };
  } catch (err) {
    console.warn(`[billing] failed to record ${taskId}: ${err.message}`);
    return { recorded: false, account };
  }
}
