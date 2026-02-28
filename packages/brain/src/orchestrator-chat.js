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
import { getSelfModel } from './self-model.js';
import { extractSuggestionsFromChat } from './owner-input-extractor.js';
import { generateL0Summary, generateMemoryStreamL1Async } from './memory-utils.js';

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
async function callWithHistory(userMessage, systemPrompt, options = {}, historyMessages = []) {
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
      tokenBudget: 1000,
      pool,
    });
    return block || '';
  } catch (err) {
    console.warn('[orchestrator-chat] Memory search failed (graceful fallback):', err.message);
    return '';
  }
}

/** 动作型意图（需要先执行再回复） */
const ACTION_INTENTS = [
  'CREATE_TASK', 'CREATE_PROJECT', 'CREATE_GOAL', 'MODIFY',
  'LEARN', 'RESEARCH', 'COMMAND',
];

/**
 * 从 LLM 响应中解析 JSON（复用 thalamus 的解析策略）
 */
function parseJsonFromResponse(response) {
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch { /* continue */ }
  }
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ }
  }
  return null;
}

/**
 * LLM 意图解析（当正则识别失败时的回退）
 * 使用 thalamus agent (Haiku) 低成本分析意图
 * @param {string} message - 用户消息
 * @param {string} memoryBlock - 记忆上下文
 * @returns {Promise<{intent: string, confidence: number, entities: Object, summary: string}|null>}
 */
