/**
 * spawn — Brain v2 三层架构 Layer 3（Executor）的唯一对外 API。
 *
 * 详见 docs/design/brain-orchestrator-v2.md §5 + ./README.md。
 *
 * Phase A（v2 P2.5 收尾）：启用真 attempt-loop。每次 iteration 跑 executeInDocker
 * （内部已接 resolveCascade / resolveAccount / runDocker / cap-marking / billing），
 * 失败后调 classifyFailure + shouldRetry 判定是否进入下一轮。
 *
 * 换号策略说明：transient 失败后**不主动删** opts.env.CECELIA_CREDENTIALS。
 * cap 场景由 cap-marking（内层 middleware）标记 → next attempt 的 resolveAccount
 * 读 isSpendingCapped → 自动换号；non-cap transient（网络/超时）保留同账号
 * 就地重试更合理。spawn 层只做循环控制，"用哪号"交 account-rotation 自判。
 *
 * MAX_ATTEMPTS=3 与 dispatch 层 failure_count 独立，最坏 3×3=9 次外层 retry。
 * 如需调整，统一改本常量。
 *
 * @param {object} opts
 * @param {object} opts.task        { id, task_type, ... }
 * @param {string} opts.skill       skill slash-command（如 '/harness-planner'）
 * @param {string} opts.prompt      agent 初始 prompt
 * @param {object} [opts.env]       显式 env
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cascade]   模型降级链 override
 * @param {object} [opts.worktree]  { path, branch }
 *
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, ... }>}
 */
import { executeInDocker } from '../docker-executor.js';
import { classifyFailure, shouldRetry } from './middleware/retry-circuit.js';

export const SPAWN_MAX_ATTEMPTS = 3;

export async function spawn(opts) {
  let lastResult = null;
  for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
    const result = await executeInDocker(opts);
    lastResult = result;
    const cls = classifyFailure(result);
    if (cls.class === 'success') return result;
    if (cls.class === 'permanent') return result;
    if (!shouldRetry(cls, attempt, SPAWN_MAX_ATTEMPTS)) return result;
  }
  return lastResult;
}
