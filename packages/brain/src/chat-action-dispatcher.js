/**
 * Chat Action Dispatcher - 对话动作检测与执行
 *
 * 两层检测：
 * 1. 关键词匹配（快速通道，零延迟）
 * 2. Intent 管道（回退，综合模式匹配 + 实体提取）
 *
 * 设计原则：
 * - 关键词匹配优先（无额外 LLM 调用，零延迟）
 * - Intent 管道作为回退（更全面的意图识别，仍无 LLM 调用）
 * - 失败不阻塞回复（catch 后返回空或 ⚠️ 文本）
 * - 结果追加到 reply 末尾（"\n\n✅ xxx"）
 */

import pool from './db.js';
import { createTask } from './actions.js';
import { parseIntent, parseAndCreate, INTENT_TYPES } from './intent.js';
import { linkEntities } from './entity-linker.js';
import { addSource } from './notebook-adapter.js';
import crypto from 'crypto';

/**
 * 动作触发规则表
 * patterns: 正则列表，任一匹配即触发
 * extract:  从消息中提取参数，返回 null 表示匹配但参数不足（跳过）
 */
const ACTION_PATTERNS = [
  {
    type: 'CREATE_TASK',
    patterns: [
      /帮我记.{0,2}任务[：:]/u,
      /新建任务[：:]/u,
      /加个\s*[tT]ask[：:]/u,
      /创建任务[：:]/u,
      /记一个任务[：:]/u,
    ],
    extract: (msg) => {
      const m = msg.match(/(?:帮我记.{0,2}任务|新建任务|加个\s*task|创建任务|记一个任务)[：:]\s*(.+)/iu);
      return m ? { title: m[1].trim() } : null;
    },
  },
  {
    type: 'CREATE_LEARNING',
    patterns: [
      /记录学习[：:]/u,
      /记一条学习[：:]/u,
      /总结学习[：:]/u,
      /学到了[：:]/u,
      /记学习[：:]/u,
    ],
    extract: (msg) => {
      const m = msg.match(/(?:记录学习|记一条学习|总结学习|学到了|记学习)[：:]\s*(.+)/iu);
      return m ? { title: m[1].trim() } : null;
    },
  },
  {
    type: 'QUERY_STATUS',
    patterns: [
      /任务状态/u,
      /现在有几个任务/u,
      /查一下任务/u,
      /有多少任务/u,
      /任务统计/u,
    ],
    extract: () => ({}),
  },
  {
    type: 'QUERY_GOALS',
    patterns: [
      /OKR\s*进度/ui,
      /目标进度/u,
      /有哪些OKR/ui,
      /当前OKR/ui,
    ],
    extract: () => ({}),
  },
];

/**
 * 检测用户消息中的动作意图
 * @param {string} message - 用户消息
 * @returns {{ type: string, params: Object } | null}
 */
export function detectAction(message) {
  if (!message || typeof message !== 'string') return null;

  for (const rule of ACTION_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        const params = rule.extract(message);
        if (params !== null) {
          return { type: rule.type, params };
        }
      }
    }
  }

  return null;
}

// ── executeAction 子函数 ──────────────────────────────────

async function execCreateTask(params) {
  const { title } = params;
  if (!title) return '\n\n⚠️ 创建任务失败：请提供任务标题';
  const result = await createTask({ title, priority: 'P2', task_type: 'research', trigger_source: 'chat' });
  const dedupNote = result.deduplicated ? '（已存在，跳过重复创建）' : '';
  return `\n\n✅ 已创建任务：${title}${dedupNote}`;
}

async function execCreateLearning(params) {
  const { title } = params;
  if (!title) return '\n\n⚠️ 记录学习失败：请提供学习内容';
  const clHash = crypto.createHash('sha256').update(`${title}\n${title}`).digest('hex').slice(0, 16);
  const clExisting = await pool.query(
    'SELECT id, version FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
    [clHash]
  );
  if (clExisting.rows.length > 0) {
    const eid = clExisting.rows[0].id;
    const nv = (clExisting.rows[0].version || 1) + 1;
    await pool.query('UPDATE learnings SET version = $1 WHERE id = $2', [nv, eid]);
    return `\n\n✅ 已更新学习记录（第 ${nv} 版）：${title}`;
  }
  await pool.query(
    `INSERT INTO learnings (title, category, content, trigger_event, content_hash, version, is_latest)
     VALUES ($1, $2, $3, $4, $5, 1, true)`,
    [title, 'manual', title, 'chat_action', clHash]
  );
  return `\n\n✅ 已记录学习：${title}`;
}