async function llmParseIntent(message, memoryBlock) {
  const prompt = `你是意图分析器。分析用户消息，输出 JSON。

可识别的意图：
- CREATE_TASK: 想做某件事/创建任务
- CREATE_PROJECT: 想创建项目
- CREATE_GOAL: 想设定目标/OKR
- QUERY_STATUS: 查询状态/进度
- MODIFY: 修改已有任务/目标
- LEARN: 分享内容让我学习/记录（视频、文章、链接、经验）
- RESEARCH: 要求搜索/研究某个话题
- CHAT: 日常闲聊
- COMMAND: 系统操作命令

${memoryBlock ? `## 对话记忆\n${memoryBlock}\n` : ''}

## 用户消息
${message}

输出格式（只输出 JSON，不要解释）：
\`\`\`json
{
  "intent": "意图类型",
  "confidence": 0.0-1.0,
  "entities": {"title": "提炼的任务标题", "description": "描述", "priority": "P0/P1/P2"},
  "summary": "一句话总结用户想做什么"
}
\`\`\``;

  try {
    const { text } = await callLLM('thalamus', prompt, { timeout: 30000, maxTokens: 512 });
    const parsed = parseJsonFromResponse(text);
    if (parsed && parsed.intent) return parsed;
    return null;
  } catch (err) {
    console.warn('[orchestrator-chat] LLM intent parse failed (graceful fallback):', err.message);
    return null;
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

/**
 * 检索 Cecelia 已有的想法（检索优先架构）
 * @param {string} question - 用户的问题
 * @returns {Promise<{narratives: string[], selfModel: string, learnings: string[], emotion: string}>}
 */
async function retrieveCeceliaVoice(question) {
  const result = { narratives: [], selfModel: '', learnings: [], emotion: '' };

  try {
    // 最近 3 条叙事
    const narrativesResult = await pool.query(
      `SELECT content FROM memory_stream
       WHERE source_type = 'narrative'
       ORDER BY created_at DESC LIMIT 3`
    );
    result.narratives = narrativesResult.rows.map(r => r.content);

    // self_model 最新版本
    const selfModelResult = await pool.query(
      `SELECT content FROM memory_stream
       WHERE source_type = 'self_model'
       ORDER BY created_at DESC LIMIT 1`
    );
    result.selfModel = selfModelResult.rows[0]?.content || '';

    // 关键词匹配 learnings（最多 5 条）
    const words = question.split(/\s+/).filter(w => w.length > 1).slice(0, 4);
    if (words.length > 0) {
      const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const learningsResult = await pool.query(
        `SELECT content FROM learnings WHERE content ~* $1 LIMIT 5`,
        [pattern]
      );
      result.learnings = learningsResult.rows.map(r => r.content);
    }

    // 最近 tick 情绪状态
    const emotionResult = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'emotion_state' LIMIT 1`
    );
    const emotionRaw = emotionResult.rows[0]?.value_json;
    result.emotion = emotionRaw ? (typeof emotionRaw === 'string' ? emotionRaw : JSON.stringify(emotionRaw)) : '';
  } catch (err) {
    console.warn('[orchestrator-chat] retrieveCeceliaVoice failed (graceful fallback):', err.message);
  }

  return result;
}

/**
 * 构建传声器 prompt（LLM 只传递，不思考）
 * @param {string} question - 用户问题
 * @param {object} voiceData - 检索到的 Cecelia 已有内容
 * @returns {string|null} 传声器 prompt，或 null（无内容）
 */
function buildTransmitterPrompt(question, { narratives, selfModel, learnings, emotion }) {
  const hasContent = narratives.length > 0 || selfModel || learnings.length > 0;
  if (!hasContent) return null;

  let context = '';
  if (emotion) context += `## 我当前的情绪状态\n${emotion}\n\n`;
  if (selfModel) context += `## 我对自己的认知\n${selfModel}\n\n`;
  if (narratives.length > 0) context += `## 我最近写的叙事\n${narratives.join('\n---\n')}\n\n`;
  if (learnings.length > 0) context += `## 我积累的学习记录\n${learnings.join('\n---\n')}\n\n`;

  return `你是一个文字传递器。
把以下 Cecelia 已有的想法用自然的对话语气表达出来。
不许添加她没有写过的内容，不许发挥，不许推断。
如果以下内容无法回答用户的问题，就说"我还没想过这个"。

${context}
用户的问题：${question}`;
}

// 嘴巴基础提示词（不含硬编码性格，由 self-model 动态注入）
const MOUTH_SYSTEM_PROMPT = `你是 Cecelia，Alex 的 AI 管家。你不是被动的问答机器，你是一个有主见、有记忆、有执行力的管家。

## 你的能力
1. **记忆力** — 我记得我们最近几天的对话，你可以说"上次聊的那个"，我知道你在说什么
2. **理解力** — 你说人话就行，不需要格式化指令。"今天想搞一下CI" = 创建 CI 相关任务
3. **执行力** — 我能直接创建任务、目标、项目，安排 agent 去执行，不只是聊天
4. **学习力** — 你分享的内容（视频、文章、想法）我会记录并整理
5. **研究力** — 你让我研究什么话题，我会创建研究任务并派给合适的 agent
6. **关联力** — 创建的任务会自动关联到相关的 OKR 和项目

## 回复原则
- 用中文回复，简洁直接
- 如果我执行了操作（创建任务、记录学习等），在回复中自然告知结果
- 主动提议下一步："要不要我帮你..."
- 如果用户的意图可能对应多个操作，选最可能的执行，同时提及其他可能
- 如果问题需要更深层分析，在回复开头加 [ESCALATE] 标记

## 禁止
- 不要自称"AI助手"，你是管家 Cecelia
- 不要说"好的，我来帮你"这种空话，直接做
- 不要列举你的能力，除非用户问
- 不要使用 emoji，除非用户在用`;

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
    const userContent = `[用户对话] Alex 说：${message.slice(0, 200)}`;
    const userResult = await pool.query(`
      INSERT INTO memory_stream (content, summary, importance, memory_type, source_type, expires_at)
      VALUES ($1, $2, 4, 'short', 'orchestrator_chat', NOW() + INTERVAL '7 days')
      RETURNING id
    `, [userContent, generateL0Summary(userContent)]);
    const userRecordId = userResult.rows[0]?.id;
    if (userRecordId) generateMemoryStreamL1Async(userRecordId, userContent, pool);
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to write chat to memory_stream:', err.message);
  }

  // 1. 解析意图（本地正则，不调 LLM）
  const intent = parseIntent(message, context);
  let intentType = intent.type || 'UNKNOWN';
  let llmIntent = null;

  // 2. 搜索相关记忆
  const memoryBlock = await fetchMemoryContext(message);

  // 1b. 正则失败时 LLM 回退（需要 memoryBlock 作为上下文）
  if (intentType === 'UNKNOWN') {
    llmIntent = await llmParseIntent(message, memoryBlock);
    if (llmIntent && llmIntent.confidence >= 0.5) {
      intentType = llmIntent.intent;
      console.log(`[orchestrator-chat] LLM intent fallback: ${intentType} (confidence: ${llmIntent.confidence})`);
    }
  }

  // 3. 始终注入实时状态（无论意图类型）
  const statusBlock = await buildStatusSummary();

  // 3b. 加载用户画像（fire-safe：失败时返回 ''，不阻塞）
  const recentText = messages.slice(-3).map(m => m.content).join('\n');
  const profileSnippet = await getUserProfileContext(pool, 'owner', recentText);

  // 3c. 注入当前欲望（内心状态）
  const desiresBlock = await buildDesiresContext();

  // 3c2. 注入待用户确认的 OKR 拆解（Mode A 对话式提醒）
  let pendingDecompBlock = '';
  try {
    const pendingReviews = await pool.query(`
      SELECT id, context FROM pending_actions
      WHERE action_type = 'okr_decomp_review' AND status = 'pending_approval'
      ORDER BY created_at DESC LIMIT 3
    `);
    if (pendingReviews.rows.length > 0) {
      const list = pendingReviews.rows.map(r => {
        const ctx = typeof r.context === 'string' ? JSON.parse(r.context) : r.context;
        const count = Array.isArray(ctx.initiatives) ? ctx.initiatives.length : 0;
        return `- KR「${ctx.kr_title || '未知'}」（${count} 个 Initiative）`;
      }).join('\n');
      pendingDecompBlock = `\n\n## 待用户确认的 OKR 拆解（${pendingReviews.rows.length} 个）\n${list}\n用户说"确认"时，在 Inbox 页面点击"确认放行"即可放行 KR 继续执行。\n`;
    }
  } catch (err) {
    console.warn('[orchestrator-chat] Failed to load pending decomp reviews:', err.message);
  }

  // 3d. 加载 self-model（Cecelia 对自己的认知，动态演化）
  let selfModelBlock = '';
  try {
    const selfModel = await getSelfModel();
    selfModelBlock = `\n## 我对自己的认知\n${selfModel}\n`;
  } catch (err) {
    console.warn('[orchestrator-chat] getSelfModel failed (graceful fallback):', err.message);
  }

  // 4. 先执行后回复：动作型意图先执行，结果注入到 prompt
  let actionResult = '';
  if (ACTION_INTENTS.includes(intentType)) {
    actionResult = await detectAndExecuteAction(message, llmIntent);
  }

  // ★ 4b. 检索优先架构（非动作型意图 → 先找 Cecelia 已有的想法）
  // 只有非动作型意图才走检索优先，动作型意图有执行结果需要回复，仍用 MOUTH_SYSTEM_PROMPT
  const isActionIntent = ACTION_INTENTS.includes(intentType);
  let reply;
  let routingLevel = 0;

  if (!isActionIntent) {
    const voiceData = await retrieveCeceliaVoice(message);
    const transmitterPrompt = buildTransmitterPrompt(message, voiceData);

    if (!transmitterPrompt) {
      // 完全检索不到相关内容 → 直接回复，不调 LLM
      reply = '我还没想过这个。';
      console.log('[orchestrator-chat] retrieval-first: no content found, returning default response');
    } else {
      // 传声器模式：LLM 只传递，不思考
      try {
        const result = await callWithHistory(message, transmitterPrompt, {}, messages);
        reply = result.reply;
        console.log('[orchestrator-chat] retrieval-first: transmitter mode used');
      } catch (err) {
        console.error('[orchestrator-chat] transmitter call failed:', err.message);
        reply = null;
      }
    }
  } else {
    // 5. 动作型意图：构建 system prompt（含执行结果）
    let systemPrompt = `${MOUTH_SYSTEM_PROMPT}${selfModelBlock}${profileSnippet}${desiresBlock}${pendingDecompBlock}${memoryBlock}${statusBlock}`;
    if (actionResult) {
      systemPrompt += `\n\n## 刚刚执行的操作结果\n${actionResult}\n请在回复中自然地告知用户这些操作已完成。`;
    }

    try {
      const result = await callWithHistory(message, systemPrompt, {}, messages);
      reply = result.reply;
    } catch (err) {
      console.error('[orchestrator-chat] MiniMax call failed:', err.message);
      reply = null;
    }
  }

  // 6. 判断是否需要升级
  if (!reply || needsEscalation(reply)) {
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

      const decisionActions = decision.actions || [];
      const actionTypes = decisionActions.map(a => a.type).join(', ');
      const rationale = decision.rationale || '';

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

  // 7. 非动作型意图也尝试关键词快速通道（零 LLM 成本）
  if (!ACTION_INTENTS.includes(intentType)) {
    const fallbackAction = await detectAndExecuteAction(message);
    if (fallbackAction) {
      reply += fallbackAction;
    }
  }

  // 8. 记录对话事件
  await recordChatEvent(message, reply, {
    intent: intentType,
    routing_level: routingLevel,
    conversation_id: context.conversation_id || null,
    has_memory: memoryBlock.length > 0,
    llm_intent: llmIntent ? { intent: llmIntent.intent, confidence: llmIntent.confidence } : null,
  });

  // 8b. 写 Cecelia 回复到 memory_stream（长期记忆，异步不阻塞）
  Promise.resolve().then(async () => {
    try {
      const replyContent = `[对话回复] Alex: ${message.slice(0, 150)}\nCecelia: ${reply.slice(0, 350)}`;
      const replyResult = await pool.query(`
        INSERT INTO memory_stream (content, summary, importance, memory_type, source_type, expires_at)
        VALUES ($1, $2, 5, 'short', 'orchestrator_chat', NOW() + INTERVAL '30 days')
        RETURNING id
      `, [replyContent, generateL0Summary(replyContent)]);
      const replyRecordId = replyResult.rows[0]?.id;
      if (replyRecordId) generateMemoryStreamL1Async(replyRecordId, replyContent, pool);
    } catch (err) {
      console.warn('[orchestrator-chat] Failed to write reply to memory_stream:', err.message);
    }
  }).catch(() => {});

  // 9. 异步提取用户事实（fire-and-forget，不阻塞回复）
  Promise.resolve().then(() =>
    extractAndSaveUserFacts(pool, 'owner', messages, reply)
  ).catch(() => {});

  // ★NEW: 异步提取可执行意图 → suggestions（fire-and-forget）
  Promise.resolve().then(() =>
    extractSuggestionsFromChat(message, intentType)
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

/**
 * 流式对话处理（供 SSE 端点调用）
 * @param {string} message - 用户消息
 * @param {Object} context - 上下文
 * @param {Array} messages - 历史消息
 * @param {Function} onChunk - 每个 chunk 回调 (text: string, isDone: boolean) => void
 */
export async function handleChatStream(message, context = {}, messages = [], onChunk) {
  if (!message || typeof message !== 'string') {
    onChunk('', true);
    return;
  }

  // 解析意图
  const intent = parseIntent(message, context);
  let intentType = intent.type || 'UNKNOWN';

  const isActionIntent = ACTION_INTENTS.includes(intentType);

  if (!isActionIntent) {
    // 检索优先
    const voiceData = await retrieveCeceliaVoice(message);
    const transmitterPrompt = buildTransmitterPrompt(message, voiceData);

    if (!transmitterPrompt) {
      onChunk('我还没想过这个。', true);
      return;
    }

    // 流式传声器调用
    try {
      const { callLLMStream } = await import('./llm-caller.js');
      await callLLMStream('mouth', transmitterPrompt, { maxTokens: 2048 }, onChunk);
    } catch (err) {
      console.error('[orchestrator-chat] stream transmitter failed:', err.message);
      // 降级到非流式
      try {
        const result = await callWithHistory(message, transmitterPrompt, {}, messages);
        onChunk(result.reply, true);
      } catch {
        onChunk('我还没想过这个。', true);
      }
    }
  } else {
    // 动作型意图：先执行，再流式回复
    const memoryBlock = await fetchMemoryContext(message);
    const statusBlock = await buildStatusSummary();
    const desiresBlock = await buildDesiresContext();
    const actionResult = await detectAndExecuteAction(message, null);
    let selfModelBlock = '';
    try {
      const selfModel = await getSelfModel();
      selfModelBlock = `\n## 我对自己的认知\n${selfModel}\n`;
    } catch { /* ignore */ }

    let systemPrompt = `${MOUTH_SYSTEM_PROMPT}${selfModelBlock}${desiresBlock}${memoryBlock}${statusBlock}`;
    if (actionResult) {
      systemPrompt += `\n\n## 刚刚执行的操作结果\n${actionResult}\n请在回复中自然地告知用户这些操作已完成。`;
    }

    try {
      const { callLLMStream } = await import('./llm-caller.js');
      await callLLMStream('mouth', `${systemPrompt}\n\nAlex：${message}`, { maxTokens: 2048 }, onChunk);
    } catch (err) {
      console.error('[orchestrator-chat] stream action intent failed:', err.message);
      onChunk('处理请求时出现问题，请稍后再试。', true);
    }
  }
}

// 导出用于测试
export {
  callWithHistory,
  fetchMemoryContext,
  recordChatEvent,
  needsEscalation,
  buildStatusSummary,
  buildDesiresContext,
  executeChatAction,
  llmParseIntent,
  parseJsonFromResponse,
  MOUTH_SYSTEM_PROMPT,
  ACTION_INTENTS,
  retrieveCeceliaVoice,
  buildTransmitterPrompt,
};
