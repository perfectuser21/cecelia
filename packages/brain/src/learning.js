/**
 * Learning Loop - Brain self-improvement system
 *
 * Implements the learning closed loop:
 * 1. Detect systemic failures
 * 2. Trigger Cortex RCA analysis
 * 3. Generate strategy adjustments
 * 4. Apply adjustments to brain_config
 * 5. Record learnings for future reference
 */

import crypto from 'crypto';
import pool from './db.js';
import { createTask } from './actions.js';
import { generateLearningEmbeddingAsync } from './embedding-service.js';
import { generateL0Summary } from './memory-utils.js';
import { callLLM } from './llm-caller.js';
import { pushCaptureAtom } from './capture-inbox.js';



// T9 噪音类目黑名单：事件层记录（与 tasks 表信息重复）不配进 learnings 原子准则层账本。
// 真实拦截点在 auto-learning.js createAutoLearning；recordLearning 入口守卫是纵深防御
//（其 category 当前硬编码 failure_pattern，正常不触发）。
export const NOISE_LEARNING_CATEGORIES = ['task_completion'];

export function isNoiseLearningCategory(category) {
  return NOISE_LEARNING_CATEGORIES.includes(category);
}

/**
 * Record learning from Cortex RCA analysis
 * @param {Object} analysis - RCA analysis result from Cortex
 * @param {string} analysis.task_id - Task that triggered learning
 * @param {Object} analysis.analysis - RCA analysis content
 * @param {Array} analysis.learnings - Learning points
 * @param {Array} analysis.recommended_actions - Recommended actions
 * @returns {Promise<Object>} - Created learning record
 */
