/**
 * spawn — Brain v2 三层架构 Layer 3（Executor）的唯一对外 API。
 *
 * 详见 docs/design/brain-orchestrator-v2.md §5 + ./README.md。
 *
 * v2 P2 PR 1（本 PR）：skeleton 阶段。当前实现只是 executeInDocker 的 1:1 wrapper，
 * 保证零行为改动。后续 PR 会在 SPAWN_V2_ENABLED=true 分支里接入 middleware 链
 * （外层 cost-cap / spawn-pre / logging / billing + 内层 attempt-loop 含
 * rotation × cascade × docker-run × cap-marking × retry）。
 *
 * @param {object} opts
 * @param {object} opts.task        { id, task_type, ... }
 * @param {string} opts.skill       skill slash-command（如 '/harness-planner'）
 * @param {string} opts.prompt      agent 初始 prompt
 * @param {object} [opts.env]       显式 env（现阶段全部透传给 executeInDocker）
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cascade]   模型降级链 override（PR 4 生效）
 * @param {object} [opts.worktree]  { path, branch }
 *
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, ... }>}
 */
import { executeInDocker } from '../docker-executor.js';

const SPAWN_V2_ENABLED = process.env.SPAWN_V2_ENABLED !== 'false';

export async function spawn(opts) {
  if (!SPAWN_V2_ENABLED) {
    return executeInDocker(opts);
  }
  return executeInDocker(opts);
}
