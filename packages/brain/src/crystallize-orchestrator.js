/**
 * crystallize-orchestrator.js
 *
 * 能力蒸馏（crystallize）流水线编排器。
 *
 * 职责：
 *   1. advanceCrystallizePipeline() — 由 tick 调用
 *      检测 queued 的 crystallize 任务，创建第一个子任务（crystallize_scope）。
 *
 *   2. advanceCrystallizeStage(taskId, status, findings) — 由 execution callback 调用
 *      子任务完成后推进流水线：创建下一阶段任务，或标记流水线完成。
 *
 * 流水线状态机：
 *   crystallize(queued)
 *     → tick 调用 advanceCrystallizePipeline()
 *     → 创建 crystallize_scope(queued) + crystallize 标 in_progress
 *
 *   crystallize_scope 完成
 *     → 创建 crystallize_forge(queued)
 *
 *   crystallize_forge 完成
 *     → 创建 crystallize_verify(queued)
 *
 *   crystallize_verify 完成，verify_passed=true（默认）
 *     → 创建 crystallize_register(queued)
 *
 *   crystallize_verify 完成，verify_passed=false 且 retry_count < MAX_VERIFY_RETRY
 *     → 重建 crystallize_forge(queued)，retry_count+1，携带 verify_feedback
 *
 *   crystallize_verify 完成，verify_passed=false 且 retry_count >= MAX_VERIFY_RETRY
 *     → 标记 crystallize(failed)，停止
 *
 *   crystallize_register 完成
 *     → 标记 crystallize(completed)
 *
 * Payload 规范（子任务）：
 *   payload.parent_crystallize_id  — 父 crystallize 任务 ID
 *   payload.pipeline_stage         — 当前阶段（'crystallize_scope' 等）
 *   payload.pipeline_target        — 目标场景描述（从父任务继承）
 *   payload.script_path            — 生成的脚本路径（Forge 阶段产出）
 *   payload.retry_count            — Verify 失败重试次数（仅 crystallize_forge）
 *   payload.verify_feedback        — Verify 失败反馈（仅重试的 crystallize_forge）
 */

import pool from './db.js';

// ───────────────────────────────────────────────────────
// 常量
// ───────────────────────────────────────────────────────

/** 流水线四个阶段（有序）*/
export const CRYSTALLIZE_STAGES = [
  'crystallize_scope',
  'crystallize_forge',
  'crystallize_verify',
  'crystallize_register',
];

/** crystallize_verify 最大重试次数（超过则 pipeline 标 failed）*/
export const MAX_VERIFY_RETRY = 3;

// ───────────────────────────────────────────────────────
// 内部辅助
// ───────────────────────────────────────────────────────

/**
 * 从 crystallize 任务行提取关键参数。
 */
function _parseParams(task) {
  return {
    target: task.payload?.target || task.title,
    priority: task.payload?.priority || 'P2',
  };
}

/**
 * 启动单个 crystallize 流水线：幂等检查、创建 crystallize_scope 子任务。
 * @returns {Promise<'orchestrated'|'skipped'>}
 */