async function execQueryStatus() {
  const result = await pool.query(
    `SELECT status, count(*)::int as cnt FROM tasks GROUP BY status ORDER BY status`
  );
  if (result.rows.length === 0) return '\n\n📊 当前暂无任务';
  const lines = result.rows.map(r => `  - ${r.status}: ${r.cnt} 个`).join('\n');
  return `\n\n📊 当前任务统计：\n${lines}`;
}

async function execQueryGoals() {
  const result = await pool.query(
    `SELECT title, status, progress FROM goals ORDER BY created_at DESC LIMIT 5`
  );
  if (result.rows.length === 0) return '\n\n📊 暂无 OKR 目标';
  const lines = result.rows.map(r => `  - ${r.title}（${r.status}, ${r.progress}%）`).join('\n');
  return `\n\n📊 OKR 目标：\n${lines}`;
}

const ACTION_EXEC_HANDLERS = {
  CREATE_TASK:     (params) => execCreateTask(params),
  CREATE_LEARNING: (params) => execCreateLearning(params),
  QUERY_STATUS:    ()       => execQueryStatus(),
  QUERY_GOALS:     ()       => execQueryGoals(),
};

/**
 * 执行检测到的动作，返回追加到 reply 末尾的文本
 * @param {{ type: string, params: Object }} action
 * @returns {Promise<string>}
 */
export async function executeAction(action) {
  if (!action) return '';
  try {
    const handler = ACTION_EXEC_HANDLERS[action.type];
    if (!handler) return '';
    return await handler(action.params || {});
  } catch (err) {
    console.warn('[chat-action-dispatcher] Action execution failed:', err.message);
    return `\n\n⚠️ 操作执行时遇到问题：${err.message}`;
  }
}

/**
 * 检测并执行动作（对外统一入口）
 *
 * 三层检测：
 * 1. 关键词匹配 → 直接执行（快速通道）
 * 2. LLM 意图 → 当 llmIntent 存在且类型明确时直接执行
 * 3. Intent 管道 → parseIntent + parseAndCreate（回退）
 *
 * @param {string} message - 用户消息
 * @param {Object|null} llmIntent - LLM 解析的意图（可选）
 * @returns {Promise<string>} 追加到 reply 末尾的文本，无动作时返回 ''
 */
export async function detectAndExecuteAction(message, llmIntent = null) {
  // Layer 1: 关键词快速通道（零延迟）
  const action = detectAction(message);
  if (action) return executeAction(action);

  // Layer 2: LLM 意图直接执行（当有 llmIntent 且类型明确时）
  if (llmIntent && llmIntent.intent && llmIntent.confidence >= 0.5) {
    const result = await executeViaLlmIntent(message, llmIntent);
    if (result) return result;
  }

  // Layer 3: Intent 管道回退（综合模式匹配）
  return executeViaIntentPipeline(message);
}

// ── LLM 意图执行（子函数） ────────────────────────────────

async function handleLlmCreateTask(title, entities, llmIntent, message) {
  const linked = await linkEntities(llmIntent, message);
  const result = await createTask({
    title,
    description: entities.description || message,
    priority: entities.priority || 'P2',
    task_type: 'research',
    trigger_source: 'chat_llm',
    ...(linked.goal_id && { goal_id: linked.goal_id }),
    ...(linked.project_id && { project_id: linked.project_id }),
  });
  const dedupNote = result.deduplicated ? '（已存在，跳过重复创建）' : '';
  const linkNote = linked.goal_id || linked.project_id ? '（已关联到 OKR/项目）' : '';
  return `\n\n✅ 已创建任务：${title}${dedupNote}${linkNote}`;
}

async function handleLlmCreateGoal(title, entities, llmIntent, message) {
  const linked = await linkEntities(llmIntent, message);
  await pool.query(
    `INSERT INTO goals (title, priority, status, progress, project_id) VALUES ($1, $2, 'pending', 0, $3) RETURNING id, title`,
    [title, entities.priority || 'P1', linked.project_id || null]
  );
  return `\n\n✅ 已创建目标：${title}`;
}

