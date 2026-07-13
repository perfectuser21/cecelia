/**
 * feishu-alert.js — 飞书 Webhook 告警工具
 * Sprint: 07072314-skill-eval-service
 *
 * 提供 skill_eval 失败聚合告警（10min 同类聚合，连败 ≥3 升级）
 * 凭据：FEISHU_SKILL_EVAL_WEBHOOK 环境变量（不进 git / 日志）
 */

const FEISHU_WEBHOOK_URL = process.env.FEISHU_SKILL_EVAL_WEBHOOK || '';
const AGGREGATE_WINDOW_MS = 10 * 60 * 1000; // 10 分钟聚合窗口
const ESCALATE_THRESHOLD = 3; // 连败 ≥3 升级告警

// 聚合缓冲区：{ [failureMode]: { count, firstAt, lastAt } }
const alertBuffer = {};
let flushTimer = null;

/**
 * 发送 skill_eval 失败告警（10min 聚合）
 * @param {string} failureMode - 'dispatch' | 'crash' | 'timeout' | 'publish'
 * @param {string} taskId - 任务 ID
 * @param {string} [detail] - 额外描述
 */
export function alertSkillEvalFailure(failureMode, taskId, detail = '') {
  const key = failureMode;

  if (!alertBuffer[key]) {
    alertBuffer[key] = { count: 0, firstAt: Date.now(), lastAt: Date.now(), taskIds: [] };
  }

  alertBuffer[key].count += 1;
  alertBuffer[key].lastAt = Date.now();
  alertBuffer[key].taskIds.push(taskId);

  // 连败升级：立即发送
  if (alertBuffer[key].count >= ESCALATE_THRESHOLD) {
    const msg = buildEscalateMessage(key, alertBuffer[key], detail);
    sendToFeishu(msg).catch(() => {
      console.error(`[feishu-alert] escalate send failed for mode=${key}`);
    });
    // 清空该 key 缓冲，避免重复升级
    delete alertBuffer[key];
    clearFlushSchedule();
    return;
  }

  // 普通聚合：调度 flush
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushAlerts, AGGREGATE_WINDOW_MS);
}

function clearFlushSchedule() {
  if (Object.keys(alertBuffer).length === 0 && flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

async function flushAlerts() {
  flushTimer = null;
  const keys = Object.keys(alertBuffer);
  if (keys.length === 0) return;

  const lines = keys.map((key) => {
    const b = alertBuffer[key];
    return `• failed(${key}) × ${b.count} 次（首发 ${new Date(b.firstAt).toISOString().slice(11, 19)} UTC）`;
  });

  const msg = {
    msg_type: 'text',
    content: {
      text: [
        '【Skill Eval 失败聚合告警】',
        ...lines,
        '',
        '请检查 Brain skill_evals 表或联系 on-call 处理。',
      ].join('\n'),
    },
  };

  // 清空缓冲
  keys.forEach((k) => delete alertBuffer[k]);

  await sendToFeishu(msg).catch(() => {
    console.error('[feishu-alert] flush send failed');
  });
}

function buildEscalateMessage(mode, buf, detail) {
  return {
    msg_type: 'text',
    content: {
      text: [
        `⚠️【Skill Eval 连败升级告警】failed(${mode}) 已连续失败 ${buf.count} 次`,
        `首次失败：${new Date(buf.firstAt).toISOString()}`,
        `最近失败：${new Date(buf.lastAt).toISOString()}`,
        `任务 IDs：${buf.taskIds.join(', ')}`,
        detail ? `详情：${detail}` : '',
        '',
        '请立即检查 Brain 调度状态与 skill-evaluator 容器！',
      ].filter(Boolean).join('\n'),
    },
  };
}

async function sendToFeishu(payload) {
  if (!FEISHU_WEBHOOK_URL) {
    // 未配置 webhook → 只写本地日志（兜底）；没有对外动作，不写回执
    console.warn('[feishu-alert] FEISHU_SKILL_EVAL_WEBHOOK not set, logging locally:', JSON.stringify(payload));
    return;
  }

  // 回执台账（九要素 T4）：动态 import + fail-open，照 notifier 先例
  let receiptId = null;
  try {
    const { recordActionReceipt } = await import('./receipt-collector.js');
    receiptId = await recordActionReceipt({ kind: 'feishu', target: 'skill_eval_webhook' });
  } catch (err) {
    console.warn('[feishu-alert] 回执写入失败（fail-open）:', err.message);
  }
  const resolveReceipt = async (status, evidence) => {
    if (!receiptId) return;
    try {
      const { resolveActionReceipt } = await import('./receipt-collector.js');
      await resolveActionReceipt(receiptId, status, evidence);
    } catch (err) {
      console.warn('[feishu-alert] 回执核销失败（fail-open）:', err.message);
    }
  };

  try {
    const resp = await fetch(FEISHU_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error(`[feishu-alert] webhook responded ${resp.status}`);
      await resolveReceipt('failed', { http_status: resp.status });
      return;
    }
    await resolveReceipt('confirmed', { http_status: resp.status });
  } catch (err) {
    // 飞书 webhook 挂 → 本地日志兜底
    console.error('[feishu-alert] send failed (falling back to local log):', err.message);
    console.log('[feishu-alert] payload:', JSON.stringify(payload));
    await resolveReceipt('failed', { error: err.message });
  }
}
