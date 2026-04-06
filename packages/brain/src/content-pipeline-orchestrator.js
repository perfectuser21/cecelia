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
 * Pipeline 状态机（6 阶段）：
 *   content-pipeline(queued)
 *     → tick 调用 orchestrateContentPipelines()
 *     → 创建 content-research(queued) + pipeline 标 in_progress
 *
 *   content-research 完成 → 创建 content-copywriting(queued)
 *   content-copywriting 完成 → 创建 content-copy-review(queued)
 *   content-copy-review PASS → 创建 content-generate(queued)
 *   content-copy-review FAIL (retry < MAX) → 重建 content-copywriting, retry+1
 *   content-copy-review FAIL (retry >= MAX) → pipeline failed
 *   content-generate 完成 → 创建 content-image-review(queued)
 *   content-image-review PASS → 创建 content-export(queued)
 *   content-image-review FAIL (retry < MAX) → 重建 content-generate, retry+1
 *   content-image-review FAIL (retry >= MAX) → pipeline failed
 *   content-export 完成 → pre-publish-check（质量验证）→ PASS：pipeline completed + 创建 publish jobs
 *                        → FAIL：pipeline pre_publish_failed（不创建 publish jobs）
 *
 * Payload 规范（子任务）：
 *   payload.parent_pipeline_id   — 父 content-pipeline 任务 ID
 *   payload.pipeline_stage       — 当前阶段（'content-research' 等）
 *   payload.pipeline_keyword     — 内容关键词（从父任务继承）
 *   payload.retry_count          — review 重试次数（content-copywriting / content-generate）
 *   payload.review_feedback      — review 失败反馈（重试时携带）
 *
 * Review 失败判断：
 *   findings.review_passed === false 时视为失败。
 *   若 findings 缺失 review_passed 字段，视为通过（宽松默认）。
 *   若 task status = 'failed'，也视为 review 失败。
 */

import pool from './db.js';
import { getContentType } from './content-types/content-type-registry.js';
import { executeResearch, executeCopywriting, executeCopyReview, executeGenerate, executeImageReview, executeExport } from './content-pipeline-executors.js';
import { validateAllVariants } from './content-quality-validator.js';

// ───────────────────────────────────────────────────────
// 常量
// ───────────────────────────────────────────────────────

/** Pipeline 六个阶段（有序）*/
export const PIPELINE_STAGES = [
  'content-research',
  'content-copywriting',
  'content-copy-review',
  'content-generate',
  'content-image-review',
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

  // 验证 content_type 存在于注册表（若有指定），同时读取 typeConfig 用于传参
  let typeConfig = null;
  if (content_type) {
    typeConfig = await getContentType(content_type);
    if (!typeConfig) {
      console.error(`[content-pipeline-orchestrator] pipeline ${pipelineId} content_type "${content_type}" 不存在于注册表，标记 failed`);
      await dbPool.query(
        `UPDATE tasks SET status = $2, completed_at = NOW(), error_message = $3 WHERE id = $1`,
        [pipelineId, 'failed', `content_type "${content_type}" 不存在于注册表`]
      );
      return 'skipped';
    }
  }

  // 幂等检查：是否已有 content-research 子任务（含 completed）
  // 修复：completed 也需要检查 —— 若 research 已完成但后续阶段失败被 requeue，
  // 不应从头重新创建 research 子任务，否则会导致无限 research 重建循环。
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
    `Content Pipeline 子任务（阶段1/6）：对「${keyword}」进行深度调研，产出 research.json。\n父任务 ID: ${pipelineId}`,
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
      ...(typeConfig?.notebook_id ? { notebook_id: typeConfig.notebook_id } : {}),
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
      await dbPool.query(
        `UPDATE tasks SET status = $2, completed_at = NOW(), error_message = $3 WHERE id = $1`,
        [pipeline.id, 'failed', err.message]
      ).catch(() => {});
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
 * content-research 完成 → 创建 content-copywriting
 */
async function _handleResearchComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, dbPool) {
  return _createNextStage(dbPool, pipeline, task, 'content-copywriting', keyword, {
    pipeline_stage: 'content-copywriting',
    pipeline_keyword: keyword,
    research_task_id: taskId,
    retry_count: 0,
    ...(content_type ? { content_type } : {}),
  });
}

