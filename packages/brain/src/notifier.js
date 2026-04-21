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
  if (process.env.BRAIN_MUTED === 'true') {
    console.log('[notifier] BRAIN_MUTED=true → skip outbound (feishu open api):', text.slice(0, 80));
    return false;
  }
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
  if (process.env.BRAIN_MUTED === 'true') {
    console.log('[notifier] BRAIN_MUTED=true → skip outbound (feishu webhook):', text.slice(0, 80));
    return false;
  }
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

// ─── Harness v2 关键事件通知（M6）────────────────────────────────────────
// PRD: docs/design/harness-v2-prd.md §6.9 飞书通知
// 钩子点由 harness-initiative-runner.js 在 phase 切换 / 事件分发时调用。

/**
 * 阶段 A 合同 APPROVED 时推送（含 DAG task 数量 + GAN 轮次）
 * @param {{ initiative_id: string, task_count: number, review_rounds?: number, initiative_title?: string }} info
 */
async function notifyHarnessContractApproved(info) {
  const rounds = info.review_rounds ? `（GAN ${info.review_rounds} 轮）` : '';
  const title = info.initiative_title || info.initiative_id;
  const text = `📜 Harness 合同已 APPROVED：${title}${rounds}
→ ${info.task_count} 个 Task 进入阶段 B 顺序执行`;
  return sendRateLimited(`harness_contract_approved_${info.initiative_id}`, text);
}

/**
 * 阶段 B 每个 Task PR merged
 * @param {{ initiative_id: string, task_id: string, title: string, pr_url?: string }} info
 */
async function notifyHarnessTaskMerged(info) {
  const link = info.pr_url ? `\n${info.pr_url}` : '';
  const text = `✅ Harness Task PR merged：${info.title}${link}`;
  return sendRateLimited(`harness_task_merged_${info.task_id}`, text);
}

/**
 * 阶段 C E2E 结果（PASS / FAIL）
 * @param {{ initiative_id: string, verdict: 'PASS'|'FAIL', initiative_title?: string, failed_task_id?: string, failed_scenarios?: string[] }} info
 */
async function notifyHarnessFinalE2E(info) {
  const title = info.initiative_title || info.initiative_id;
  if (info.verdict === 'PASS') {
    const text = `🎉 Harness 阶段 C E2E PASS：${title}`;
    return sendRateLimited(`harness_final_e2e_${info.initiative_id}`, text);
  }
  const failedId = info.failed_task_id ? `\n归因 Task：${info.failed_task_id}` : '';
  const scenarios =
    Array.isArray(info.failed_scenarios) && info.failed_scenarios.length
      ? `\n失败场景：${info.failed_scenarios.slice(0, 3).join('；')}`
      : '';
  const text = `🚨 Harness 阶段 C E2E FAIL：${title}${failedId}${scenarios}`;
  return sendRateLimited(`harness_final_e2e_${info.initiative_id}`, text);
}

/**
 * 预算 80% 预警 / 超时 30 分钟预警
 * @param {{ initiative_id: string, kind: 'budget'|'timeout', detail?: string }} info
 */
async function notifyHarnessBudgetWarning(info) {
  const label = info.kind === 'budget' ? '预算 80%' : '超时 30 分钟';
  const detail = info.detail ? `\n${info.detail}` : '';
  const text = `⚠️ Harness 预警：${info.initiative_id} ${label}${detail}`;
  return sendRateLimited(`harness_warn_${info.kind}_${info.initiative_id}`, text);
}

export {
  sendFeishu,
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyCircuitOpen,
  notifyPatrolCleanup,
  notifyDailySummary,
  notifyHarnessContractApproved,
  notifyHarnessTaskMerged,
  notifyHarnessFinalE2E,
  notifyHarnessBudgetWarning,
  RATE_LIMIT_MS
};
