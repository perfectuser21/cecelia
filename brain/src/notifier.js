/**
 * Notifier - Feishu webhook push for Cecelia events
 *
 * Sends notifications to Feishu bot webhook for key events:
 * - Task completed / failed
 * - Circuit breaker triggered
 * - Daily summary (called externally)
 *
 * Errors are caught and logged - never breaks main flow.
 */

const FEISHU_WEBHOOK_URL = process.env.FEISHU_BOT_WEBHOOK || '';

// Rate limiting: max 1 message per event type per 60 seconds
const _lastSent = new Map();
const RATE_LIMIT_MS = 60 * 1000;

/**
 * Send a message to Feishu bot webhook
 * @param {string} text - Message content (supports markdown)
 * @returns {Promise<boolean>} - Whether the message was sent
 */
async function sendFeishu(text) {
  if (!FEISHU_WEBHOOK_URL) {
    console.log('[notifier] FEISHU_BOT_WEBHOOK not configured, skipping');
    return false;
  }

  try {
    const resp = await fetch(FEISHU_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text }
      })
    });

    if (!resp.ok) {
      console.error(`[notifier] Feishu webhook returned ${resp.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notifier] Failed to send Feishu message:`, err.message);
    return false;
  }
}

/**
 * Rate-limited send - skip if same eventKey was sent recently
 */
async function sendRateLimited(eventKey, text) {
  const now = Date.now();
  const lastTime = _lastSent.get(eventKey) || 0;
  if (now - lastTime < RATE_LIMIT_MS) {
    return false;
  }
  _lastSent.set(eventKey, now);
  return sendFeishu(text);
}

/**
 * Notify task completed
 * @param {{ task_id: string, title: string, run_id?: string, duration_ms?: number }} info
 */
async function notifyTaskCompleted(info) {
  const duration = info.duration_ms ? `（耗时 ${Math.round(info.duration_ms / 1000)}s）` : '';
  const text = `✅ 任务完成：${info.title}${duration}`;
  return sendRateLimited(`task_completed_${info.task_id}`, text);
}

/**
 * Notify task failed
 * @param {{ task_id: string, title: string, reason?: string }} info
 */
async function notifyTaskFailed(info) {
  const reason = info.reason ? `\n原因：${info.reason}` : '';
  const text = `❌ 任务失败：${info.title}${reason}`;
  return sendRateLimited(`task_failed_${info.task_id}`, text);
}

/**
 * Notify circuit breaker opened
 * @param {{ key: string, failures: number, reason?: string }} info
 */
async function notifyCircuitOpen(info) {
  const text = `⚠️ 熔断触发：${info.key} 连续失败 ${info.failures} 次，已暂停派发`;
  return sendRateLimited(`circuit_open_${info.key}`, text);
}

/**
 * Notify patrol cleanup (task auto-failed due to timeout)
 * @param {{ task_id: string, title: string, elapsed_minutes: number }} info
 */
async function notifyPatrolCleanup(info) {
  const text = `🔄 巡逻清理：${info.title} 超时 ${info.elapsed_minutes} 分钟，已自动标记失败`;
  return sendRateLimited(`patrol_${info.task_id}`, text);
}

/**
 * Send daily summary
 * @param {{ completed: number, failed: number, planned: number, circuit_breakers: Object }} summary
 */
async function notifyDailySummary(summary) {
  const lines = [
    `📊 Cecelia 日报`,
    `完成：${summary.completed} 个任务`,
    `失败：${summary.failed} 个任务`,
    `计划中：${summary.planned} 个任务`
  ];
  if (summary.circuit_breakers && Object.keys(summary.circuit_breakers).length > 0) {
    const openBreakers = Object.entries(summary.circuit_breakers)
      .filter(([, v]) => v.state === 'OPEN')
      .map(([k]) => k);
    if (openBreakers.length > 0) {
      lines.push(`熔断中：${openBreakers.join(', ')}`);
    }
  }
  return sendFeishu(lines.join('\n'));
}

export {
  sendFeishu,
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyCircuitOpen,
  notifyPatrolCleanup,
  notifyDailySummary,
  RATE_LIMIT_MS
};
