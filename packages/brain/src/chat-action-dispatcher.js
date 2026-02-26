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

/**
 * 执行检测到的动作，返回追加到 reply 末尾的文本
 * @param {{ type: string, params: Object }} action
 * @returns {Promise<string>}
 */
export async function executeAction(action) {
  if (!action) return '';

  try {
    switch (action.type) {
      case 'CREATE_TASK': {
        const { title } = action.params;
        if (!title) return '\n\n⚠️ 创建任务失败：请提供任务标题';

        const result = await createTask({
          title,
          priority: 'P2',
          task_type: 'research',
          trigger_source: 'chat',
        });

        const dedupNote = result.deduplicated ? '（已存在，跳过重复创建）' : '';
        return `\n\n✅ 已创建任务：${title}${dedupNote}`;
      }

      case 'CREATE_LEARNING': {
        const { title } = action.params;
        if (!title) return '\n\n⚠️ 记录学习失败：请提供学习内容';

        await pool.query(
          `INSERT INTO learnings (title, category, content, trigger_event) VALUES ($1, $2, $3, $4)`,
          [title, 'manual', title, 'chat_action']
        );

        return `\n\n✅ 已记录学习：${title}`;
      }

      case 'QUERY_STATUS': {
        const result = await pool.query(
          `SELECT status, count(*)::int as cnt FROM tasks GROUP BY status ORDER BY status`
        );
        if (result.rows.length === 0) return '\n\n📊 当前暂无任务';
        const lines = result.rows.map(r => `  - ${r.status}: ${r.cnt} 个`).join('\n');
        return `\n\n📊 当前任务统计：\n${lines}`;
      }

      case 'QUERY_GOALS': {
        const result = await pool.query(
          `SELECT title, status, progress FROM goals ORDER BY created_at DESC LIMIT 5`
        );
        if (result.rows.length === 0) return '\n\n📊 暂无 OKR 目标';
        const lines = result.rows.map(r => `  - ${r.title}（${r.status}, ${r.progress}%）`).join('\n');
        return `\n\n📊 OKR 目标：\n${lines}`;
      }

      default:
        return '';
    }
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

// ── LLM 意图执行 ─────────────────────────────────────────

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

    switch (intent) {
      case 'CREATE_TASK': {
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

      case 'CREATE_GOAL': {
        const linked = await linkEntities(llmIntent, message);
        await pool.query(
          `INSERT INTO goals (title, priority, status, progress, project_id) VALUES ($1, $2, 'pending', 0, $3) RETURNING id, title`,
          [title, entities.priority || 'P1', linked.project_id || null]
        );
        return `\n\n✅ 已创建目标：${title}`;
      }

      case 'CREATE_PROJECT': {
        const result = await parseAndCreate(message);
        return formatIntentResult(result);
      }

      case 'LEARN': {
        await pool.query(
          `INSERT INTO learnings (title, category, content, trigger_event) VALUES ($1, $2, $3, $4)`,
          [title, 'user_shared', entities.description || message, 'chat_llm']
        );
        await pool.query(
          `INSERT INTO memory_stream (content, importance, memory_type, expires_at)
           VALUES ($1, 5, 'long', NOW() + INTERVAL '30 days')`,
          [`[学习记录] ${title}`]
        );
        return `\n\n✅ 已记录学习：${title}`;
      }

      case 'RESEARCH': {
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

      case 'QUERY_STATUS': {
        const result = await pool.query(
          `SELECT status, count(*)::int as cnt FROM tasks GROUP BY status ORDER BY status`
        );
        if (result.rows.length === 0) return '\n\n📊 当前暂无任务';
        const lines = result.rows.map(r => `  - ${r.status}: ${r.cnt} 个`).join('\n');
        return `\n\n📊 当前任务统计：\n${lines}`;
      }

      default:
        return null;
    }
  } catch (err) {
    console.warn('[chat-action-dispatcher] LLM intent execution failed:', err.message);
    return null;
  }
}

// ── Intent 管道 ──────────────────────────────────────────

/**
 * 通过 Intent 管道识别并执行动作
 * 使用 parseIntent（模式匹配 + 实体提取，无 LLM 调用）
 */
async function executeViaIntentPipeline(message) {
  try {
    const parsed = await parseIntent(message);

    // 跳过非动作性意图（纯提问、未知）
    if (parsed.intentType === INTENT_TYPES.QUESTION ||
        parsed.intentType === INTENT_TYPES.UNKNOWN) {
      return '';
    }

    // 跳过低置信度（<0.4 大概率是普通聊天）
    if (parsed.confidence < 0.4) {
      return '';
    }

    console.log(`[chat-action-dispatcher] Intent detected: ${parsed.intentType} (confidence: ${parsed.confidence.toFixed(2)})`);

    // QUERY_STATUS → 内联查询
    if (parsed.intentType === INTENT_TYPES.QUERY_STATUS) {
      const result = await pool.query(
        `SELECT status, count(*)::int as cnt FROM tasks GROUP BY status ORDER BY status`
      );
      if (result.rows.length === 0) return '\n\n📊 当前暂无任务';
      const lines = result.rows.map(r => `  - ${r.status}: ${r.cnt} 个`).join('\n');
      return `\n\n📊 当前任务统计：\n${lines}`;
    }

    // CREATE_GOAL → 直接写入 goals 表
    if (parsed.intentType === INTENT_TYPES.CREATE_GOAL) {
      const params = parsed.suggestedAction?.params || {};
      const title = params.title || parsed.projectName;
      const priority = params.priority || 'P1';
      const result = await pool.query(
        `INSERT INTO goals (title, priority, status, progress) VALUES ($1, $2, 'pending', 0) RETURNING id, title`,
        [title, priority]
      );
      return `\n\n✅ 已创建目标：${result.rows[0].title}`;
    }

    // CREATE_TASK / FIX_BUG / REFACTOR → 只创建任务（不创建项目）
    if ([INTENT_TYPES.CREATE_TASK, INTENT_TYPES.FIX_BUG, INTENT_TYPES.REFACTOR].includes(parsed.intentType)) {
      const result = await parseAndCreate(message, { createProject: false });
      return formatIntentResult(result);
    }

    // CREATE_PROJECT / CREATE_FEATURE / EXPLORE → 完整创建（项目 + 任务）
    if ([INTENT_TYPES.CREATE_PROJECT, INTENT_TYPES.CREATE_FEATURE, INTENT_TYPES.EXPLORE].includes(parsed.intentType)) {
      const result = await parseAndCreate(message);
      return formatIntentResult(result);
    }

    return '';
  } catch (err) {
    console.warn('[chat-action-dispatcher] Intent pipeline failed:', err.message);
    return ''; // 静默失败，让 LLM 回复正常返回
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
