/**
 * logging middleware — Brain v2 Layer 3 外层（Koa 洋葱）统一 spawn 日志 + metric。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：spawn 入口打 "start" log，spawn 返回时打 "end" log（含 duration / exit_code /
 * account / model / cost_usd）。不做业务决策，纯观测。
 *
 * v2 P2 PR 8（本 PR）：建立模块 + 单测，暂不接线。attempt-loop 整合 PR 接入。
 *
 * @param {object} opts   { task, skill, env, ... }
 * @returns {{ logStart: () => void, logEnd: (result: object) => void }}
 */

export function createSpawnLogger(opts, ctx = {}) {
  const log = ctx.log || console.log;
  const taskId = opts?.task?.id || 'unknown';
  const taskType = opts?.task?.task_type || 'unknown';
  const skill = opts?.skill || 'unknown';
  const startedAt = Date.now();

  return {
    logStart() {
      log(`[spawn] start task=${taskId} type=${taskType} skill=${skill} account=${opts?.env?.CECELIA_CREDENTIALS || 'auto'}`);
    },
    logEnd(result) {
      const duration = Date.now() - startedAt;
      const exitCode = result?.exit_code;
      const account = opts?.env?.CECELIA_CREDENTIALS || result?.account_used || 'unknown';
      const model = opts?.env?.CECELIA_MODEL || result?.model_used || 'default';
      const cost = result?.cost_usd != null ? `$${result.cost_usd.toFixed(4)}` : 'n/a';
      log(`[spawn] end task=${taskId} exit=${exitCode} duration=${duration}ms account=${account} model=${model} cost=${cost}`);
    },
  };
}