/**
 * content-copywriting 完成 → 创建 content-copy-review
 */
async function _handleCopywritingComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, dbPool) {
  return _createNextStage(dbPool, pipeline, task, 'content-copy-review', keyword, {
    pipeline_stage: 'content-copy-review',
    pipeline_keyword: keyword,
    copywriting_task_id: taskId,
    retry_count: task.payload?.retry_count || 0,
    ...(content_type ? { content_type } : {}),
  });
}

/**
 * content-copy-review 完成 → PASS 创建 content-generate，FAIL 打回 content-copywriting
 */
async function _handleCopyReviewComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, taskStatus, findings, dbPool) {
  const pipelineId = pipeline.id;
  if (_isReviewPassed(taskStatus, findings)) {
    return _createNextStage(dbPool, pipeline, task, 'content-generate', keyword, {
      pipeline_stage: 'content-generate',
      pipeline_keyword: keyword,
      copy_review_task_id: taskId,
      retry_count: 0,
      ...(content_type ? { content_type } : {}),
      ...(typeConfig ? { images_count: typeConfig.images?.count } : {}),
    }, null, typeConfig);
  }

  const currentRetry = task.payload?.retry_count || 0;
  if (currentRetry >= MAX_REVIEW_RETRY) {
    await dbPool.query(
      `UPDATE tasks SET status = $2, completed_at = NOW(), error_message = $3,
         payload = COALESCE(payload, '{}'::jsonb) || $4::jsonb WHERE id = $1`,
      [pipelineId, 'failed', `copy-review 重试达上限(${MAX_REVIEW_RETRY})，pipeline 终止`,
        JSON.stringify({ failure_class: 'pipeline_terminal_failure' })]
    );
    console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} copy-review 重试达上限(${MAX_REVIEW_RETRY})，标记 failed`);
    return { advanced: true, action: 'pipeline_failed_max_retry' };
  }

  const nextRetry = currentRetry + 1;
  const reviewFeedback = findings?.feedback || findings?.issues || '请改进文案质量';
  return _createNextStage(dbPool, pipeline, task, 'content-copywriting', keyword, {
    pipeline_stage: 'content-copywriting',
    pipeline_keyword: keyword,
    retry_count: nextRetry,
    review_feedback: reviewFeedback,
    review_task_id: taskId,
    ...(content_type ? { content_type } : {}),
  }, `[文案生成-重试R${nextRetry}]`);
}

/**
 * content-generate 完成 → 创建 content-image-review
 */
async function _handleGenerateComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, dbPool) {
  return _createNextStage(dbPool, pipeline, task, 'content-image-review', keyword, {
    pipeline_stage: 'content-image-review',
    pipeline_keyword: keyword,
    generate_task_id: taskId,
    retry_count: task.payload?.retry_count || 0,
    ...(content_type ? { content_type } : {}),
    ...(typeConfig ? { review_rules: typeConfig.review_rules } : {}),
  });
}

/**
 * content-image-review 完成 → PASS 创建 content-export，FAIL 打回 content-generate
 */
async function _handleImageReviewComplete({ task, pipeline, keyword, content_type, typeConfig, taskId }, taskStatus, findings, dbPool) {
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
      `UPDATE tasks SET status = $2, completed_at = NOW(), error_message = $3,
         payload = COALESCE(payload, '{}'::jsonb) || $4::jsonb WHERE id = $1`,
      [pipelineId, 'failed', `image-review 重试达上限(${MAX_REVIEW_RETRY})，pipeline 终止`,
        JSON.stringify({ failure_class: 'pipeline_terminal_failure' })]
    );
    console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} image-review 重试达上限(${MAX_REVIEW_RETRY})，标记 failed`);
    return { advanced: true, action: 'pipeline_failed_max_retry' };
  }

  const nextRetry = currentRetry + 1;
  const reviewFeedback = findings?.feedback || findings?.issues || '请改进图片质量';
  return _createNextStage(dbPool, pipeline, task, 'content-generate', keyword, {
    pipeline_stage: 'content-generate',
    pipeline_keyword: keyword,
    retry_count: nextRetry,
    review_feedback: reviewFeedback,
    review_task_id: taskId,
    ...(content_type ? { content_type } : {}),
    ...(typeConfig ? { images_count: typeConfig.images?.count } : {}),
  }, `[图片生成-重试R${nextRetry}]`, typeConfig);
}

