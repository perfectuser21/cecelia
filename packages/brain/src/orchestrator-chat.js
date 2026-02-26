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

import pool from './db.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { parseIntent } from './intent.js';
import { buildMemoryContext } from './memory-retriever.js';
import { extractAndSaveUserFacts, getUserProfileContext } from './user-profile.js';
import { detectAndExecuteAction } from './chat-action-dispatcher.js';
import { callLLM } from './llm-caller.js';

// 导出用于测试（重置缓存，已不需要但保留兼容）
export function _resetApiKey() { /* no-op */ }

/**
 * 去除 LLM 回复中的 <think> 思维链块
 */
export function stripThinking(content) {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * 调用统一 LLM 层生成对话回复
 * @param {string} userMessage
 * @param {string} systemPrompt
 * @param {Object} options - { timeout }
 * @param {Array} historyMessages - [{role, content}]
 * @returns {Promise<{reply: string, usage: Object}>}
 */
async function callMiniMax(userMessage, systemPrompt, options = {}, historyMessages = []) {
  const timeout = options.timeout || 30000;

  // 将 system prompt + history + user message 合并为单一 prompt
  const historyBlock = historyMessages.slice(-10)
    .map(m => `${m.role === 'user' ? 'Alex' : 'Cecelia'}：${m.content}`)
    .join('\n');

  const fullPrompt = `${systemPrompt}\n\n${historyBlock ? `## 对话历史\n${historyBlock}\n\n` : ''}Alex：${userMessage}`;

  const { text } = await callLLM('mouth', fullPrompt, { timeout, maxTokens: 2048 });

  return {
    reply: text,
    usage: {},
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

  // 0. 标记用户在线（Break 5：让 desire system 感知 Alex 的存在）
  try {
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ('user_last_seen', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
    `, [JSON.stringify(new Date().toISOString())]);
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to update user_last_seen:', err.message);
  }

  // 0b. 写入 memory_stream（让 desire system 感知到对话）
  try {
    await pool.query(`
      INSERT INTO memory_stream (content, importance, memory_type, expires_at)
      VALUES ($1, 4, 'short', NOW() + INTERVAL '24 hours')
    `, [`[用户对话] Alex 说：${message.slice(0, 200)}`]);
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to write chat to memory_stream:', err.message);
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
      const decisionActions = decision.actions || [];
      const actionTypes = decisionActions.map(a => a.type).join(', ');
      const rationale = decision.rationale || '';

      // Break 6 修复：执行安全的 thalamus actions（不只是显示文字）
      const SAFE_CHAT_ACTIONS = ['create_task', 'adjust_priority', 'log_event', 'record_learning'];
      const executedActions = [];
      for (const action of decisionActions) {
        if (SAFE_CHAT_ACTIONS.includes(action.type)) {
          try {
            await executeChatAction(action);
            executedActions.push(action.type);
          } catch (actErr) {
            console.warn(`[orchestrator-chat] Failed to execute ${action.type}:`, actErr.message);
          }
        }
      }

      if (reply && needsEscalation(reply)) {
        reply = reply.replace('[ESCALATE]', '').trim();
        reply += `\n\n[大脑分析] ${rationale}`;
        if (executedActions.length > 0) {
          reply += `\n已执行: ${executedActions.join(', ')}`;
        } else if (actionTypes && actionTypes !== 'no_action') {
          reply += `\n建议动作: ${actionTypes}`;
        }
      } else {
        reply = rationale || '我正在处理你的请求，请稍候。';
        if (executedActions.length > 0) {
          reply += `\n已执行: ${executedActions.join(', ')}`;
        } else if (actionTypes && actionTypes !== 'no_action') {
          reply += `\n建议动作: ${actionTypes}`;
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

/**
 * 执行聊天中 thalamus 返回的安全 action（Break 6 修复）
 * @param {Object} action - { type, params }
 */
async function executeChatAction(action) {
  switch (action.type) {
    case 'create_task': {
      const p = action.params || {};
      await pool.query(`
        INSERT INTO tasks (title, description, priority, task_type, status, trigger_source)
        VALUES ($1, $2, $3, $4, 'queued', 'chat_thalamus')
      `, [p.title || 'Chat-triggered task', p.description || '', p.priority || 'P2', p.task_type || 'research']);
      break;
    }
    case 'adjust_priority': {
      const p = action.params || {};
      if (p.task_id && p.new_priority) {
        await pool.query('UPDATE tasks SET priority = $1 WHERE id = $2', [p.new_priority, p.task_id]);
      }
      break;
    }
    case 'log_event': {
      const p = action.params || {};
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload, created_at)
        VALUES ($1, 'chat_thalamus', $2, NOW())
      `, [p.event_type || 'chat_action', JSON.stringify(p)]);
      break;
    }
    case 'record_learning': {
      const p = action.params || {};
      await pool.query(`
        INSERT INTO learnings (title, category, content, trigger_event)
        VALUES ($1, $2, $3, 'chat_thalamus')
      `, [p.title || 'Chat learning', p.category || 'chat', p.content || '']);
      break;
    }
  }
}

// 导出用于测试
export {
  callMiniMax,
  fetchMemoryContext,
  recordChatEvent,
  needsEscalation,
  buildStatusSummary,
  buildDesiresContext,
  executeChatAction,
  MOUTH_SYSTEM_PROMPT,
};
