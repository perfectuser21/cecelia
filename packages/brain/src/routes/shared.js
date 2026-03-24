import pool from '../db.js';
import { callLLM } from '../llm-caller.js';

// Inlined from deleted orchestrator.js / perception.js
async function getActivePolicy() {
  const result = await pool.query(`SELECT id, version, name, content_json FROM policy WHERE active = true ORDER BY version DESC LIMIT 1`);
  return result.rows[0] || null;
}
async function getWorkingMemory() {
  const result = await pool.query(`SELECT key, value_json FROM working_memory`);
  const memory = {};
  for (const row of result.rows) memory[row.key] = row.value_json;
  return memory;
}
async function getTopTasks(limit = 10) {
  const result = await pool.query(`SELECT id, title, description, priority, status, project_id, queued_at, updated_at, due_at, custom_props FROM tasks WHERE status NOT IN ('completed', 'cancelled') ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC LIMIT $1`, [limit]);
  return result.rows;
}
async function getRecentDecisions(limit = 10) {
  const result = await pool.query(`SELECT id, ts, trigger, input_summary, llm_output_json, action_result_json, status FROM decision_log ORDER BY ts DESC LIMIT $1`, [limit]);
  return result.rows;
}

// Inventory config for decomposition routes
const INVENTORY_CONFIG = { LOW_WATERMARK: 3, TARGET_READY_TASKS: 9, BATCH_SIZE: 3 };

async function getActiveExecutionPaths() {
  // okr_initiatives via okr_scopes → okr_projects (kr_id)
  const result = await pool.query(`
    SELECT oi.id, oi.title AS name, op.kr_id
    FROM okr_initiatives oi
    INNER JOIN okr_scopes os ON os.id = oi.scope_id
    INNER JOIN okr_projects op ON op.id = os.project_id
    WHERE oi.status IN ('active', 'in_progress')
  `);
  return result.rows;
}

// ==================== 白名单配置 ====================

const ALLOWED_ACTIONS = {
  'create-task': {
    required: ['title'],
    optional: ['description', 'priority', 'project_id', 'goal_id', 'tags', 'task_type', 'context']
  },
  'update-task': {
    required: ['task_id'],
    optional: ['status', 'priority']
  },
  'batch-update-tasks': {
    required: ['filter', 'update'],
    optional: []
  },
  'create-goal': {
    required: ['title'],
    optional: ['description', 'priority', 'project_id', 'target_date', 'parent_id']
  },
  'update-goal': {
    required: ['goal_id'],
    optional: ['status', 'progress']
  },
  'set-memory': {
    required: ['key', 'value'],
    optional: []
  },
  'trigger-n8n': {
    required: ['webhook_path'],
    optional: ['data']
  }
};

// ==================== 幂等性检查 ====================

const processedKeys = new Map(); // 内存缓存，生产环境应用 Redis
const IDEMPOTENCY_TTL = 5 * 60 * 1000; // 5 分钟

function checkIdempotency(key) {
  if (!key) return { isDuplicate: false };
  const now = Date.now();
  const existing = processedKeys.get(key);
  if (existing && (now - existing.timestamp) < IDEMPOTENCY_TTL) {
    return { isDuplicate: true, previousResult: existing.result };
  }
  return { isDuplicate: false };
}

function saveIdempotency(key, result) {
  if (!key) return;
  processedKeys.set(key, { timestamp: Date.now(), result });
  for (const [k, v] of processedKeys.entries()) {
    if (Date.now() - v.timestamp > IDEMPOTENCY_TTL) {
      processedKeys.delete(k);
    }
  }
}

// ==================== 内部决策日志 ====================

async function internalLogDecision(trigger, inputSummary, decision, result) {
  await pool.query(`
    INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    trigger || 'orchestrator',
    inputSummary || '',
    decision || {},
    result || {},
    result?.success ? 'success' : 'failed'
  ]);
}

// classifyLearningType - used by tasks route
async function classifyLearningType(content) {
  const VALID_TYPES = ['trap', 'architecture_decision', 'process_improvement', 'failure_pattern', 'best_practice'];
  const prompt = `Classify the following developer learning note into exactly one category.

Categories:
- trap: A gotcha or pitfall that caused unexpected behavior or wasted time
- architecture_decision: A design or architectural choice with rationale
- process_improvement: A better way to run the development process
- failure_pattern: A recurring failure mode or systemic issue
- best_practice: A positive practice worth repeating

Learning note:
${content.slice(0, 600)}

Reply with ONLY one of: ${VALID_TYPES.join(', ')}`;

  try {
    const { text } = await callLLM('fact_extractor', prompt, { timeout: 6000, max_tokens: 20 });
    const normalized = (text || '').toLowerCase().trim();
    return VALID_TYPES.find(t => normalized.includes(t)) || null;
  } catch {
    return null;
  }
}


// resolveRelatedFailureMemories - used by execution and ops routes
export async function resolveRelatedFailureMemories(task_id, db) {
  // 1. 获取任务标题
  const taskRow = await db.query('SELECT title FROM tasks WHERE id = $1', [task_id]);
  if (!taskRow.rows[0]) return;

  const taskTitle = taskRow.rows[0].title;

  // 2. 从标题提取关键词（去掉常见词，取实质词汇）
  const stopWords = new Set(['fix', 'feat', 'add', 'update', 'the', 'a', 'an', 'and', 'or',
    '修复', '添加', '更新', '实现', '优化', '改进', '完成', '任务', '功能']);
  const keywords = taskTitle
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);

  if (keywords.length === 0) return;

  // 3. 在 failure_pattern learnings 中匹配关键词（有 source_memory_id 的才处理）
  const likeConditions = keywords.map((kw, i) => `(l.title ILIKE $${i + 2} OR l.content ILIKE $${i + 2})`);
  const likeParams = keywords.map(kw => `%${kw}%`);

  const learnings = await db.query(
    `SELECT l.id, l.source_memory_id
     FROM learnings l
     WHERE l.category = 'failure_pattern'
       AND l.source_memory_id IS NOT NULL
       AND l.archived = false
       AND (${likeConditions.join(' OR ')})
     LIMIT 10`,
    [task_id, ...likeParams]
  );

  if (learnings.rows.length === 0) {
    console.log(`[closure] No matching failure memories for task=${task_id}`);
    return;
  }

  // 4. 批量标记 memory_stream 为 resolved
  const memIds = learnings.rows.map(r => r.source_memory_id).filter(Boolean);
  if (memIds.length === 0) return;

  const placeholders = memIds.map((_, i) => `$${i + 3}`).join(', ');
  await db.query(
    `UPDATE memory_stream
     SET status = 'resolved',
         resolved_by_task_id = $1,
         resolved_at = NOW()
     WHERE id IN (${placeholders})
       AND status = 'active'`,
    [task_id, task_id, ...memIds]
  );

  console.log(`[closure] Resolved ${memIds.length} failure memories for task=${task_id} (keywords: ${keywords.join(',')})`);
}


export {
  ALLOWED_ACTIONS,
  INVENTORY_CONFIG,
  IDEMPOTENCY_TTL,
  checkIdempotency,
  saveIdempotency,
  internalLogDecision,
  getActivePolicy,
  getWorkingMemory,
  getTopTasks,
  getRecentDecisions,
  getActiveExecutionPaths,
  classifyLearningType,
};