async function triggerUrlResearch(url, title) {
  try {
    await addSource(url);
    const { queryNotebook } = await import('./notebook-adapter.js');
    const nbResult = await queryNotebook(`总结这个资源的核心内容和关键要点：${title}`);
    if (nbResult.ok && nbResult.text) {
      await pool.query(
        `INSERT INTO memory_stream (content, importance, memory_type, expires_at)
         VALUES ($1, 7, 'long', NOW() + INTERVAL '30 days')`,
        [`[研究完成] ${title}\n${nbResult.text.slice(0, 500)}`]
      );
    }
  } catch (researchErr) {
    console.warn('[chat-action-dispatcher] async research failed:', researchErr.message);
  }
}

async function handleLlmLearn(title, entities, message) {
  const learnContent = entities.description || message;
  const learnHash = crypto.createHash('sha256').update(`${title}\n${learnContent}`).digest('hex').slice(0, 16);
  const existingLearn = await pool.query(
    'SELECT id, version FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
    [learnHash]
  );

  if (existingLearn.rows.length > 0) {
    const eid = existingLearn.rows[0].id;
    const nv = (existingLearn.rows[0].version || 1) + 1;
    await pool.query('UPDATE learnings SET version = $1 WHERE id = $2', [nv, eid]);
    return `\n\n✅ 已更新学习记录（第 ${nv} 版）：${title}`;
  }

  await pool.query(
    `INSERT INTO learnings (title, category, content, trigger_event, digested, content_hash, version, is_latest)
     VALUES ($1, $2, $3, $4, false, $5, 1, true)`,
    [title, 'user_shared', learnContent, 'chat_llm', learnHash]
  );
  await pool.query(
    `INSERT INTO memory_stream (content, importance, memory_type, expires_at)
     VALUES ($1, 5, 'long', NOW() + INTERVAL '30 days')`,
    [`[学习记录] ${title}`]
  );

  const urlMatch = message.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    // 异步研究流：前台秒回，后台 NotebookLM 研究
    triggerUrlResearch(urlMatch[0], title).catch(e => console.warn('[chat-action-dispatcher] triggerUrlResearch unhandled:', e.message));
  }
  return `\n\n✅ 已记录学习：${title}${urlMatch ? '\n📚 已启动后台研究，结果稍后自动整理。' : ''}`;
}

async function handleLlmResearch(title, entities, llmIntent, message) {
  const linked = await linkEntities(llmIntent, message);
  const result = await createTask({
    title: `[研究] ${title}`,
    description: `用户请求研究：${message}`,
    priority: entities.priority || 'P2',
    task_type: 'research',
    trigger_source: 'chat_llm',
    ...(linked.goal_id && { goal_id: linked.goal_id }),
    ...(linked.project_id && { project_id: linked.project_id }),
  });
  const dedupNote = result.deduplicated ? '（已存在）' : '';
  return `\n\n✅ 已创建研究任务：${title}${dedupNote}\n将在下个调度周期派发给合适的 agent。`;
}

async function handleLlmQueryStatus() {
  const result = await pool.query(
    `SELECT status, count(*)::int as cnt FROM tasks GROUP BY status ORDER BY status`
  );
  if (result.rows.length === 0) return '\n\n📊 当前暂无任务';
  const lines = result.rows.map(r => `  - ${r.status}: ${r.cnt} 个`).join('\n');
  return `\n\n📊 当前任务统计：\n${lines}`;
}

// ── LLM 意图分发器 ────────────────────────────────────────

const LLM_INTENT_HANDLERS = {
  CREATE_TASK:    (title, entities, llmIntent, message) => handleLlmCreateTask(title, entities, llmIntent, message),
  CREATE_GOAL:    (title, entities, llmIntent, message) => handleLlmCreateGoal(title, entities, llmIntent, message),
  CREATE_PROJECT: (_title, _entities, _llmIntent, message) => parseAndCreate(message).then(formatIntentResult),
  LEARN:          (title, entities, _llmIntent, message) => handleLlmLearn(title, entities, message),
  RESEARCH:       (title, entities, llmIntent, message) => handleLlmResearch(title, entities, llmIntent, message),
  QUERY_STATUS:   () => handleLlmQueryStatus(),
};