async function _startOnePipeline(task, dbPool) {
  const pipelineId = task.id;
  const { target, priority } = _parseParams(task);

  // 幂等检查：是否已有 crystallize_scope 子任务在飞
  const existingResult = await dbPool.query(`
    SELECT id FROM tasks
    WHERE payload->>'parent_crystallize_id' = $1
      AND task_type = 'crystallize_scope'
      AND status IN ('queued', 'in_progress', 'completed')
    LIMIT 1
  `, [pipelineId]);

  if (existingResult.rows.length > 0) {
    // Pipeline 可能还是 queued（上次启动前崩溃）→ 修正为 in_progress
    await dbPool.query(
      `UPDATE tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1 AND status = 'queued'`,
      [pipelineId]
    );
    return 'skipped';
  }

  // 创建第一个子任务：crystallize_scope
  await dbPool.query(`
    INSERT INTO tasks (title, description, task_type, status, priority, project_id, goal_id,
                      trigger_source, payload, created_at)
    VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, NOW())
  `, [
    `[Scope] ${target}`,
    `Crystallize 流水线子任务（阶段1/4）：为「${target}」定义 DoD 和验收标准。\n父任务 ID: ${pipelineId}`,
    'crystallize_scope',
    priority,
    task.project_id,
    task.goal_id,
    'crystallize_orchestrator',
    JSON.stringify({
      parent_crystallize_id: pipelineId,
      pipeline_stage: 'crystallize_scope',
      pipeline_target: target,
    }),
  ]);

  // 标记 pipeline 为 in_progress
  await dbPool.query(
    `UPDATE tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
    [pipelineId]
  );

  console.log(`[crystallize-orchestrator] pipeline ${pipelineId} → crystallize_scope 已创建`);
  return 'orchestrated';
}

// ───────────────────────────────────────────────────────
// Tick 侧：检测并启动 queued crystallize 任务
// ───────────────────────────────────────────────────────

/**
 * 检测所有 queued 的 crystallize 任务，为每个创建 crystallize_scope 子任务。
 * 由 tick.js 调用（每次 tick 执行一次）。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<{total_actions: number, summary: {orchestrated: number, skipped: number}}>}
 */
export async function advanceCrystallizePipeline(dbPool = pool) {
  let orchestrated = 0;
  let skipped = 0;

  const tasksResult = await dbPool.query(`
    SELECT id, title, goal_id, project_id, payload
    FROM tasks
    WHERE task_type = 'crystallize' AND status = 'queued'
    ORDER BY created_at ASC
    LIMIT 5
  `);

  for (const task of tasksResult.rows) {
    try {
      const result = await _startOnePipeline(task, dbPool);
      if (result === 'orchestrated') orchestrated++;
      else skipped++;
    } catch (err) {
      console.error(`[crystallize-orchestrator] pipeline ${task.id} 启动失败:`, err.message);
    }
  }

  return {
    total_actions: orchestrated + skipped,
    summary: { orchestrated, skipped },
  };
}

// ───────────────────────────────────────────────────────
// Execution Callback 侧：推进流水线
// ───────────────────────────────────────────────────────

/**
 * 子任务完成后推进 crystallize 流水线到下一阶段。
 * 由 execution callback 调用（任务完成/失败时）。
 *
 * @param {string} taskId - 完成的子任务 ID
 * @param {string} status - 'completed' | 'failed'
 * @param {object} findings - 子任务输出结果
 * @param {import('pg').Pool} [dbPool]
 */
export async function advanceCrystallizeStage(taskId, status, findings = {}, dbPool = pool) {
  // 查询子任务信息
  const taskResult = await dbPool.query(
    `SELECT id, task_type, payload, project_id, goal_id, priority FROM tasks WHERE id = $1`,
    [taskId]
  );
  const task = taskResult.rows[0];
  if (!task) return;

  const { parent_crystallize_id: pipelineId, pipeline_target: target, retry_count = 0 } = task.payload || {};
  if (!pipelineId) return;

  const currentStage = task.task_type;
  const currentIdx = CRYSTALLIZE_STAGES.indexOf(currentStage);
  if (currentIdx === -1) return;

  // 任务失败处理
  if (status === 'failed') {
    await dbPool.query(
      `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
      [pipelineId]
    );
    console.log(`[crystallize-orchestrator] pipeline ${pipelineId} 因 ${currentStage} 失败而终止`);
    return;
  }

  // crystallize_verify 失败重试逻辑
  if (currentStage === 'crystallize_verify' && findings?.verify_passed === false) {
    if (retry_count >= MAX_VERIFY_RETRY) {
      await dbPool.query(
        `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
        [pipelineId]
      );
      console.log(`[crystallize-orchestrator] pipeline ${pipelineId} verify 达到最大重试次数（${MAX_VERIFY_RETRY}），标记 failed`);
      return;
    }

    // 重建 crystallize_forge（重试）
    const newRetryCount = retry_count + 1;
    await dbPool.query(`
      INSERT INTO tasks (title, description, task_type, status, priority, project_id, goal_id,
                        trigger_source, payload, created_at)
      VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, NOW())
    `, [
      `[Forge 重试${newRetryCount}] ${target}`,
      `Crystallize 流水线子任务（Forge 重试 ${newRetryCount}/${MAX_VERIFY_RETRY}）：根据 Verify 反馈修复脚本。\n父任务 ID: ${pipelineId}`,
      'crystallize_forge',
      task.priority,
      task.project_id,
      task.goal_id,
      'crystallize_orchestrator',
      JSON.stringify({
        parent_crystallize_id: pipelineId,
        pipeline_stage: 'crystallize_forge',
        pipeline_target: target,
        retry_count: newRetryCount,
        verify_feedback: findings?.feedback || '验证失败，请检查脚本',
        ...(findings?.script_path ? { script_path: findings.script_path } : {}),
      }),
    ]);
    console.log(`[crystallize-orchestrator] pipeline ${pipelineId} verify 失败，重建 forge（retry ${newRetryCount}）`);
    return;
  }

  // 最后一个阶段完成 → pipeline 完成
  if (currentIdx === CRYSTALLIZE_STAGES.length - 1) {
    await dbPool.query(
      `UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [pipelineId]
    );
    console.log(`[crystallize-orchestrator] pipeline ${pipelineId} 完成（${target}）`);
    return;
  }

  // 创建下一阶段子任务
  const nextStage = CRYSTALLIZE_STAGES[currentIdx + 1];
  const stageNum = currentIdx + 2; // 1-indexed
  const stageLabels = { crystallize_forge: 'Forge', crystallize_verify: 'Verify', crystallize_register: 'Register' };
  const label = stageLabels[nextStage] || nextStage;

  await dbPool.query(`
    INSERT INTO tasks (title, description, task_type, status, priority, project_id, goal_id,
                      trigger_source, payload, created_at)
    VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, NOW())
  `, [
    `[${label}] ${target}`,
    `Crystallize 流水线子任务（阶段${stageNum}/4）。\n父任务 ID: ${pipelineId}`,
    nextStage,
    task.priority,
    task.project_id,
    task.goal_id,
    'crystallize_orchestrator',
    JSON.stringify({
      parent_crystallize_id: pipelineId,
      pipeline_stage: nextStage,
      pipeline_target: target,
      // 传递 retry_count，确保 crystallize_verify 能读到正确的重试次数
      retry_count,
      ...(findings?.script_path ? { script_path: findings.script_path } : {}),
    }),
  ]);

  console.log(`[crystallize-orchestrator] pipeline ${pipelineId} → ${nextStage} 已创建`);
}
