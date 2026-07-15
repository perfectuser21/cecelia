/**
 * spawn — Brain v2 三层架构 Layer 3（Executor）的唯一对外 API。
 *
 * 详见 docs/design/brain-orchestrator-v2.md §5 + ./README.md。
 *
 * 两层洋葱执行链：
 *
 *   外层（Koa next() 风格）：
 *     cost-cap (pre)  → 预算守卫，超 budget 抛 CostCapExceededError 拒绝 spawn
 *     spawn-pre (pre) → 写 prompt 文件 / 准备 cidfile
 *     logging   (pre) → 打 [spawn] start log
 *     ─── inner attempt-loop ───
 *     logging   (post)→ 打 [spawn] end log
 *     billing   (post)→ 把账号 / cost 写回 task.payload.dispatched_account
 *
 *   内层 attempt-loop（for 循环 × MAX_ATTEMPTS）：
 *     a. account-rotation → 选合适账号（capped/auth-failed fallback）
 *     b. cascade          → 填充模型降级链（haiku/sonnet/opus/minimax）
 *     c. resource-tier    → 选 docker memory/cpu tier
 *     d. docker-run       → 实际 child_process.spawn('docker', args)
 *     e. cap-marking      → 检测 429 / spending cap → 标记账号
 *     f. retry-circuit    → classifyFailure + shouldRetry 决定是否进入下一轮
 *
 *   注：当前 docker-executor.js 已把内层 a-e 串好，spawn.js 通过 executeInDocker 间接调用；
 *   retry-circuit 由本文件的 attemptLoop 显式调度（classifyFailure + shouldRetry）。
 *
 * SPAWN_V2_ENABLED（默认 true）：
 *   - true 或未设：走完整两层洋葱链
 *   - 'false' / '0'：回滚开关，跳过所有外层 middleware，仅保留 attempt-loop 调
 *     executeInDocker 的旧行为（兼容老调用方）。出事可即时回滚。
 *
 * 换号策略：transient 失败后 spawn 层**不主动删** opts.env.CECELIA_CREDENTIALS。
 * cap 场景由 cap-marking（内层）标记 → next attempt 的 resolveAccount 读
 * isSpendingCapped 自动换号；non-cap transient 保留同账号就地重试。
 *
 * @param {object} opts
 * @param {object} opts.task        { id, task_type, ... }
 * @param {string} opts.skill       skill slash-command（如 '/harness-planner'）
 * @param {string} opts.prompt      agent 初始 prompt
 * @param {object} [opts.env]       显式 env
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cascade]   模型降级链 override
 * @param {object} [opts.worktree]  { path, branch }
 * @param {object} [ctx]            外层 middleware 共享 context（deps 注入用）
 *
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, ... }>}
 */
import { executeInDocker } from '../docker-executor.js';
import { executeOnHost } from './host-executor.js';
import { classifyFailure, shouldRetry } from './middleware/retry-circuit.js';
import { checkCostCap } from './middleware/cost-cap.js';
import { preparePromptAndCidfile } from './middleware/spawn-pre.js';
import { createSpawnLogger } from './middleware/logging.js';
import { recordBilling } from './middleware/billing.js';

export const SPAWN_MAX_ATTEMPTS = 3;

function isSpawnV2Enabled() {
  const v = process.env.SPAWN_V2_ENABLED;
  return !(v === 'false' || v === '0');
}

async function attemptLoop(opts) {
  // mac_web 任务：Claude 必须在宿主 Mac 上跑（真实浏览器 + localhost:5174）。
  // Brain 在容器内，直接 spawn('claude') → ENOENT。host-executor 处理 SSH 逃逸。
  if (opts.task?.payload?.target_environment === 'mac_web') {
    return executeOnHost(opts);
  }

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

export async function spawn(opts, ctx = {}) {
  if (!isSpawnV2Enabled()) {
    return attemptLoop(opts);
  }

  await checkCostCap(opts, ctx);
  preparePromptAndCidfile(opts, ctx);
  const logger = createSpawnLogger(opts, ctx);
  logger.logStart();

  const result = await attemptLoop(opts);

  logger.logEnd(result);
  await recordBilling(result, opts, ctx);

  return result;
}