/**
 * Pipeline content_type → zenithjoy.works content_type 映射。
 * works 表 CHECK 约束：只允许 long_form_article / image_text / video。
 */
function _mapToWorksContentType(pipelineContentType) {
  if (!pipelineContentType) return 'image_text';
  const t = pipelineContentType.toLowerCase();
  if (t.includes('video')) return 'video';
  if (t.includes('article') || t.includes('long') || t.includes('wechat')) return 'long_form_article';
  return 'image_text';
}

/**
 * Pipeline 完成后写入 zenithjoy.works 作品库（幂等：同一 pipeline_id 不重复写）。
 *
 * 字段映射：
 *   pipeline_id       → content_id（幂等键，UNIQUE）
 *   pipeline_keyword  → title
 *   article.md 正文   → body（读取失败不阻断）
 *   content_type      → content_type（经 _mapToWorksContentType 映射）
 *   export_path(NAS)  → nas_path
 *   card_files[0] URL → cover_image
 *   card_files[] URL  → media_files
 *
 * @param {import('pg').Pool} dbPool
 * @param {object} pipeline - 父 pipeline 任务行
 * @param {object} exportTask - content-export 子任务行（payload 含 export_path, card_files）
 * @returns {Promise<string|null>} 新建或已存在的 works.id
 */
async function _writeToWorksTable(dbPool, pipeline, exportTask) {
  const pipelineId = pipeline.id;
  const keyword = pipeline.payload?.keyword || exportTask.payload?.pipeline_keyword || pipeline.title;
  const rawContentType = pipeline.payload?.content_type || exportTask.payload?.content_type || null;
  const worksContentType = _mapToWorksContentType(rawContentType);
  const exportPath = exportTask.payload?.export_path || null;
  const cardFiles = exportTask.payload?.card_files || [];

  // 幂等检查：同一 pipeline_id 不写两次
  const existing = await dbPool.query(
    `SELECT id FROM zenithjoy.works WHERE content_id = $1 LIMIT 1`,
    [pipelineId]
  );
  if (existing.rows.length > 0) {
    console.log(`[content-pipeline-orchestrator] zenithjoy.works 已有记录(pipeline=${pipelineId.substring(0, 8)})，跳过写入`);
    return existing.rows[0].id;
  }

  // 尝试读取本地 article.md 正文（失败不阻断）
  let body = null;
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const OUTPUT_BASE = join(process.env.HOME || '/Users/administrator', 'claude-output');
    const dateStr = new Date().toISOString().slice(0, 10);
    const keySlug = keyword.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
    const candidatePaths = [
      join(OUTPUT_BASE, `${dateStr}-${keySlug}`, 'article', 'article.md'),
      join(OUTPUT_BASE, keySlug, 'article', 'article.md'),
    ];
    for (const p of candidatePaths) {
      if (existsSync(p)) { body = readFileSync(p, 'utf-8'); break; }
    }
  } catch { /* 读取失败不阻断写入 */ }

  // cover image 和 media_files：基于 card_files 构建 URL
  const IMAGE_BASE_URL = 'http://38.23.47.81:9998/images/';
  const coverImage = cardFiles.length > 0 ? `${IMAGE_BASE_URL}${cardFiles[0]}` : null;
  const mediaFiles = cardFiles.map(f => `${IMAGE_BASE_URL}${f}`);

  try {
    const result = await dbPool.query(
      `INSERT INTO zenithjoy.works
         (content_id, title, body, content_type, nas_path, cover_image, media_files, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'ready', NOW())
       RETURNING id`,
      [pipelineId, keyword, body, worksContentType, exportPath, coverImage, JSON.stringify(mediaFiles)]
    );
    const worksId = result.rows[0].id;
    console.log(`[content-pipeline-orchestrator] zenithjoy.works 写入成功: id=${worksId} title="${keyword}"`);
    return worksId;
  } catch (err) {
    // 写入失败不阻断 pipeline 完成流程
    console.error(`[content-pipeline-orchestrator] zenithjoy.works 写入失败（不阻断）: ${err.message}`);
    return null;
  }
}

