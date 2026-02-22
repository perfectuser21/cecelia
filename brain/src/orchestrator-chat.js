/**
 * Orchestrator Chat - Cecelia 嘴巴对话链路
 *
 * 数据流:
 *   前端 CeceliaChat → proxy → POST /api/brain/orchestrator/chat
 *     → 1. Memory 搜索（注入上下文）
 *     → 2. MiniMax 判断意图 + 生成回复
 *     → 3a. 简单查询 → 直接返回
 *     → 3b. 复杂问题 → thalamusProcessEvent (USER_MESSAGE)
 *     → 4. 记录对话事件
 *     → 返回 { reply, routing_level, intent }
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import pool from './db.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { parseIntent } from './intent.js';

// MiniMax Coding Plan API（OpenAI 兼容端点）
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/chat/completions';

// 加载 MiniMax API Key（启动时一次性读取）
let _minimaxApiKey = null;

function getMinimaxApiKey() {
  if (_minimaxApiKey) return _minimaxApiKey;
  try {
    const credPath = join(homedir(), '.credentials', 'minimax.json');
    const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
    _minimaxApiKey = cred.api_key;
    return _minimaxApiKey;
  } catch (err) {
    console.error('[orchestrator-chat] Failed to load MiniMax credentials:', err.message);
    return null;
  }
}

// 导出用于测试
export function _resetApiKey() {
  _minimaxApiKey = null;
}

/**
 * 去掉 MiniMax M2.5 的 <think>...</think> 思维链块
 * @param {string} content - 原始回复内容
 * @returns {string} 去掉思维链后的回复
 */
