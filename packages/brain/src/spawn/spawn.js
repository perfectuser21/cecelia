/**
 * spawn — Brain v2 三层架构 Layer 3（Executor）的唯一对外 API。
 *
 * 详见 docs/design/brain-orchestrator-v2.md §5 + ./README.md。
 *
 * v2 P2 已完成（PR1-PR11，#2543-#2555）：9 个 middleware 全部建立在
 * packages/brain/src/spawn/middleware/：
 *   - 外层（Koa 洋葱）：cost-cap / spawn-pre / logging / billing
 *   - 内层（attempt-loop）：account-rotation / cascade / resource-tier /
 *     docker-run / cap-marking / retry-circuit
 * 目前 middleware 通过 executeInDocker 内部各点逐步接入（resolveCascade →
 * resolveAccount → runDocker）。attempt-loop 完整编排是后续整合 PR 的事。
 *
 * 本函数是进入 Layer 3 的正式 API，caller 不再直接 import executeInDocker。
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

export async function spawn(opts) {
  return executeInDocker(opts);
}