/**
 * content-export 完成 → 写入 zenithjoy.works + 创建 content_publish 任务（8 平台）+ 标记 pipeline completed
 */
async function _handleExportComplete({ task, pipeline }, dbPool) {
  const pipelineId = pipeline.id;

  // ── pre-publish-check：发布前质量门控 ─────────────────────────────────────
  // 读取本地 export 产出文案，执行程序化质量验证（字数/关键词/语气）。
  // 验证失败：pipeline 标 pre_publish_failed，跳过创建 publish jobs，防止劣质内容发出。
  // 验证通过或内容文件缺失（宽松通过）：继续正常流程。
  let pre_publish_check = { passed: true, skipped: true };
  try {
    const { readFileSync, existsSync, readdirSync } = await import('fs');
    const { join } = await import('path');
    const keyword = pipeline.payload?.keyword || task.payload?.pipeline_keyword || pipeline.title;
    const contentType = pipeline.payload?.content_type || 'solo-company-case';
    const outputBase = join(process.env.HOME || '/Users/administrator', 'claude-output');
    const slugified = keyword.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-');

    let contentMap = {};
    try {
      const dirs = readdirSync(outputBase).filter((d) => d.includes(slugified));
      if (dirs.length > 0) {
        const outputDir = join(outputBase, dirs[dirs.length - 1]);
        // 路径遍历防护：确保 outputDir 仍在 outputBase 下
        const { resolve } = await import('path');
        const resolvedOut = resolve(outputDir);
        const resolvedBase = resolve(outputBase);
        if (!resolvedOut.startsWith(resolvedBase + '/') && resolvedOut !== resolvedBase) {
          throw new Error('路径遍历检测：outputDir 超出 outputBase 范围');
        }
        const copyPath = join(outputDir, 'cards', 'copy.md');
        const articlePath = join(outputDir, 'article', 'article.md');
        if (existsSync(copyPath)) contentMap.short_copy = readFileSync(copyPath, 'utf-8');
        if (existsSync(articlePath)) contentMap.long_form = readFileSync(articlePath, 'utf-8');
      }
    } catch { /* 目录不存在，宽松通过 */ }

    if (Object.keys(contentMap).length > 0) {
      let typeConfig = {};
      try { typeConfig = await getContentType(contentType) || {}; } catch { /* 宽松 */ }
      const { passed, results } = validateAllVariants(contentMap, typeConfig);
      pre_publish_check = { passed, skipped: false, results };
      if (!passed) {
        const blockingIssues = Object.values(results)
          .flatMap((r) => r.issues.filter((i) => i.severity === 'blocking'))
          .map((i) => i.message);
        console.warn(`[content-pipeline-orchestrator] pipeline ${pipelineId} pre-publish-check 未通过：${blockingIssues.join('; ')}`);
        await dbPool.query(
          `UPDATE tasks SET status = 'pre_publish_failed', completed_at = NOW(),
             payload = payload || $2::jsonb, error_message = $3
           WHERE id = $1`,
          [
            pipelineId,
            JSON.stringify({ pre_publish_check }),
            `pre-publish-check 未通过：${blockingIssues.join('; ')}`,
          ]
        );
        return { advanced: true, action: 'pipeline_pre_publish_failed' };
      }
    }
  } catch (checkErr) {
    // 验证流程本身报错时宽松通过，不阻断发布
    console.warn(`[content-pipeline-orchestrator] pipeline ${pipelineId} pre-publish-check 异常（宽松通过）: ${checkErr.message}`);
  }
  // ──────────────────────────────────────────────────────────────────────────

  // 写入作品库（幂等，失败不阻断后续流程）
  await _writeToWorksTable(dbPool, pipeline, task);

  await _createPublishJobs(dbPool, pipeline, task);

  // 将 export_path 回写到 pipeline 的 payload
  const export_path = task.payload?.export_path || null;
  const extra_payload = { pre_publish_check };
  if (export_path) {
    await dbPool.query(
      `UPDATE tasks SET status = 'completed', completed_at = NOW(),
         payload = payload || $2::jsonb
       WHERE id = $1`,
      [pipelineId, JSON.stringify({ export_path, ...extra_payload })]
    );
  } else {
    await dbPool.query(
      `UPDATE tasks SET status = 'completed', completed_at = NOW(),
         payload = payload || $2::jsonb
       WHERE id = $1`,
      [pipelineId, JSON.stringify(extra_payload)]
    );
  }
  console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} 全部完成 ✅`);
  return { advanced: true, action: 'pipeline_completed' };
}

/**
 * 将父 pipeline 标记为 failed（阶段执行失败时调用）。
 */
async function _markPipelineFailed(ctx, dbPool) {
  const { task, pipeline } = ctx;
  const pipelineId = pipeline.id;
  await dbPool.query(
    `UPDATE tasks SET status = $2, completed_at = NOW(), updated_at = NOW(), error_message = $3 WHERE id = $1`,
    [pipelineId, 'failed', `阶段 ${task.task_type} 执行失败，pipeline 终止`]
  );
  return { advanced: true, action: 'pipeline_failed_stage_error' };
}

/** 阶段 → 处理函数映射表（替代顺序 if 链，消除圈复杂度） */
const STAGE_HANDLER_MAP = {
  'content-research': (ctx, status, _f, db) => status === 'failed' ? _markPipelineFailed(ctx, db) : _handleResearchComplete(ctx, db),
  'content-copywriting': (ctx, status, _f, db) => status === 'failed' ? _markPipelineFailed(ctx, db) : _handleCopywritingComplete(ctx, db),
  'content-copy-review': (ctx, status, findings, db) => _handleCopyReviewComplete(ctx, status, findings, db),
  'content-generate': (ctx, status, _f, db) => status === 'failed' ? _markPipelineFailed(ctx, db) : _handleGenerateComplete(ctx, db),
  'content-image-review': (ctx, status, findings, db) => _handleImageReviewComplete(ctx, status, findings, db),
  'content-export': (ctx, status, _f, db) => status === 'failed' ? _markPipelineFailed(ctx, db) : _handleExportComplete(ctx, db),
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
    description = `Content Pipeline 子任务（阶段${stageNum}/6）：${stageLabel}「${keyword}」。\n父任务 ID: ${pipelineId}\n\n${prompt}`;
  } else {
    description = `Content Pipeline 子任务（阶段${stageNum}/6）：${stageLabel}「${keyword}」。\n父任务 ID: ${pipelineId}`;
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
  'content-copywriting': executeCopywriting,
  'content-copy-review': executeCopyReview,
  'content-generate': executeGenerate,
  'content-image-review': executeImageReview,
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

  // 把 review 结果（issues、review_passed、rule_scores、llm_reviewed）存入 payload，供 stages API 返回给前端
  if (execResult.issues !== undefined || execResult.review_passed !== undefined) {
    const reviewPayload = {
      review_issues: execResult.issues || [],
      review_passed: execResult.review_passed ?? true,
    };
    if (execResult.rule_scores !== undefined) reviewPayload.rule_scores = execResult.rule_scores;
    if (execResult.llm_reviewed !== undefined) reviewPayload.llm_reviewed = execResult.llm_reviewed;
    // executeImageReview 返回 llm_review 对象，统一映射到 llm_reviewed: true
    if (execResult.llm_review !== undefined) reviewPayload.llm_reviewed = true;
    await dbPool.query(
      `UPDATE tasks SET status = $1, completed_at = NOW(),
         payload = payload || $2::jsonb
       WHERE id = $3`,
      [newStatus, JSON.stringify(reviewPayload), task.id]
    );
  } else if (execResult.export_path) {
    await dbPool.query(
      `UPDATE tasks SET status = $1, completed_at = NOW(),
         payload = payload || $2::jsonb
       WHERE id = $3`,
      [newStatus, JSON.stringify({ export_path: execResult.export_path }), task.id]
    );
  } else if (newStatus === 'failed' && execResult.error) {
    await dbPool.query(
      `UPDATE tasks SET status = $1, completed_at = NOW(), error_message = $2 WHERE id = $3`,
      [newStatus, execResult.error, task.id]
    );
  } else {
    await dbPool.query(
      `UPDATE tasks SET status = $1, completed_at = NOW() WHERE id = $2`,
      [newStatus, task.id]
    );
  }

  const advResult = await advanceContentPipeline(task.id, newStatus, execResult, dbPool);
  if (advResult.advanced) {
    console.log(`[content-executor] pipeline 推进: ${task.id} → ${advResult.action}`);
  }
}

// 并发守卫：防止 tick 重叠调用（executors 使用 execSync 会阻塞事件循环）
let _contentExecutorBusy = false;

/**
 * 由 tick 调用。检测 queued 的 content-* 子任务，自动执行。
 * ⚠️ 内部使用 execSync（NotebookLM/LLM 调用），必须在 tick 中以 fire-and-forget 方式调用，
 *    否则会阻塞 Brain 事件循环。
 * @param {import('pg').Pool} [dbPool]
 */
export async function executeQueuedContentTasks(dbPool = pool) {
  if (_contentExecutorBusy) {
    console.log('[content-executor] 上一批任务仍在执行，跳过本次 tick');
    return { executed: 0 };
  }
  _contentExecutorBusy = true;
  let executed = 0;

  try {
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

      // 批量检查父 pipeline 状态，跳过已失败/取消的子任务
      const parentIds = [...new Set(result.rows.map(t => t.payload?.parent_pipeline_id).filter(Boolean))];
      let aliveParents = new Set();
      if (parentIds.length > 0) {
        const parentResult = await dbPool.query(
          `SELECT id FROM tasks WHERE id = ANY($1::uuid[]) AND status IN ('queued','in_progress')`,
          [parentIds]
        );
        aliveParents = new Set(parentResult.rows.map(r => r.id));
      }

      for (const task of result.rows) {
        const parentId = task.payload?.parent_pipeline_id;
        if (parentId && !aliveParents.has(parentId)) {
          // 父 pipeline 已 failed/cancelled — 子任务标记 cancelled 并跳过
          await dbPool.query(
            `UPDATE tasks SET status = 'cancelled', completed_at = NOW(), updated_at = NOW(), error_message = $2 WHERE id = $1`,
            [task.id, '父 pipeline 已失败，子任务自动取消']
          ).catch(() => {});
          console.log(`[content-executor] 子任务 ${task.id}（${stage}）父 pipeline ${parentId?.substring(0,8)} 已失败，已取消`);
          continue;
        }

        try {
          await _executeStageTask(task, stage, executor, dbPool);
          executed++;
        } catch (err) {
          console.error(`[content-executor] ${stage} 执行失败: ${err.message}`);
          await dbPool.query(
            `UPDATE tasks SET status = $2, completed_at = NOW(), error_message = $3 WHERE id = $1`,
            [task.id, 'failed', err.message]
          ).catch(() => {});
        }
      }
    }
  } finally {
    _contentExecutorBusy = false;
  }

  return { executed };
}

/**
 * stage task_type → 中文标签
 */
function _stageLabel(stage) {
  const labels = {
    'content-research': '内容调研',
    'content-copywriting': '文案生成',
    'content-copy-review': '文案审核',
    'content-generate': '图片生成',
    'content-image-review': '图片审核',
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

    const exportPath = exportTask?.payload?.export_path || null;
    const publishDesc = `内容发布任务：将「${keyword}」内容发布到 ${platform} 平台。` +
      `关键词：${keyword}，内容类型：${contentType}，` +
      (exportPath ? `产物目录：${exportPath}。` : '产物目录：待定。') +
      `使用对应平台发布 skill 自动发布图文内容。`;

    await dbPool.query(
      `INSERT INTO tasks (title, task_type, status, priority, project_id, goal_id,
                         trigger_source, description, payload, created_at)
       VALUES ($1, 'content_publish', 'queued', $2, $3, $4, $5, $6, $7, NOW())`,
      [
        `[发布] ${keyword} → ${platform}`,
        'P1',
        pipeline.project_id,
        pipeline.goal_id,
        'content_pipeline_orchestrator',
        publishDesc,
        JSON.stringify({
          parent_pipeline_id: pipelineId,
          platform,
          pipeline_keyword: keyword,
          content_type: contentType,
          export_path: exportPath,
        }),
      ]
    );

    console.log(`[content-pipeline-orchestrator] content_publish(${platform}) 已创建`);
    created++;
  }

  console.log(`[content-pipeline-orchestrator] pipeline ${pipelineId} → ${created} 个 content_publish 任务已创建`);
}