export async function recordLearning(analysis) {
  const { task_id, analysis: rcaAnalysis, learnings, recommended_actions } = analysis;

  // Extract strategy adjustments from recommended actions
  const strategyAdjustments = recommended_actions?.filter(
    action => action.type === 'adjust_strategy'
  ) || [];

  const title = `RCA Learning: ${rcaAnalysis.root_cause?.slice(0, 100)}`;
  const category = 'failure_pattern';
  if (isNoiseLearningCategory(category)) {
    console.log(`[learning] Skipping noise category learning: ${category}`);
    return null;
  }
  const triggerEvent = 'systemic_failure';

  const content = JSON.stringify({
    root_cause: rcaAnalysis.root_cause,
    contributing_factors: rcaAnalysis.contributing_factors,
    learnings,
  });

  try {
    // 计算 content_hash 进行去重
    const hashInput = `${title}\n${content}`;
    const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

    // 检查是否已存在相同 hash 的记录
    const existing = await pool.query(
      'SELECT id, version FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
      [contentHash]
    );

    if (existing.rows.length > 0) {
      // 已存在：更新版本号，不重复插入
      const existingId = existing.rows[0].id;
      const newVersion = (existing.rows[0].version || 1) + 1;
      await pool.query(
        'UPDATE learnings SET version = $1, metadata = metadata || $2, created_at = NOW() WHERE id = $3',
        [newVersion, JSON.stringify({ last_duplicate_at: new Date().toISOString() }), existingId]
      );
      console.log(`[learning] Deduplicated: existing=${existingId} version=${newVersion}`);
      return existing.rows[0];
    }

    // task_id 防御层（migration 271）：RCA learning 必须带 task_id（触发的 task）
    // 缺失即告警，便于回溯 Insight-to-Action 断裂
    if (!task_id) {
      console.warn(`[learning] recordLearning called without task_id (title="${title.slice(0, 60)}") — RCA learning 应该总能回查到触发任务`);
    }

    const summary = generateL0Summary(`${title} ${content}`);
    const result = await pool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, strategy_adjustments, metadata, content_hash, version, is_latest, summary, task_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, true, $8, $9)
      RETURNING *
    `, [
      title,
      category,
      triggerEvent,
      content,
      JSON.stringify(strategyAdjustments),
      JSON.stringify({ task_id, confidence: analysis.confidence }),
      contentHash,
      summary,
      task_id || null,
    ]);

    const learning = result.rows[0];
    console.log(`[learning] Recorded learning: ${learning.id}`);

    // T10 统一收件箱：真 learning（噪音已在入口拦截）落库后顺手进箱
    await pushCaptureAtom(pool, {
      content: `learning: ${title}\n${learning.summary || ''}`,
      targetType: 'learning',
      targetSubtype: learning.category || category,
      routedToTable: 'learnings',
      routedToId: learning.id,
    });

    // 强制绑定：RCA learning 触发 dev task（Insight-to-Action 闭环）
    // T9: 加 confidence 门槛——低置信 RCA 只落 learning 不建任务，防任务队列噪音
    const INSIGHT_TASK_MIN_CONFIDENCE = 0.7;
    if ((analysis.confidence ?? 0) >= INSIGHT_TASK_MIN_CONFIDENCE) {
      try {
        const taskDedup = await pool.query(
          `SELECT id FROM tasks WHERE payload->>'insight_learning_id' = $1 AND status != 'cancelled' LIMIT 1`,
          [learning.id]
        );
        if (taskDedup.rows.length === 0) {
          // 仓库与范围只继承触发任务的持久化路由，不能从 RCA 文案猜测目标仓库。
          const source = task_id ? await pool.query('SELECT payload FROM tasks WHERE id = $1', [task_id]) : { rows: [] };
          const { repo, map_scope: mapScope } = source.rows[0]?.payload || {};
          if (typeof repo !== 'string' || !repo.trim() || !Array.isArray(mapScope)
              || mapScope.length === 0 || mapScope.some(scope => typeof scope !== 'string' || !scope.trim())) {
            await pool.query(`UPDATE learnings SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
              [learning.id, JSON.stringify({ insight_task_status: 'blocked', insight_task_reason: 'source_route_context_missing' })]);
          } else {
            const created = await createTask({
              source: 'discovery',
              source_id: `learning-repair:${learning.id}`,
              repo_hint: repo,
              map_scope_hint: mapScope,
              mutation_intent: 'write',
              declared_change_kind: 'bugfix',
              title: `[Insight修复] ${title.slice(0, 120)} [${learning.id}]`,
              description: `由 RCA Learning 自动生成的修复任务。\n\nlearning_id: ${learning.id}\n\n${content}`,
              priority: 'P2',
              task_type: 'dev',
              trigger_source: 'cortex',
              payload: {
                insight_learning_id: learning.id,
                event_type: triggerEvent,
              },
            });
            if (!created?.success || !created.task?.id) throw new Error('insight_task_creation_not_confirmed');
            // success 也可能是去重结果；只有本 learning、同源仓库与范围才能闭环。
            const repairPayload = created.task.payload;
            const expectedScope = [...new Set(mapScope.map(scope => scope.trim()))].sort();
            if (repairPayload?.insight_learning_id !== learning.id || repairPayload.repo !== repo.trim()
                || JSON.stringify(repairPayload.map_scope) !== JSON.stringify(expectedScope)) {
              throw new Error('insight_task_context_mismatch');
            }
            await pool.query(
              `UPDATE learnings SET applied = true, applied_at = NOW() WHERE id = $1`,
              [learning.id]
            );
            console.log(`[learning] Auto-created repair task for RCA learning ${learning.id}`);
          }
        }
      } catch (taskErr) {
        await pool.query(`UPDATE learnings SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [learning.id, JSON.stringify({ insight_task_status: 'blocked', insight_task_reason: taskErr.message })])
          .catch(auditErr => console.warn(`[learning] Failed to record blocked task reason: ${auditErr.message}`));
        console.warn(`[learning] Failed to create task for learning ${learning.id} (non-fatal):`, taskErr.message);
      }
    } else {
      console.log(`[learning] Skip insight task creation: confidence=${analysis.confidence} < ${INSIGHT_TASK_MIN_CONFIDENCE}`);
    }

    // 写 memory_stream 记录，建立闭环链条（failure_pattern → memory_stream active）
    try {
      const memContent = `[故障记录] ${title}\n\n${rcaAnalysis.root_cause || ''}`;
      const memResult = await pool.query(
        `INSERT INTO memory_stream (content, importance, memory_type, source_type, status)
         VALUES ($1, 7, 'long', 'failure_record', 'active')
         RETURNING id`,
        [memContent]
      );
      const memId = memResult.rows[0].id;
      // 反向链接：learning.source_memory_id → memory_stream
      await pool.query(
        'UPDATE learnings SET source_memory_id = $1 WHERE id = $2',
        [memId, learning.id]
      );
      learning.source_memory_id = memId;
      console.log(`[learning] Closure chain: learning=${learning.id} → memory=${memId}`);
    } catch (chainErr) {
      console.warn(`[learning] Closure chain write failed (non-fatal): ${chainErr.message}`);
    }

    // Fire-and-forget: 异步生成 embedding
    const embeddingText = `${title}\n\n${content}`.substring(0, 4000);
    generateLearningEmbeddingAsync(learning.id, embeddingText);

    return learning;
  } catch (err) {
    console.error(`[learning] Failed to record learning: ${err.message}`);
    throw err;
  }
}

/**
 * Check if a learning task should be created for systemic failure
 * @param {Object} failureInfo - Failure information
 * @returns {boolean} - Whether to create learning task
 */
export function shouldTriggerLearning(failureInfo) {
  // Trigger learning for systemic failures
  if (failureInfo.is_systemic) {
    return true;
  }

  // Don't trigger for individual task errors
  return false;
}

/**
 * Create learning task for Cortex analysis
 * @param {Object} failureContext - Context about the failure
 * @returns {Promise<string>} - Created task ID
 */
export async function createLearningTask(failureContext) {
  const { trigger, failures, signals } = failureContext;

  try {
    const created = await createTask({
      source: 'discovery',
      source_id: `systemic-learning:${trigger}:${Date.now()}`,
      title: `Learning - ${trigger}`,
      description: `Analyze systemic failure pattern and generate strategy adjustments.

Trigger: ${trigger}
Recent failures: ${failures?.length || 0}

System signals:
${JSON.stringify(signals, null, 2)}

Required analysis:
1. Root cause identification
2. Contributing factors
3. Strategy adjustments (specific parameter changes)
4. Recommended mitigations`,
      task_type: 'research',
      mutation_intent: 'none',
      declared_domain: 'research',
      priority: 'P1',
      trigger_source: 'learning_system',
      payload: {
        requires_cortex: true,
        requires_learning: true,
        trigger,
        failures,
        signals,
        created_by: 'learning_system',
      },
    });
    const taskId = created.task.id;
    console.log(`[learning] Created learning task: ${taskId}`);
    return taskId;
  } catch (err) {
    console.error(`[learning] Failed to create learning task: ${err.message}`);
    throw err;
  }
}

/**
 * P0-A：从深度对话中提取有价值的 learning（自我意识闭环）
 *
 * 仅在深度对话时触发（userMessage + reply 合计 > 400 字符）。
 * 用轻量 LLM 判断是否有值得记住的洞察，有则写入 learnings 表供反刍消化。
 *
 * @param {string} userMessage - 用户消息
 * @param {string} reply - Cecelia 的回复
 * @param {import('pg').Pool} dbPool - 数据库连接池
 */
export async function extractConversationLearning(userMessage, reply, dbPool) {
  const totalLength = (userMessage?.length || 0) + (reply?.length || 0);
  if (totalLength < 150) return; // 短对话跳过，避免噪音（150字，原400字已降低）

  try {
    const prompt = `你是 Cecelia，刚完成了一次对话。请判断这次对话中是否有值得记住的洞察。

用户说：${(userMessage || '').slice(0, 500)}
我的回复：${(reply || '').slice(0, 500)}

判断标准（至少符合一条才算有 learning）：
- 用户表达了明确的偏好、价值观或决策标准
- 我们讨论了系统/架构的设计决策
- 用户给了我直接的反馈（好或不好）
- 出现了值得未来参考的洞察或原则
- 用户直接纠正了 Cecelia 的行为或方式（如"你不应该X"、"你下次要Y"）

如果有 learning，输出 JSON：{"has_learning": true, "title": "简短标题（<50字）", "content": "洞察内容（<200字）", "category": "conversation_insight"}
如果是行为纠正，category 用 "behavior_correction"
如果没有 learning，输出：{"has_learning": false}
严格输出 JSON，不要其他内容。`;

    const { text } = await callLLM('thalamus', prompt, { maxTokens: 300, timeout: 90000 });
    if (!text) return;

    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) return;

    const parsed = JSON.parse(jsonStr);
    if (!parsed.has_learning || !parsed.title || !parsed.content) return;

    // 去重检查
    const hashInput = `${parsed.title}\n${parsed.content}`;
    const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
    const existing = await dbPool.query(
      'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
      [contentHash]
    );
    if (existing.rows.length > 0) return;

    const summary = generateL0Summary(`${parsed.title} ${parsed.content}`);
    const insertResult = await dbPool.query(`
      INSERT INTO learnings (title, content, summary, category, trigger_event, content_hash, version, is_latest, digested)
      VALUES ($1, $2, $3, $4, $5, $6, 1, true, false)
      RETURNING id
    `, [
      parsed.title,
      parsed.content,
      summary,
      parsed.category || 'conversation_insight',
      'conversation',
      contentHash,
    ]);

    console.log(`[learning] conversation learning extracted: ${parsed.title}`);
    // T10 统一收件箱：对话中提取的 learning 落库后顺手进箱
    await pushCaptureAtom(dbPool, {
      content: `learning: ${parsed.title}\n${summary}`,
      targetType: 'learning',
      targetSubtype: parsed.category || 'conversation_insight',
      routedToTable: 'learnings',
      routedToId: insertResult?.rows?.[0]?.id,
    }).catch(err => console.warn('[learning] pushCaptureAtom failed:', err.message));
  } catch (err) {
    console.warn('[learning] extractConversationLearning failed (non-blocking):', err.message);
  }
}

/**
 * 按 title 精确去重写入 learning。
 * - 若已存在同 title 的行：frequency_count += 1，更新 last_reinforced_at，返回 { id, upserted: false }
 * - 若不存在：INSERT，frequency_count = 1，返回 { id, upserted: true }
 *
 * 适用于 thalamus/orchestrator-chat/quarantine 等 LLM 生成场景（content 每次略有不同，
 * 但 title 是事件标识符语义唯一）。learning.js 的 recordLearning 仍用 content_hash。
 *
 * @param {{ title: string, content?: string, category?: string, triggerEvent?: string }} params
 * @param {import('pg').Pool} [dbPool] - 可选，默认用全局 pool
 * @returns {Promise<{ id: string, upserted: boolean }>}
 */
export async function upsertLearning({ title, content = '', category = 'general', triggerEvent = null, task_id = null }, dbPool) {
  const p = dbPool || pool;

  const existing = await p.query(
    'SELECT id, frequency_count FROM learnings WHERE title = $1 LIMIT 1',
    [title]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const newFreq = (row.frequency_count || 1) + 1;
    await p.query(
      `UPDATE learnings
         SET frequency_count = $1,
             last_reinforced_at = NOW()
       WHERE id = $2`,
      [newFreq, row.id]
    );
    return { id: row.id, upserted: false };
  }

  const result = await p.query(
    `INSERT INTO learnings (title, category, trigger_event, content, frequency_count, last_reinforced_at, task_id)
     VALUES ($1, $2, $3, $4, 1, NOW(), $5)
     RETURNING id`,
    [title, category, triggerEvent, content, task_id || null]
  );
  // T10 统一收件箱：upsertLearning 新建分支落库后顺手进箱
  await pushCaptureAtom(p, {
    content: `learning: ${title}\n${content}`,
    targetType: 'learning',
    targetSubtype: category,
    routedToTable: 'learnings',
    routedToId: result.rows[0].id,
  }).catch(err => console.warn('[learning] pushCaptureAtom failed:', err.message));
  return { id: result.rows[0].id, upserted: true };
}

export { ADJUSTABLE_PARAMS, applyStrategyAdjustments, evaluateStrategyEffectiveness } from './learning-strategy.js';
export { searchRelevantLearnings, getRecentLearnings, _vectorSearchLearnings, _keywordSearchLearnings, _keywordBoost } from './learning-search.js';
