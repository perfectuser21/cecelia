/**
 * Notifier - Feishu push for Cecelia events
 *
 * 双渠道发送策略：
 * 1. FEISHU_BOT_WEBHOOK 已配置 → 走群机器人 Webhook
 * 2. 未配置 → 降级到 Open API 发私信给 Alex（FEISHU_APP_ID + FEISHU_APP_SECRET）
 *
 * Errors are caught and logged - never breaks main flow.
 */

const FEISHU_WEBHOOK_URL = process.env.FEISHU_BOT_WEBHOOK || '';
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';

// Alex 的 open_id：从 FEISHU_OWNER_OPEN_IDS 取第一个（逗号分隔），或空
const FEISHU_ALEX_OPEN_ID = (process.env.FEISHU_OWNER_OPEN_IDS || '').split(',')[0].trim() || '';

// Rate limiting: max 1 message per event type per 60 seconds
const _lastSent = new Map();
const RATE_LIMIT_MS = 60 * 1000;

/**
 * 通过飞书 Open API 发私信给 Alex
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function sendFeishuOpenAPI(text) {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !FEISHU_ALEX_OPEN_ID) {
    console.log('[notifier] Open API 凭据或 Alex open_id 未配置，跳过');
    return false;
  }

  try {
    // 1. 获取 tenant_access_token
    const authResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
      signal: AbortSignal.timeout(8000)
    });
    const auth = await authResp.json();
    if (auth.code !== 0) {
      console.error('[notifier] 获取飞书 token 失败:', auth.msg);
      return false;
    }

    // 2. 发私信
    const sendResp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.tenant_access_token}`
      },
      body: JSON.stringify({
        receive_id: FEISHU_ALEX_OPEN_ID,
        msg_type: 'text',
        content: JSON.stringify({ text })
      }),
      signal: AbortSignal.timeout(8000)
    });
    const sendResult = await sendResp.json();
    if (sendResult.code !== 0) {
      console.error('[notifier] 飞书私信发送失败:', sendResult.msg);
      return false;
    }
    console.log('[notifier] 飞书私信发送成功（Open API）');
    return true;
  } catch (err) {
    console.error('[notifier] Open API 发送异常:', err.message);
    return false;
  }
}

/**
 * Send a message to Feishu
 * 优先走 Webhook；Webhook 未配置时降级到 Open API 私信给 Alex
 * @param {string} text - Message content
 * @returns {Promise<boolean>}
 */
async function sendFeishu(text) {
  // 渠道 1：Webhook（群机器人）
  if (FEISHU_WEBHOOK_URL) {
    try {
      const resp = await fetch(FEISHU_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) {
        console.error(`[notifier] Feishu webhook returned ${resp.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[notifier] Webhook 发送失败:', err.message);
      return false;
    }
  }

  // 渠道 2：Open API 私信（降级）
  return sendFeishuOpenAPI(text);
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
