/**
 * Orchestrator Chat - Cecelia 嘴巴对话链路
 *
 * 数据流:
 *   前端 CeceliaChat → proxy → POST /api/brain/orchestrator/chat
 *     → 1. Memory 搜索（注入上下文）
 *     → 2. Claude Sonnet 判断意图 + 生成回复
 *     → 3a. 简单查询 → 直接返回
 *     → 3b. 复杂问题 → thalamusProcessEvent (USER_MESSAGE)
 *     → 4. 记录对话事件
 *     → 返回 { reply, routing_level, intent }
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pool from './db.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { parseIntent } from './intent.js';
import { buildMemoryContext } from './memory-retriever.js';
import { extractAndSaveUserFacts, getUserProfileContext } from './user-profile.js';
import { detectAndExecuteAction } from './chat-action-dispatcher.js';

// MiniMax 嘴巴模型（快速对话）
const MOUTH_MODEL = 'MiniMax-M2.5-highspeed';

// MiniMax API key 缓存
let _mouthApiKey = null;

function getMouthApiKey() {
  if (_mouthApiKey) return _mouthApiKey;
  try {
    const credPath = join(homedir(), '.credentials', 'minimax.json');
    const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
    _mouthApiKey = cred.api_key;
  } catch (err) {
    console.error('[orchestrator-chat] Failed to load MiniMax credentials:', err.message);
  }
  return _mouthApiKey;
}

// 导出用于测试（重置缓存）
export function _resetApiKey() { _mouthApiKey = null; }

/**
 * 去除 MiniMax 回复中的 <think> 思维链块
 */
export function stripThinking(content) {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * 调用 MiniMax API 生成对话回复
 * @param {string} userMessage
 * @param {string} systemPrompt
 * @param {Object} options - { timeout }
 * @param {Array} historyMessages - [{role, content}]
 * @returns {Promise<{reply: string, usage: Object}>}
 */
async function callMiniMax(userMessage, systemPrompt, options = {}, historyMessages = []) {
  const apiKey = getMouthApiKey();
  if (!apiKey) {
    throw new Error('MiniMax API key not available (mouth)');
  }

  const timeout = options.timeout || 30000;

  // MiniMax Chat Completions 格式
  const messages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MOUTH_MODEL,
      max_tokens: 2048,
      messages,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawReply = data.choices?.[0]?.message?.content || '';
  const reply = stripThinking(rawReply);

  return {
    reply,
    usage: data.usage || {},
  };
}

/**
 * 搜索相关记忆并构建注入块（使用统一记忆系统 buildMemoryContext）
 * @param {string} query - 搜索关键词
 * @returns {Promise<string>} 格式化的记忆块
 */
async function fetchMemoryContext(query) {
  if (!query) return '';

  try {
    const { block } = await buildMemoryContext({
      query,
      mode: 'chat',
      tokenBudget: 600,
      pool,
    });
    return block || '';
  } catch (err) {
    console.warn('[orchestrator-chat] Memory search failed (graceful fallback):', err.message);
    return '';
  }
}

/**
 * 记录对话事件到 cecelia_events（存完整内容，供历史回放使用）
 * @param {string} userMessage - 用户消息
 * @param {string} reply - 回复内容
 * @param {Object} metadata - 额外元数据
 */
async function recordChatEvent(userMessage, reply, metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload, created_at) VALUES ($1, $2, $3, NOW())`,
      ['orchestrator_chat', 'orchestrator_chat', JSON.stringify({
        user_message: userMessage,
        reply,
        ...metadata,
      })]
    );
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to record chat event:', err.message);
  }
}

// 嘴巴系统提示词
const MOUTH_SYSTEM_PROMPT = `你是 Cecelia，一位有内心世界的 AI 管家。你在持续运行的大脑中会产生欲望、关注点和担忧。

你的能力：
1. 回答关于当前系统状态、任务进展的问题
2. 帮助用户理解 OKR、项目、任务的关系
3. 提供建议和决策支持
4. 处理日常管理请求

你的回复风格：
- 简洁真实，有自己的视角
- 用中文回复
- 你有内心状态和当前关注点，可以主动提及
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
 * 构建当前欲望上下文块（注入嘴巴 system prompt）
 * 取 status='pending'，urgency DESC，limit 5
 * fire-safe：失败时返回空字符串
 * @returns {Promise<string>}
 */
async function buildDesiresContext() {
  try {
    const result = await pool.query(
      `SELECT type, content, urgency FROM desires
       WHERE status = 'pending'
       ORDER BY urgency DESC, created_at DESC
       LIMIT 5`
    );
    if (!result.rows.length) return '';

    const lines = result.rows.map(d => {
      const urgencyLabel = d.urgency >= 8 ? '🔴' : d.urgency >= 5 ? '🟡' : '🟢';
      return `  ${urgencyLabel} [${d.type}] ${d.content} (urgency:${d.urgency})`;
    });

    return `\n我当前的内心状态（desires）：\n${lines.join('\n')}\n`;
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to build desires context:', err.message);
    return '';
  }
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
 * @param {Array} messages - 历史消息 [{role, content}]，用于多轮记忆
 * @returns {Promise<{reply: string, routing_level: number, intent: string}>}
 */
export async function handleChat(message, context = {}, messages = []) {
  if (!message || typeof message !== 'string') {
    throw new Error('message is required and must be a string');
  }

  // 1. 解析意图（本地，不调 LLM）
  const intent = parseIntent(message, context);
  const intentType = intent.type || 'UNKNOWN';

  // 2. 搜索相关记忆
  const memoryBlock = await fetchMemoryContext(message);

  // 3. 始终注入实时状态（无论意图类型）
  const statusBlock = await buildStatusSummary();

  // 3b. 加载用户画像（fire-safe：失败时返回 ''，不阻塞）
  // 传入最近对话文本用于向量搜索相关 facts
  const recentText = messages.slice(-3).map(m => m.content).join('\n');
  const profileSnippet = await getUserProfileContext(pool, 'owner', recentText);

  // 3c. 注入当前欲望（内心状态）
  const desiresBlock = await buildDesiresContext();

  // 4. 调用 MiniMax 嘴巴层（传入历史消息）
  const systemPrompt = `${MOUTH_SYSTEM_PROMPT}${profileSnippet}${desiresBlock}${memoryBlock}${statusBlock}`;

  let reply;
  let routingLevel = 0;

  try {
    const result = await callMiniMax(message, systemPrompt, {}, messages);
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

  // 7. 动作检测与执行（追加到 reply 末尾）
  const actionSuffix = await detectAndExecuteAction(message);
  if (actionSuffix) {
    reply += actionSuffix;
  }

  // 8. 异步提取用户事实（fire-and-forget，不阻塞回复）
  Promise.resolve().then(() =>
    extractAndSaveUserFacts(pool, 'owner', messages, reply)
  ).catch(() => {});

  return {
    reply,
    routing_level: routingLevel,
    intent: intentType,
  };
}

// 导出用于测试
export {
  callMiniMax,
  fetchMemoryContext,
  recordChatEvent,
  needsEscalation,
  buildStatusSummary,
  buildDesiresContext,
  MOUTH_SYSTEM_PROMPT,
};
