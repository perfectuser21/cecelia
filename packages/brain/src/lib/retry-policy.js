/**
 * retry-policy — 失败分类重试策略 SSOT（查表）
 *
 * 消费方：quarantine.js getRetryStrategy()（task 级、分钟级 next_run_at 退避）。
 *
 * ⚠️ 显式豁免：src/spawn/middleware/retry-circuit.js 不消费本表。
 * 理由：retry-circuit 是 attempt 级零 sleep 进程内循环（spawn.js attemptLoop，
 * 同步重试 3 次立即返回），消费分钟级 backoff 数组会让 spawn 阻塞占 slot 几分钟。
 * 两层语义不同（attempt 级瞬态重试 vs task 级退避重排），不要来"统一"。
 */

const MIN = 60_000;

// 类别 → backoff 数组（第 N 次重试等待 backoffMs[N]）+ 重试上限
const RETRY_POLICY = {
  rate_limit:   { backoffMs: [2 * MIN, 4 * MIN, 8 * MIN],   maxRetries: 3 }, // 指数（沿用现状）
  network:      { backoffMs: [5 * MIN, 10 * MIN, 15 * MIN], maxRetries: 3 }, // 线性长延迟（沿用现状）
  timeout:      { backoffMs: [3 * MIN, 6 * MIN, 12 * MIN],  maxRetries: 3 }, // 新独立类（原并入 network）
  server_error: { backoffMs: [1 * MIN, 5 * MIN, 15 * MIN],  maxRetries: 3 }, // 新独立类（5xx，原并入 network）
};

/**
 * 瞬态类别集中判定 — 替换下游散落的类别枚举
 * （callback-processor / routes/execution / quarantine.checkSystemicFailurePattern / routes/task-tasks）。
 *
 * ⚠️ 'auth' 在此列表是沿用 callback-processor.js 现状语义（auth 错误跳过熔断计数，
 * 因为是凭据问题而非系统健康问题）；与 quarantine getRetryStrategy 里 AUTH「不重试、
 * 需人工介入」的语义是两回事（是否重试 ≠ 是否计入失败），并存是刻意的，勿统一。
 */
const TRANSIENT_CLASSES = new Set(['rate_limit', 'network', 'timeout', 'server_error', 'auth']);

function getBackoffMs(failureClass, retryCount) {
  const policy = RETRY_POLICY[failureClass];
  if (!policy) return null;
  if (retryCount >= policy.maxRetries) return null;
  return policy.backoffMs[Math.min(retryCount, policy.backoffMs.length - 1)];
}

function getMaxRetries(failureClass) {
  return RETRY_POLICY[failureClass]?.maxRetries ?? 0;
}

function isTransientClass(cls) {
  return TRANSIENT_CLASSES.has(cls);
}

export { RETRY_POLICY, getBackoffMs, getMaxRetries, isTransientClass };