/**
 * 通过 LLM 解析的意图执行动作
 * @param {string} message - 原始消息
 * @param {Object} llmIntent - {intent, confidence, entities, summary}
 * @returns {Promise<string|null>} 操作结果文本，或 null（不处理）
 */
async function executeViaLlmIntent(message, llmIntent) {
  try {
    const { intent, entities = {}, summary } = llmIntent;
    const title = summary || entities.title || message.slice(0, 80);
    const handler = LLM_INTENT_HANDLERS[intent];
    if (!handler) return null;
    return await handler(title, entities, llmIntent, message);
  } catch (err) {
    console.warn('[chat-action-dispatcher] LLM intent execution failed:', err.message);
    return null;
  }
}

// ── Intent 管道 ──────────────────────────────────────────

async function pipelineQueryStatus() {
  const result = await pool.query(
    `SELECT status, count(*)::int as cnt FROM tasks GROUP BY status ORDER BY status`
  );
  if (result.rows.length === 0) return '\n\n📊 当前暂无任务';
  const lines = result.rows.map(r => `  - ${r.status}: ${r.cnt} 个`).join('\n');
  return `\n\n📊 当前任务统计：\n${lines}`;
}

async function pipelineCreateGoal(parsed) {
  const params = parsed.suggestedAction?.params || {};
  const title = params.title || parsed.projectName;
  const priority = params.priority || 'P1';
  const result = await pool.query(
    `INSERT INTO goals (title, priority, status, progress) VALUES ($1, $2, 'pending', 0) RETURNING id, title`,
    [title, priority]
  );
  return `\n\n✅ 已创建目标：${result.rows[0].title}`;
}

async function pipelineTaskAction(message) {
  const result = await parseAndCreate(message, { createProject: false });
  return formatIntentResult(result);
}

async function pipelineProjectAction(message) {
  const result = await parseAndCreate(message);
  return formatIntentResult(result);
}

const PIPELINE_HANDLERS = {
  [INTENT_TYPES.QUERY_STATUS]:    (_parsed, _msg)    => pipelineQueryStatus(),
  [INTENT_TYPES.CREATE_GOAL]:     (parsed,  _msg)    => pipelineCreateGoal(parsed),
  [INTENT_TYPES.CREATE_TASK]:     (_parsed, message) => pipelineTaskAction(message),
  [INTENT_TYPES.FIX_BUG]:        (_parsed, message) => pipelineTaskAction(message),
  [INTENT_TYPES.REFACTOR]:        (_parsed, message) => pipelineTaskAction(message),
  [INTENT_TYPES.CREATE_PROJECT]:  (_parsed, message) => pipelineProjectAction(message),
  [INTENT_TYPES.CREATE_FEATURE]:  (_parsed, message) => pipelineProjectAction(message),
  [INTENT_TYPES.EXPLORE]:         (_parsed, message) => pipelineProjectAction(message),
};

/**
 * 通过 Intent 管道识别并执行动作
 * 使用 parseIntent（模式匹配 + 实体提取，无 LLM 调用）
 */
async function executeViaIntentPipeline(message) {
  try {
    const parsed = await parseIntent(message);
    if (parsed.intentType === INTENT_TYPES.QUESTION || parsed.intentType === INTENT_TYPES.UNKNOWN) return '';
    if (parsed.confidence < 0.4) return '';
    console.log(`[chat-action-dispatcher] Intent detected: ${parsed.intentType} (confidence: ${parsed.confidence.toFixed(2)})`);
    const handler = PIPELINE_HANDLERS[parsed.intentType];
    if (!handler) return '';
    return await handler(parsed, message);
  } catch (err) {
    console.warn('[chat-action-dispatcher] Intent pipeline failed:', err.message);
    return '';
  }
}

/**
 * 格式化 Intent 管道执行结果为用户可读文本
 */
function formatIntentResult(result) {
  const { created } = result;
  const parts = [];

  if (created.project) {
    if (created.project.created) {
      parts.push(`📁 已创建项目：${created.project.name}`);
    } else {
      parts.push(`📁 关联到已有项目：${created.project.name}`);
    }
  }

  if (created.tasks.length > 0) {
    parts.push(`📋 已创建 ${created.tasks.length} 个任务：`);
    for (const task of created.tasks) {
      parts.push(`  - ${task.title}（${task.priority}）`);
    }
  }

  if (parts.length === 0) return '';
  return '\n\n' + parts.join('\n');
}
