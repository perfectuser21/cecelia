/**
 * content-pipeline-orchestrator.js
 *
 * 内容工厂 Pipeline 编排器。
 *
 * 职责：
 *   1. orchestrateContentPipelines() — 由 tick 调用
 *      检测 queued 的 content-pipeline 任务，创建第一个子任务（content-research）。
 *
 *   2. advanceContentPipeline(taskId, status, findings) — 由 execution callback 调用
 *      子任务完成后推进 Pipeline：创建下一个阶段任务，或标记 Pipeline 完成。
 *
 * Pipeline 状态机：
 *   content-pipeline(queued)
 *     → tick 调用 orchestrateContentPipelines()
 *     → 创建 content-research(queued) + pipeline 标 in_progress
 *
 *   content-research 完成
 *     → 创建 content-generate(queued)
 *
 *   content-generate 完成
 *     → 创建 content-review(queued)
 *
 *   content-review 完成，review_passed=true（默认）
 *     → 创建 content-export(queued)
 *
 *   content-review 完成，review_passed=false 且 retry_count < MAX_REVIEW_RETRY
 *     → 重建 content-generate(queued)，retry_count+1，携带 review_feedback
 *
 *   content-review 完成，review_passed=false 且 retry_count >= MAX_REVIEW_RETRY
 *     → 标记 content-pipeline(failed)，停止
 *
 *   content-export 完成
 *     → 标记 content-pipeline(completed)
 *
 * Payload 规范（子任务）：
 *   payload.parent_pipeline_id   — 父 content-pipeline 任务 ID
 *   payload.pipeline_stage       — 当前阶段（'content-research' 等）
 *   payload.pipeline_keyword     — 内容关键词（从父任务继承）
 *   payload.retry_count          — review 重试次数（仅 content-generate）
 *   payload.review_feedback      — review 失败反馈（仅重试的 content-generate）
 *
 * Review 失败判断（/content-creator skill 约定）：
 *   findings.review_passed === false 时视为失败。
 *   若 findings 缺失 review_passed 字段，视为通过（宽松默认）。
 *   若 task status = 'failed'，也视为 review 失败。
 */

import pool from './db.js';

// ───────────────────────────────────────────────────────
// 常量
// ───────────────────────────────────────────────────────

/** Pipeline 四个阶段（有序）*/
export const PIPELINE_STAGES = [
  'content-research',
  'content-generate',
  'content-review',
  'content-export',
];

/** content-review 最大重试次数（超过则 pipeline 标 failed）*/
export const MAX_REVIEW_RETRY = 3;

// ───────────────────────────────────────────────────────
// Tick 侧：检测并启动 queued content-pipeline 任务
// ───────────────────────────────────────────────────────

/**
 * 检测所有 queued 的 content-pipeline 任务，为每个创建第一个子任务（content-research）。
 * 由 tick.js 调用（每次 tick 执行一次）。
 *
 * @param {import('pg').Pool} [dbPool] - 可选，测试时注入 mock pool，生产用全局 pool
 * @returns {Promise<{total_actions: number, summary: {orchestrated: number, skipped: number}}>}
 */
