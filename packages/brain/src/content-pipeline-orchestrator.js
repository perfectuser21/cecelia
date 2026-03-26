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
import { getContentType } from './content-types/content-type-registry.js';
import { executeResearch, executeGenerate, executeReview, executeExport } from './content-pipeline-executors.js';

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

/** 内容发布目标平台（8 个），content-export 完成后逐一创建 content_publish 任务 */
export const PUBLISH_PLATFORMS = [
  'douyin',
  'kuaishou',
  'xiaohongshu',
  'weibo',
  'shipinhao',
  'wechat',
  'zhihu',
  'toutiao',
];

// ───────────────────────────────────────────────────────
// Tick 侧：检测并启动 queued content-pipeline 任务
// ───────────────────────────────────────────────────────

/**
 * 从 pipeline 任务行提取关键参数（隔离 optional chaining，降低调用方复杂度）。
 */
function _parsePipelineParams(pipeline) {
  return {
    keyword: pipeline.payload?.pipeline_keyword || pipeline.payload?.keyword || pipeline.title,
    content_type: pipeline.payload?.content_type || null,
    priority: pipeline.payload?.priority || 'P1',
  };
}

/**
 * 启动单个 content-pipeline：验证 content_type、幂等检查、创建 content-research 子任务。
 * @returns {Promise<'orchestrated'|'skipped'>}
 */
