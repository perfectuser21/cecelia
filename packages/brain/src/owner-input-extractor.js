/**
 * Owner Input Extractor - 主人声音渠道
 *
 * 职责：从对话中提取可执行意图，创建 suggestions（owner_input 来源）。
 *
 * 设计原则：
 * - 只处理 ACTION_INTENTS（非查询/闲聊意图）
 * - 每次对话最多创建 1 个 suggestion（防洪峰）
 * - fire-and-forget，失败静默（不阻塞对话回复）
 */

/* global console */

import { createSuggestion } from './suggestion-triage.js';

/** 需要生成 suggestion 的意图类型（大写，比较时统一转换） */
const ACTION_INTENTS = new Set([
  'CREATE_TASK',
  'CREATE_PROJECT',
  'CREATE_GOAL',
  'CREATE_FEATURE',
  'FIX_BUG',
  'REFACTOR',
  'EXPLORE',
  'MODIFY',
  'LEARN',
  'RESEARCH',
  'COMMAND',
]);

/**
 * 从对话中提取可执行意图并写入 suggestions 管道
 *
 * @param {string} message - 用户消息
 * @param {string} intentType - 已识别的意图类型
 * @returns {Promise<void>}
 */
export async function extractSuggestionsFromChat(message, intentType) {
  if (!message || !intentType) return;

  // 只处理动作型意图（跳过 CHAT/QUERY_STATUS/UNKNOWN）
  // intent.js 返回小写（create_task），统一转大写后比较
  if (!ACTION_INTENTS.has((intentType || '').toUpperCase())) return;

  const content = `owner_request: ${message.slice(0, 200)}`;

  try {
    await createSuggestion({
      content,
      source: 'owner_input',
      agent_id: 'owner-input-extractor',
      suggestion_type: 'owner_request',
      metadata: {
        intent_type: intentType,
        original_length: message.length,
      },
    });
    console.log(`[owner-input-extractor] 创建 suggestion: intent=${intentType}, length=${message.length}`);
  } catch (err) {
    // 静默失败，不影响对话回复
    console.warn('[owner-input-extractor] Failed to create suggestion (ignored):', err.message);
  }
}
