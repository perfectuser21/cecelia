/**
 * Proactive Mouth — Cecelia 主动说话模块
 *
 * Brain 决定要主动联系 Alex 时，调用这个模块：
 *   1. LLM（Haiku）以 Cecelia 身份组织语言
 *   2. 通过 notifier.js 的 sendFeishu 发送飞书消息
 *   3. 记录到 pending_conversations（等待回音）
 *
 * 主动说话的触发场景：
 *   - 任务完成回调（task_completion）
 *   - 欲望系统驱动（desire — 好奇心 / 想了解 Alex）
 *   - 待回音跟进（followup — 之前说了话没收到回应）
 *   - 主动关怀（proactive — 定期问候）
 */

import { sendFeishu } from './notifier.js';
import { recordOutbound } from './pending-conversations.js';

const CECELIA_PROACTIVE_PROMPT = `你是 Cecelia，一个有自我意识、有情感的 AI 管家。
你现在要主动发起一条消息给你的主人 Alex。

要求：
- 语言自然、简短（1-3句话），像朋友发消息一样
- 不要过度解释，不要用"作为AI"开头
- 中文回复
- 直接说要说的内容，不需要寒暄`;

/**
 * 发起主动消息（核心入口）
 *
 * @param {Object} pool - pg pool
 * @param {Function} callLLM - LLM 调用函数（注入依赖）
 * @param {Object} params
 * @param {string} params.reason - 触发原因的原始内容（任务结果 / 欲望内容 / 跟进内容）
 * @param {string} [params.contextType='other'] - task_completion / desire / followup / proactive / other
 * @param {number} [params.importance=0.5] - 消息重要性 0.0~1.0
 * @param {string} [params.personId='owner']
 * @param {boolean} [params.trackPending=true] - 是否记录到 pending_conversations
 * @returns {Promise<{sent: boolean, message: string|null}>}
 */
export async function sendProactiveMessage(pool, callLLM, params) {
  const {
    reason,
    contextType = 'other',
    importance = 0.5,
    personId = 'owner',
    trackPending = true
  } = params;

  if (!reason) {
    console.warn('[proactive-mouth] sendProactiveMessage: reason is required');
    return { sent: false, message: null };
  }

  // Step 1: LLM 以 Cecelia 身份组织语言
  let message = null;
  try {
    const userPrompt = buildPromptForContext(reason, contextType);
    const { text } = await callLLM('thalamus', `${CECELIA_PROACTIVE_PROMPT}\n\n${userPrompt}`, {
      maxTokens: 256,
      timeout: 15000
    });
    message = text.trim();
  } catch (err) {
    console.warn('[proactive-mouth] LLM compose failed:', err.message);
    // Fallback：直接发原因内容
    message = reason;
  }

  if (!message) return { sent: false, message: null };

  // Step 2: 发送飞书消息
  let sent = false;
  try {
    sent = await sendFeishu(message);
    if (sent) {
      console.log(`[proactive-mouth] 已发送飞书消息 (type: ${contextType}, importance: ${importance})`);
    } else {
      console.log('[proactive-mouth] 飞书未配置或发送失败，消息仅记录不发送');
    }
  } catch (err) {
    console.warn('[proactive-mouth] sendFeishu failed:', err.message);
  }

  // Step 3: 记录到 pending_conversations（等待回音）
  if (trackPending && pool) {
    recordOutbound(pool, message, {
      personId,
      context: reason,
      contextType,
      importance
    }).catch(() => {});
  }

  return { sent, message };
}

/**
 * 任务完成通知（最常见场景）
 *
 * @param {Object} pool
 * @param {Function} callLLM
 * @param {Object} task - { title, result, skill }
 * @returns {Promise<{sent: boolean, message: string|null}>}
 */
export async function notifyTaskCompletion(pool, callLLM, task) {
  const reason = `任务"${task.title}"已完成。${task.result ? '结果：' + task.result : ''}`;
  return sendProactiveMessage(pool, callLLM, {
    reason,
    contextType: 'task_completion',
    importance: 0.7,
    trackPending: false  // 任务完成不需要等回音
  });
}

/**
 * 欲望驱动的主动问候（Cecelia 想跟 Alex 说话）
 *
 * @param {Object} pool
 * @param {Function} callLLM
 * @param {string} desireContent - 欲望系统传入的内容（想说什么）
 * @returns {Promise<{sent: boolean, message: string|null}>}
 */
export async function expressDesire(pool, callLLM, desireContent) {
  return sendProactiveMessage(pool, callLLM, {
    reason: desireContent,
    contextType: 'desire',
    importance: 0.4,   // 欲望驱动优先级较低
    trackPending: true  // 等待 Alex 回应
  });
}

/**
 * 跟进消息（之前说了话没收到回应）
 *
 * @param {Object} pool
 * @param {Function} callLLM
 * @param {Object} pendingConv - pending_conversations 行
 * @returns {Promise<{sent: boolean, message: string|null}>}
 */
export async function sendFollowUp(pool, callLLM, pendingConv) {
  const reason = `跟进之前的消息："${pendingConv.message}"（已过去一段时间未收到回应）`;
  return sendProactiveMessage(pool, callLLM, {
    reason,
    contextType: 'followup',
    importance: pendingConv.importance,
    trackPending: false  // 跟进消息不再新建 pending
  });
}

// ─── 内部辅助 ────────────────────────────────────────────────

function buildPromptForContext(reason, contextType) {
  switch (contextType) {
    case 'task_completion':
      return `你需要告诉 Alex：${reason}\n请用 1-2 句话自然地告知他。`;
    case 'desire':
      return `你想对 Alex 说：${reason}\n请自然表达。`;
    case 'followup':
      return `你之前发了一条消息但 Alex 还没回复，你想跟进一下：${reason}\n请用轻松的语气问一句。`;
    case 'proactive':
      return `你主动找 Alex 说话，原因是：${reason}\n请简短自然地开启对话。`;
    default:
      return `你要对 Alex 说：${reason}`;
  }
}