async function _startOnePipeline(pipeline, dbPool) {
  const pipelineId = pipeline.id;
  const { keyword, content_type, priority } = _parsePipelineParams(pipeline);

  // 验证 content_type 存在于注册表（若有指定）
  if (content_type) {
    const typeConfig = await getContentType(content_type);
    if (!typeConfig) {
      console.error(`[content-pipeline-orchestrator] pipeline ${pipelineId} content_type "${content_type}" 不存在于注册表，标记 failed`);
      await dbPool.query(
        `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
        [pipelineId]
      );
      return 'skipped';
    }
  }

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
    return 'skipped';
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
    priority,
    pipeline.project_id,
    pipeline.goal_id,
    'content_pipeline_orchestrator',
    JSON.stringify({
      parent_pipeline_id: pipelineId,
      pipeline_stage: 'content-research',
      pipeline_keyword: keyword,
      ...(content_type ? { content_type } : {}),
    }),
  ]);

  // 标记 pipeline 为 in_progress
  await dbPool.query(
    `UPDATE tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
    [pipelineId]
  );

  console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} → content-research 已创建${content_type ? ` (type: ${content_type})` : ''}`);
  return 'orchestrated';
}

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
      const result = await _startOnePipeline(pipeline, dbPool);
      if (result === 'orchestrated') orchestrated++;
      else skipped++;
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
 * 加载推进 Pipeline 所需的上下文（task、pipeline、keyword、typeConfig）。
 * 包含所有前置守卫检查，返回 null 表示无需推进。
 *
 * @returns {Promise<object|null>}
 */
async function _loadPipelineContext(taskId, dbPool) {
  const taskResult = await dbPool.query(`
    SELECT id, title, task_type, project_id, goal_id, payload
    FROM tasks
    WHERE id = $1
  `, [taskId]);

  if (taskResult.rows.length === 0) {
    console.warn(`[content-pipeline-orchestrator] advanceContentPipeline: 找不到 task ${taskId}`);
    return null;
  }

  const task = taskResult.rows[0];
  const pipelineId = task.payload?.parent_pipeline_id;
  if (!pipelineId || !PIPELINE_STAGES.includes(task.task_type)) {
    return null;
  }

  console.log(`[content-pipeline-orchestrator] 子任务 ${task.task_type}(${taskId}) 完成，推进 pipeline ${pipelineId}`);

  const pipelineResult = await dbPool.query(`
    SELECT id, title, goal_id, project_id, payload, status
    FROM tasks WHERE id = $1
  `, [pipelineId]);

  if (pipelineResult.rows.length === 0) {
    console.error(`[content-pipeline-orchestrator] 找不到父 pipeline ${pipelineId}`);
    return null;
  }

  const pipeline = pipelineResult.rows[0];
  const keyword = pipeline.payload?.keyword || task.payload?.pipeline_keyword || pipeline.title;
  const content_type = pipeline.payload?.content_type || task.payload?.content_type || null;
  const typeConfig = content_type ? await getContentType(content_type) : null;

  return { task, pipeline, keyword, content_type, typeConfig, taskId };
}

/**
 * content-research 完成 → 创建 content-generate
 */
async function _handleResearchComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, dbPool) {
  return _createNextStage(dbPool, pipeline, task, 'content-generate', keyword, {
    pipeline_stage: 'content-generate',
    pipeline_keyword: keyword,
    research_task_id: taskId,
    retry_count: 0,
    ...(content_type ? { content_type } : {}),
    ...(typeConfig ? { images_count: typeConfig.images?.count } : {}),
  }, null, typeConfig);
}

/**
 * content-generate 完成 → 创建 content-review
 */
async function _handleGenerateComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, dbPool) {
  return _createNextStage(dbPool, pipeline, task, 'content-review', keyword, {
    pipeline_stage: 'content-review',
    pipeline_keyword: keyword,
    generate_task_id: taskId,
    retry_count: task.payload?.retry_count || 0,
    ...(content_type ? { content_type } : {}),
    ...(typeConfig ? { review_rules: typeConfig.review_rules } : {}),
  });
}

/**
 * content-review 完成 → PASS 创建 content-export，FAIL 重试或标记 pipeline failed
 */
async function _handleReviewComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, taskStatus, findings, dbPool) {
  const pipelineId = pipeline.id;
  if (_isReviewPassed(taskStatus, findings)) {
    return _createNextStage(dbPool, pipeline, task, 'content-export', keyword, {
      pipeline_stage: 'content-export',
      pipeline_keyword: keyword,
      review_task_id: taskId,
      ...(content_type ? { content_type } : {}),
    });
  }

  const currentRetry = task.payload?.retry_count || 0;
  if (currentRetry >= MAX_REVIEW_RETRY) {
    await dbPool.query(
      `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
      [pipelineId]
    );
    console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} review 重试达上限(${MAX_REVIEW_RETRY})，标记 failed`);
    return { advanced: true, action: 'pipeline_failed_max_retry' };
  }

  const nextRetry = currentRetry + 1;
  const reviewFeedback = findings?.feedback || findings?.issues || '请改进内容质量';
  return _createNextStage(dbPool, pipeline, task, 'content-generate', keyword, {
    pipeline_stage: 'content-generate',
    pipeline_keyword: keyword,
    retry_count: nextRetry,
    review_feedback: reviewFeedback,
    review_task_id: taskId,
    ...(content_type ? { content_type } : {}),
    ...(typeConfig ? { images_count: typeConfig.images?.count } : {}),
  }, `[内容生成-重试R${nextRetry}]`, typeConfig);
}

/**
 * content-export 完成 → 创建 content_publish 任务（8 平台）+ 标记 pipeline completed
 */
async function _handleExportComplete({ task, pipeline }, dbPool) {
  const pipelineId = pipeline.id;
  await _createPublishJobs(dbPool, pipeline, task);
  await dbPool.query(
    `UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [pipelineId]
  );
  console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} 全部完成 ✅`);
  return { advanced: true, action: 'pipeline_completed' };
}

/** 阶段 → 处理函数映射表（替代顺序 if 链，消除圈复杂度） */
const STAGE_HANDLER_MAP = {
  'content-research': (ctx, _s, _f, db) => _handleResearchComplete(ctx, db),
  'content-generate': (ctx, _s, _f, db) => _handleGenerateComplete(ctx, db),
  'content-review': (ctx, status, findings, db) => _handleReviewComplete(ctx, status, findings, db),
  'content-export': (ctx, _s, _f, db) => _handleExportComplete(ctx, db),
};

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
  const ctx = await _loadPipelineContext(taskId, dbPool);
  if (!ctx) return { advanced: false, action: null };

  const handler = STAGE_HANDLER_MAP[ctx.task.task_type];
  if (!handler) return { advanced: false, action: null };

  return handler(ctx, taskStatus, findings, dbPool);
}

// ───────────────────────────────────────────────────────
// 私有辅助函数
// ───────────────────────────────────────────────────────

/**
 * 创建下一个阶段的子任务（含幂等检查）。
 * @param {object} [typeConfig] - 内容类型 YAML 配置（可选），用于生成阶段的 description
 */
async function _createNextStage(dbPool, pipeline, prevTask, nextStage, keyword, nextPayload, titlePrefix = null, typeConfig = null) {
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

  // content-generate 使用 YAML template.generate_prompt（若有），否则用默认描述
  let description;
  if (nextStage === 'content-generate' && typeConfig?.template?.generate_prompt) {
    const prompt = typeConfig.template.generate_prompt.replace(/\{keyword\}/g, keyword);
    description = `Content Pipeline 子任务（阶段${stageNum}/4）：${stageLabel}「${keyword}」。\n父任务 ID: ${pipelineId}\n\n${prompt}`;
  } else {
    description = `Content Pipeline 子任务（阶段${stageNum}/4）：${stageLabel}「${keyword}」。\n父任务 ID: ${pipelineId}`;
  }

  await dbPool.query(`
    INSERT INTO tasks (title, description, task_type, status, priority, project_id, goal_id,
                      trigger_source, payload, created_at)
    VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, NOW())
  `, [
    `${prefix} ${keyword}`,
    description,
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

// ───────────────────────────────────────────────────────
// 自动执行器：检测 queued 的子任务，执行对应 executor，完成后回调推进
// ───────────────────────────────────────────────────────

const EXECUTOR_MAP = {
  'content-research': executeResearch,
  'content-generate': executeGenerate,
  'content-review': executeReview,
  'content-export': executeExport,
};

/**
 * 执行单个 content-* 子任务：标记 in_progress、调用 executor、更新状态、推进 pipeline。
 */
async function _executeStageTask(task, stage, executor, dbPool) {
  await dbPool.query(`UPDATE tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1`, [task.id]);
  console.log(`[content-executor] 执行 ${stage}: ${task.title}`);
  const execResult = await executor(task);

  const newStatus = execResult.success ? 'completed' : 'failed';
  await dbPool.query(
    `UPDATE tasks SET status = $1, completed_at = NOW() WHERE id = $2`,
    [newStatus, task.id]
  );

  const advResult = await advanceContentPipeline(task.id, newStatus, execResult, dbPool);
  if (advResult.advanced) {
    console.log(`[content-executor] pipeline 推进: ${task.id} → ${advResult.action}`);
  }
}

/**
 * 由 tick 调用。检测 queued 的 content-* 子任务，自动执行。
 * @param {import('pg').Pool} [dbPool]
 */
export async function executeQueuedContentTasks(dbPool = pool) {
  let executed = 0;

  for (const stage of PIPELINE_STAGES) {
    const executor = EXECUTOR_MAP[stage];
    if (!executor) continue;

    const result = await dbPool.query(`
      SELECT id, title, task_type, payload, project_id, goal_id
      FROM tasks
      WHERE task_type = $1 AND status = 'queued'
        AND payload->>'parent_pipeline_id' IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 3
    `, [stage]);

    for (const task of result.rows) {
      try {
        await _executeStageTask(task, stage, executor, dbPool);
        executed++;
      } catch (err) {
        console.error(`[content-executor] ${stage} 执行失败: ${err.message}`);
        await dbPool.query(
          `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
          [task.id]
        ).catch(() => {});
      }
    }
  }

  return { executed };
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