export async function orchestrateContentPipelines(dbPool = pool) {
  let orchestrated = 0;
  let skipped = 0;

  // 查找所有 queued 的 content-pipeline 任务
  const pipelinesResult = await dbPool.query(`
    SELECT id, title, goal_id, project_id, payload
    FROM tasks
    WHERE task_type = 'content-pipeline'
      AND status = 'queued'
    ORDER BY created_at ASC
    LIMIT 10
  `);

  for (const pipeline of pipelinesResult.rows) {
    try {
      const pipelineId = pipeline.id;
      const keyword = pipeline.payload?.keyword || pipeline.title;

      // 幂等检查：是否已有 content-research 子任务在飞
      const existingResult = await dbPool.query(`
        SELECT id FROM tasks
        WHERE payload->>'parent_pipeline_id' = $1
          AND task_type = 'content-research'
          AND status IN ('queued', 'in_progress', 'completed')
        LIMIT 1
      `, [pipelineId]);

      if (existingResult.rows.length > 0) {
        console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} 已有 content-research 子任务，跳过`);
        // Pipeline 可能还是 queued（上次启动前崩溃）→ 修正为 in_progress
        await dbPool.query(
          `UPDATE tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1 AND status = 'queued'`,
          [pipelineId]
        );
        skipped++;
        continue;
      }

      // 创建第一个子任务：content-research
      await dbPool.query(`
        INSERT INTO tasks (title, description, task_type, status, priority, project_id, goal_id,
                          trigger_source, payload, created_at)
        VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, NOW())
      `, [
        `[内容调研] ${keyword}`,
        `Content Pipeline 子任务（阶段1/4）：对「${keyword}」进行深度调研，产出 research.json。\n父任务 ID: ${pipelineId}`,
        'content-research',
        pipeline.payload?.priority || 'P1',
        pipeline.project_id,
        pipeline.goal_id,
        'content_pipeline_orchestrator',
        JSON.stringify({
          parent_pipeline_id: pipelineId,
          pipeline_stage: 'content-research',
          pipeline_keyword: keyword,
        }),
      ]);

      // 标记 pipeline 为 in_progress
      await dbPool.query(
        `UPDATE tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
        [pipelineId]
      );

      console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} → content-research 已创建`);
      orchestrated++;
    } catch (err) {
      console.error(`[content-pipeline-orchestrator] pipeline ${pipeline.id} 处理失败: ${err.message}`);
    }
  }

  return {
    total_actions: orchestrated,
    summary: { orchestrated, skipped },
  };
}

// ───────────────────────────────────────────────────────
// Execution Callback 侧：子任务完成时推进 Pipeline
// ───────────────────────────────────────────────────────

/**
 * 子任务完成时推进 Pipeline。
 * 由 execution.js 的 callback 在 newStatus === 'completed' 或 'failed' 时调用。
 *
 * @param {string} taskId - 完成的子任务 ID
 * @param {string} taskStatus - 子任务最终状态（'completed' | 'failed'）
 * @param {object} [findings] - 子任务产出（JSON，content-review 用 findings.review_passed 判断通过/失败）
 * @param {import('pg').Pool} [dbPool] - 可选，测试时注入 mock pool
 * @returns {Promise<{advanced: boolean, action: string|null}>}
 */
export async function advanceContentPipeline(taskId, taskStatus, findings = null, dbPool = pool) {
  // 读取子任务详情
  const taskResult = await dbPool.query(`
    SELECT id, title, task_type, project_id, goal_id, payload
    FROM tasks
    WHERE id = $1
  `, [taskId]);

  if (taskResult.rows.length === 0) {
    console.warn(`[content-pipeline-orchestrator] advanceContentPipeline: 找不到 task ${taskId}`);
    return { advanced: false, action: null };
  }

  const task = taskResult.rows[0];
  const { task_type, payload } = task;

  // 只处理有 parent_pipeline_id 的子任务
  const pipelineId = payload?.parent_pipeline_id;
  if (!pipelineId) {
    return { advanced: false, action: null };
  }

  // 确认是合法的 pipeline 子任务
  if (!PIPELINE_STAGES.includes(task_type)) {
    return { advanced: false, action: null };
  }

  console.log(`[content-pipeline-orchestrator] 子任务 ${task_type}(${taskId}) 完成，推进 pipeline ${pipelineId}`);

  // 读取父 pipeline 任务
  const pipelineResult = await dbPool.query(`
    SELECT id, title, goal_id, project_id, payload, status
    FROM tasks WHERE id = $1
  `, [pipelineId]);

  if (pipelineResult.rows.length === 0) {
    console.error(`[content-pipeline-orchestrator] 找不到父 pipeline ${pipelineId}`);
    return { advanced: false, action: null };
  }

  const pipeline = pipelineResult.rows[0];
  const keyword = pipeline.payload?.keyword || task.payload?.pipeline_keyword || pipeline.title;

  // ── content-research 完成 → 创建 content-generate ──
  if (task_type === 'content-research') {
    return await _createNextStage(dbPool, pipeline, task, 'content-generate', keyword, {
      pipeline_stage: 'content-generate',
      pipeline_keyword: keyword,
      research_task_id: taskId,
      retry_count: 0,
    });
  }

  // ── content-generate 完成 → 创建 content-review ──
  if (task_type === 'content-generate') {
    return await _createNextStage(dbPool, pipeline, task, 'content-review', keyword, {
      pipeline_stage: 'content-review',
      pipeline_keyword: keyword,
      generate_task_id: taskId,
      retry_count: task.payload?.retry_count || 0,
    });
  }

  // ── content-review 完成 → 判断 PASS / FAIL ──
  if (task_type === 'content-review') {
    const reviewPassed = _isReviewPassed(taskStatus, findings);

    if (reviewPassed) {
      // PASS → 创建 content-export
      return await _createNextStage(dbPool, pipeline, task, 'content-export', keyword, {
        pipeline_stage: 'content-export',
        pipeline_keyword: keyword,
        review_task_id: taskId,
      });
    } else {
      // FAIL → 重试 content-generate（最多 MAX_REVIEW_RETRY 次）
      const currentRetry = task.payload?.retry_count || 0;
      if (currentRetry >= MAX_REVIEW_RETRY) {
        // 超过重试上限 → pipeline failed
        await dbPool.query(
          `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
          [pipelineId]
        );
        console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} review 重试达上限(${MAX_REVIEW_RETRY})，标记 failed`);
        return { advanced: true, action: 'pipeline_failed_max_retry' };
      }

      // 创建重试的 content-generate，携带 review_feedback
      const nextRetry = currentRetry + 1;
      const reviewFeedback = findings?.feedback || findings?.issues || '请改进内容质量';
      return await _createNextStage(dbPool, pipeline, task, 'content-generate', keyword, {
        pipeline_stage: 'content-generate',
        pipeline_keyword: keyword,
        retry_count: nextRetry,
        review_feedback: reviewFeedback,
        review_task_id: taskId,
      }, `[内容生成-重试R${nextRetry}]`);
    }
  }

  // ── content-export 完成 → 标记 pipeline completed ──
  if (task_type === 'content-export') {
    await dbPool.query(
      `UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [pipelineId]
    );
    console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} 全部完成 ✅`);
    return { advanced: true, action: 'pipeline_completed' };
  }

  return { advanced: false, action: null };
}

// ───────────────────────────────────────────────────────
// 私有辅助函数
// ───────────────────────────────────────────────────────

/**
 * 创建下一个阶段的子任务（含幂等检查）。
 */
async function _createNextStage(dbPool, pipeline, prevTask, nextStage, keyword, nextPayload, titlePrefix = null) {
  const pipelineId = pipeline.id;

  // 幂等检查：该 pipeline 下是否已有 nextStage 在飞
  const existing = await dbPool.query(`
    SELECT id FROM tasks
    WHERE payload->>'parent_pipeline_id' = $1
      AND task_type = $2
      AND status IN ('queued', 'in_progress')
    LIMIT 1
  `, [pipelineId, nextStage]);

  if (existing.rows.length > 0) {
    console.log(`[content-pipeline-orchestrator] ${nextStage} 已存在于 pipeline ${pipelineId}，跳过`);
    return { advanced: false, action: 'already_exists' };
  }

  const stageLabel = _stageLabel(nextStage);
  const prefix = titlePrefix || `[${stageLabel}]`;
  const stageNum = PIPELINE_STAGES.indexOf(nextStage) + 1;

  await dbPool.query(`
    INSERT INTO tasks (title, description, task_type, status, priority, project_id, goal_id,
                      trigger_source, payload, created_at)
    VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, NOW())
  `, [
    `${prefix} ${keyword}`,
    `Content Pipeline 子任务（阶段${stageNum}/4）：${stageLabel}「${keyword}」。\n父任务 ID: ${pipelineId}`,
    nextStage,
    'P1',
    pipeline.project_id,
    pipeline.goal_id,
    'content_pipeline_orchestrator',
    JSON.stringify({
      parent_pipeline_id: pipelineId,
      ...nextPayload,
    }),
  ]);

  console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} → ${nextStage} 已创建`);
  return { advanced: true, action: `created_${nextStage.replace('-', '_')}` };
}

/**
 * 判断 content-review 是否通过。
 * 宽松默认：没有明确标记 false 则视为通过。
 */
function _isReviewPassed(taskStatus, findings) {
  if (taskStatus === 'failed') return false;
  if (findings?.review_passed === false) return false;
  if (findings?.verdict === 'fail' || findings?.verdict === 'reject') return false;
  return true;
}

/**
 * stage task_type → 中文标签
 */
function _stageLabel(stage) {
  const labels = {
    'content-research': '内容调研',
    'content-generate': '内容生成',
    'content-review': '内容审核',
    'content-export': '内容导出',
  };
  return labels[stage] || stage;
}