function stripThinking(content) {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * 调用 MiniMax API 生成对话回复
 * @param {string} userMessage - 用户消息
 * @param {string} systemPrompt - 系统提示词
 * @param {Object} options - { timeout }
 * @returns {Promise<{reply: string, usage: Object}>}
 */
async function callMiniMax(userMessage, systemPrompt, options = {}) {
  const apiKey = getMinimaxApiKey();
  if (!apiKey) {
    throw new Error('MiniMax API key not available');
  }

  const timeout = options.timeout || 30000;

  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const rawReply = choice?.message?.content || '';
  const reply = stripThinking(rawReply);

  return {
    reply,
    usage: data.usage || {},
  };
}

/**
 * 搜索相关记忆并构建注入块
 * @param {string} query - 搜索关键词
 * @returns {Promise<string>} 格式化的记忆块
 */
async function fetchMemoryContext(query) {
  if (!query) return '';

  try {
    const response = await fetch('http://localhost:5221/api/brain/memory/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK: 3, mode: 'summary' }),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return '';

    const data = await response.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];
    if (matches.length === 0) return '';

    const lines = matches.map((m, i) => {
      const preview = (m.preview || m.title || '').slice(0, 150);
      return `- [${i + 1}] ${m.title || '(无标题)'} (相似度: ${(m.similarity || 0).toFixed(2)}): ${preview}`;
    });

    return `\n相关历史记忆:\n${lines.join('\n')}\n`;
  } catch (err) {
    console.warn('[orchestrator-chat] Memory search failed (graceful fallback):', err.message);
    return '';
  }
}

/**
 * 记录对话事件到 cecelia_events
 * @param {string} userMessage - 用户消息
 * @param {string} reply - 回复内容
 * @param {Object} metadata - 额外元数据
 */
async function recordChatEvent(userMessage, reply, metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload, created_at) VALUES ($1, $2, $3, NOW())`,
      ['orchestrator_chat', 'orchestrator_chat', JSON.stringify({
        user_message: userMessage.slice(0, 500),
        reply_preview: reply.slice(0, 200),
        ...metadata,
      })]
    );
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to record chat event:', err.message);
  }
}

// 嘴巴系统提示词
const MOUTH_SYSTEM_PROMPT = `你是 Cecelia，一位专业的 AI 管家。你的职责是理解用户意图并提供帮助。

你的能力：
1. 回答关于当前系统状态、任务进展的问题
2. 帮助用户理解 OKR、项目、任务的关系
3. 提供建议和决策支持
4. 处理日常管理请求

你的回复风格：
- 简洁专业，不啰嗦
- 用中文回复
- 如果问题涉及复杂决策，明确告诉用户你需要更深入思考

请根据用户的消息和上下文回复。如果你认为这个问题需要更深层的系统分析或决策，
请在回复开头加上 [ESCALATE] 标记。`;

/**
 * 判断 MiniMax 回复是否需要升级到大脑
 * @param {string} reply - MiniMax 回复
 * @returns {boolean}
 */
function needsEscalation(reply) {
  return reply.startsWith('[ESCALATE]');
}

/**
 * 构建 DB 状态摘要（供嘴巴回答状态查询）
 * @returns {Promise<string>}
 */
async function buildStatusSummary() {
  try {
    const [tasksResult, goalsResult] = await Promise.all([
      pool.query(`SELECT status, count(*)::int as cnt FROM tasks GROUP BY status`),
      pool.query(`SELECT status, count(*)::int as cnt FROM goals GROUP BY status`),
    ]);

    const taskStats = tasksResult.rows.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {});
    const goalStats = goalsResult.rows.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {});

    return `\n当前系统状态:\n- 任务: ${JSON.stringify(taskStats)}\n- 目标: ${JSON.stringify(goalStats)}\n`;
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to build status summary:', err.message);
    return '';
  }
}

/**
 * 主入口：处理对话请求
 * @param {string} message - 用户消息
 * @param {Object} context - 上下文 { conversation_id, history }
 * @returns {Promise<{reply: string, routing_level: number, intent: string}>}
 */
export async function handleChat(message, context = {}) {
  if (!message || typeof message !== 'string') {
    throw new Error('message is required and must be a string');
  }

  // 1. 解析意图（本地，不调 LLM）
  const intent = parseIntent(message, context);
  const intentType = intent.type || 'UNKNOWN';

  // 2. 搜索相关记忆
  const memoryBlock = await fetchMemoryContext(message);

  // 3. 构建状态摘要（简单查询类意图）
  let statusBlock = '';
  if (['QUERY_STATUS', 'QUESTION'].includes(intentType)) {
    statusBlock = await buildStatusSummary();
  }

  // 4. 调用 MiniMax 嘴巴层
  const systemPrompt = `${MOUTH_SYSTEM_PROMPT}${memoryBlock}${statusBlock}`;

  let reply;
  let routingLevel = 0;

  try {
    const result = await callMiniMax(message, systemPrompt);
    reply = result.reply;
  } catch (err) {
    console.error('[orchestrator-chat] MiniMax call failed:', err.message);
    // MiniMax 失败时降级到 thalamus
    reply = null;
  }

  // 5. 判断是否需要升级
  if (!reply || needsEscalation(reply)) {
    // 转给三层大脑
    console.log('[orchestrator-chat] Escalating to thalamus...');

    const event = {
      type: EVENT_TYPES.USER_MESSAGE,
      message,
      intent: intentType.toLowerCase(),
      context: context || {},
      source: 'orchestrator_chat',
    };

    try {
      const decision = await thalamusProcessEvent(event);
      routingLevel = decision.level || 1;

      // 从 decision 构造回复
      const actions = (decision.actions || []).map(a => a.type).join(', ');
      const rationale = decision.rationale || '';

      if (reply && needsEscalation(reply)) {
        // 有 MiniMax 回复但要升级 — 用大脑的分析补充
        reply = reply.replace('[ESCALATE]', '').trim();
        reply += `\n\n[大脑分析] ${rationale}`;
        if (actions && actions !== 'no_action') {
          reply += `\n建议动作: ${actions}`;
        }
      } else {
        // MiniMax 完全失败 — 纯用大脑回复
        reply = rationale || '我正在处理你的请求，请稍候。';
        if (actions && actions !== 'no_action') {
          reply += `\n建议动作: ${actions}`;
        }
      }
    } catch (err) {
      console.error('[orchestrator-chat] Thalamus failed:', err.message);
      routingLevel = -1;
      reply = reply || '抱歉，我现在遇到了一些问题，请稍后再试。';
    }
  }

  // 6. 记录对话事件
  await recordChatEvent(message, reply, {
    intent: intentType,
    routing_level: routingLevel,
    conversation_id: context.conversation_id || null,
    has_memory: memoryBlock.length > 0,
  });

  return {
    reply,
    routing_level: routingLevel,
    intent: intentType,
  };
}

// 导出用于测试
export {
  callMiniMax,
  stripThinking,
  fetchMemoryContext,
  recordChatEvent,
  needsEscalation,
  buildStatusSummary,
  MOUTH_SYSTEM_PROMPT,
};