/**
 * content-export 完成后，为 PUBLISH_PLATFORMS 中的每个平台创建 content_publish 任务。
 * fire-and-forget：不等待发布完成，pipeline 直接标 completed。
 * 含幂等保护：同一 pipeline 同一 platform 不重复创建。
 *
 * @param {import('pg').Pool} dbPool
 * @param {object} pipeline - 父 pipeline 任务行
 * @param {object} exportTask - content-export 子任务行
 */
async function _createPublishJobs(dbPool, pipeline, exportTask) {
  const pipelineId = pipeline.id;
  const keyword = pipeline.payload?.keyword || exportTask.payload?.pipeline_keyword || pipeline.title;
  const contentType = pipeline.payload?.content_type || exportTask.payload?.content_type || 'solo-company-case';
  let created = 0;

  for (const platform of PUBLISH_PLATFORMS) {
    // 幂等检查：同一 pipeline + platform 不重复创建
    const existing = await dbPool.query(
      `SELECT id FROM tasks
       WHERE payload->>'parent_pipeline_id' = $1
         AND task_type = 'content_publish'
         AND payload->>'platform' = $2
         AND status IN ('queued', 'in_progress', 'completed')
       LIMIT 1`,
      [pipelineId, platform]
    );

    if (existing.rows.length > 0) {
      console.log(`[content-pipeline-orchestrator] content_publish(${platform}) 已存在，跳过`);
      continue;
    }

    await dbPool.query(
      `INSERT INTO tasks (title, task_type, status, priority, project_id, goal_id,
                         trigger_source, payload, created_at)
       VALUES ($1, 'content_publish', 'queued', $2, $3, $4, $5, $6, NOW())`,
      [
        `[发布] ${keyword} → ${platform}`,
        'P1',
        pipeline.project_id,
        pipeline.goal_id,
        'content_pipeline_orchestrator',
        JSON.stringify({
          parent_pipeline_id: pipelineId,
          platform,
          pipeline_keyword: keyword,
          content_type: contentType,
        }),
      ]
    );

    console.log(`[content-pipeline-orchestrator] content_publish(${platform}) 已创建`);
    created++;
  }

  console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} → ${created} 个 content_publish 任务已创建`);
}
