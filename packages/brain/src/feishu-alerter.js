/**
 * 飞书告警聚合器
 * 同类告警在聚合窗口内合并发送；连败升级；webhook 失败时写本地日志兜底
 */

/**
 * 创建飞书告警聚合器
 * @param {Object} opts
 * @param {Function} opts.webhookFn - async(payload) => void，实际发送告警
 * @param {Function} opts.fallbackFn - async(entry) => void，兜底本地日志
 * @param {number} opts.aggregationWindowMs - 聚合窗口毫秒数，默认 600000（10 分钟）
 * @param {number} opts.escalationThreshold - 连败升级阈值，默认 3
 */
export function createFeishuAlerter({
  webhookFn = async () => {},
  fallbackFn = async () => {},
  aggregationWindowMs = 10 * 60 * 1000,
  escalationThreshold = 3,
} = {}) {
  // 聚合缓冲区：type → { events: [], timer: null }
  const buckets = new Map();
  // 连败计数器
  let failureStreak = 0;
  const timers = new Set();

  /**
   * 发送聚合消息（窗口结束后调用）
   */
  async function flushBucket(type) {
    const bucket = buckets.get(type);
    if (!bucket || bucket.events.length === 0) return;

    const events = [...bucket.events];
    bucket.events = [];
    bucket.timer = null;

    const payload = {
      type,
      count: events.length,
      events,
      timestamp: new Date().toISOString(),
    };

    // 连败升级检查（eval_failed 类型）
    if (type === 'eval_failed' && failureStreak >= escalationThreshold) {
      payload.escalated = true;
      payload.level = 'P0';
    }

    try {
      await webhookFn(payload);
    } catch (err) {
      // webhook 失败：兜底写本地日志
      try {
        await fallbackFn({
          type,
          events,
          timestamp: new Date().toISOString(),
          error: err?.message,
        });
      } catch (fallbackErr) {
        console.error('[feishu-alerter] fallback also failed:', fallbackErr);
      }
    }
  }

  /**
   * 发送告警（进入聚合缓冲区）
   */
  function send(event) {
    const type = event.type || 'unknown';

    if (!buckets.has(type)) {
      buckets.set(type, { events: [], timer: null });
    }

    const bucket = buckets.get(type);
    bucket.events.push(event);

    if (!bucket.timer) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        flushBucket(type);
      }, aggregationWindowMs);
      timers.add(timer);
      bucket.timer = timer;
    }
  }

  /**
   * 记录一次失败（eval_failed 类型，触发连败升级逻辑）
   */
  function recordFailure(event) {
    failureStreak++;
    const type = event.type || 'eval_failed';

    if (!buckets.has(type)) {
      buckets.set(type, { events: [], timer: null });
    }

    const bucket = buckets.get(type);
    bucket.events.push({ ...event, streak: failureStreak });

    if (!bucket.timer) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        flushBucket(type);
      }, aggregationWindowMs);
      timers.add(timer);
      bucket.timer = timer;
    }
  }

  /**
   * 记录一次成功（重置连败计数器）
   */
  function recordSuccess(_event) {
    failureStreak = 0;
  }

  /**
   * 销毁（清理所有定时器）
   */
  function destroy() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
    buckets.clear();
  }

  return {
    send,
    recordFailure,
    recordSuccess,
    destroy,
  };
}
