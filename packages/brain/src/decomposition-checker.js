/**
 * Decomposition Checker - OKR 统一版 (v2.0)
 *
 * 职责简化为两个检测：
 *   1. 检测 pending 且未拆过的 KR → 创建秋米拆解任务（KR → Project → Initiative）
 *   2. 检测 ready KR 下的 Initiative 无活跃 Task → 标记需要 planner 创建 Task
 *
 * 不再做：
 *   - Check 1-4（Global OKR/KR/Area OKR/KR 自动拆解 — 用户管）
 *   - Check 5（Project→Initiative 自动拆解 — 秋米一次性拆到 Initiative）
 *   - Check 6（Initiative→Task 自动补充 — planner 按需创建）
 *   - Inventory 补货机制（不再预拆 Task）
 *
 * KR 状态流转：
 *   pending → decomposing（秋米在拆）→ reviewing（Vivian 在审）→ ready（用户放行）→ in_progress → completed
 */

import pool from './db.js';
import { computeCapacity, isAtCapacity } from './capacity.js';
import { validateTaskDescription } from './task-quality-gate.js';

// Dedup window: skip if decomposition task completed within this period
const DEDUP_WINDOW_HOURS = 24;

// Maximum concurrent decomposition tasks (across all levels)
const WIP_LIMITS = {
  MAX_DECOMP_IN_FLIGHT: 3,
};

// ───────────────────────────────────────────────────────────────────
// Shared helpers
// ───────────────────────────────────────────────────────────────────

/**
 * Check if a decomposition task already exists for the given goal_id.
 */
async function hasExistingDecompositionTask(goalId) {
  const result = await pool.query(`
    SELECT id FROM tasks
    WHERE goal_id = $1
      AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
      AND (
        status IN ('queued', 'in_progress', 'canceled', 'cancelled')
        OR (status = 'completed' AND completed_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
        OR (status = 'failed' AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
      )
    LIMIT 1
  `, [goalId]);
  return result.rows.length > 0;
}

/**
 * Check global WIP limit for decomposition tasks.
 */
async function canCreateDecompositionTask() {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM tasks
    WHERE (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
      AND status IN ('queued', 'in_progress')
  `);
  const count = parseInt(result.rows[0].count, 10);
  return count < WIP_LIMITS.MAX_DECOMP_IN_FLIGHT;
}

/**
 * Create a decomposition task for 秋米.
 */
async function createDecompositionTask({ title, description, goalId, projectId, payload }) {
  if (!goalId) {
    throw new Error(`[decomp-checker] Refusing to create task without goalId: "${title}"`);
  }

  // Quality gate
  const validation = validateTaskDescription(description);
  if (!validation.valid) {
    console.warn(`[decomp-checker] Quality gate REJECTED "${title}": ${validation.reasons.join('; ')}`);
    return { id: null, title, rejected: true, reasons: validation.reasons };
  }

  const result = await pool.query(`
    INSERT INTO tasks (title, description, status, priority, goal_id, project_id, task_type, payload, trigger_source)
    VALUES ($1, $2, 'queued', 'P0', $3, $4, 'dev', $5, 'brain_auto')
    RETURNING id, title
  `, [
    title,
    description,
    goalId,
    projectId || null,
    JSON.stringify({ decomposition: 'true', ...payload })
  ]);
  return result.rows[0];
}

// ───────────────────────────────────────────────────────────────────
// Check A: Pending KR → 触发秋米拆解
// ───────────────────────────────────────────────────────────────────

/**
 * 检测 pending 且未拆过的 KR，创建秋米拆解任务。
 * 秋米负责：KR → Project → Initiative（带方向描述 + 成功标准）
 *
 * 触发条件：
 *   - KR status = 'pending'
 *   - 没有已存在的拆解任务（去重）
 *   - 未达 WIP 上限
 */
async function checkPendingKRs() {
  const actions = [];

  // 找 pending 状态且没有子结构的 KR
  const result = await pool.query(`
    SELECT g.id, g.title, g.description, g.priority, g.parent_id
    FROM goals g
    WHERE g.type = 'kr'
      AND g.status = 'pending'
  `);

  for (const kr of result.rows) {
    // 去重检查
    if (await hasExistingDecompositionTask(kr.id)) {
      actions.push({ action: 'skip_dedup', check: 'pending_kr', goal_id: kr.id, title: kr.title });
      continue;
    }

    // WIP 限制
    if (!(await canCreateDecompositionTask())) {
      actions.push({ action: 'skip_wip', check: 'pending_kr', goal_id: kr.id, title: kr.title });
      break;
    }

    // 创建拆解任务
    const task = await createDecompositionTask({
      title: `KR 拆解: ${kr.title}`,
      description: [
        `请为 KR「${kr.title}」拆解出 Project 和 Initiative。`,
        '',
        '你的任务：',
        '1. 分析 KR，拆解为 1-2 个 Project（目标型工作容器）',
        '2. 每个 Project 下创建 2-3 个 Initiative（一组 PR 的闭环工作包）',
        '3. 每个 Initiative 需要：方向描述 + 成功标准',
        '4. 不需要创建 Task — Task 由 planner 按需创建',
        '',
        '调用 Brain API 创建：',
        '  创建 Project: POST http://localhost:5221/api/brain/action/create-project',
        `    Body: { "name": "...", "type": "project", "status": "active" }`,
        '',
        '  关联 KR: POST http://localhost:5221/api/brain/action/link-project-kr',
        `    Body: { "project_id": "...", "kr_id": "${kr.id}" }`,
        '',
        '  创建 Initiative: POST http://localhost:5221/api/brain/action/create-project',
        `    Body: { "name": "...", "type": "initiative", "parent_id": "<project_id>", "status": "active" }`,
        '',
        `KR ID: ${kr.id}`,
        `KR 标题: ${kr.title}`,
        `KR 描述: ${kr.description || '(无)'}`,
        `优先级: ${kr.priority}`,
      ].join('\n'),
      goalId: kr.id,
      payload: { level: 'kr', kr_id: kr.id }
    });

    if (task && !task.rejected) {
      // 更新 KR 状态为 decomposing
      await pool.query(
        `UPDATE goals SET status = 'decomposing', updated_at = NOW() WHERE id = $1`,
        [kr.id]
      );
      console.log(`[decomp-checker] KR ${kr.id} → decomposing, created task: ${task.title}`);
      actions.push({ action: 'create_decomposition', check: 'pending_kr', goal_id: kr.id, task_id: task.id, title: kr.title });
    } else {
      actions.push({ action: 'skip_rejected', check: 'pending_kr', goal_id: kr.id, title: kr.title });
    }
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Check B: Ready KR 下 Initiative 无活跃 Task → 标记需要 planner
// ───────────────────────────────────────────────────────────────────

/**
 * 检测 ready KR 下的 Initiative，如果没有活跃 Task 则标记 needs_task。
 * planner 会在下一轮 tick 中看到这些 Initiative 并创建 Task。
 *
 * 同时处理 KR 状态流转：
 *   - ready KR 下有 in_progress 的 Task → KR 状态改 in_progress
 *   - ready/in_progress KR 下所有 Initiative 完成 → KR 状态改 completed
 */
async function checkReadyKRInitiatives() {
  const actions = [];

  // 找 ready 或 in_progress 状态的 KR
  const readyKRs = await pool.query(`
    SELECT g.id, g.title, g.status
    FROM goals g
    WHERE g.type = 'kr'
      AND g.status IN ('ready', 'in_progress')
  `);

  for (const kr of readyKRs.rows) {
    // 找这个 KR 下的所有 active Initiative
    const initiatives = await pool.query(`
      SELECT p.id, p.name, p.status,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('queued', 'in_progress')) as active_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'in_progress') as running_tasks
      FROM projects p
      INNER JOIN projects parent ON p.parent_id = parent.id
      INNER JOIN project_kr_links pkl ON pkl.project_id = parent.id
      WHERE pkl.kr_id = $1
        AND p.type = 'initiative'
        AND p.status IN ('active', 'in_progress')
    `, [kr.id]);

    // KR 状态流转：ready → in_progress（有任务在跑时）
    if (kr.status === 'ready') {
      const hasRunning = initiatives.rows.some(i => parseInt(i.running_tasks) > 0);
      if (hasRunning) {
        await pool.query(`UPDATE goals SET status = 'in_progress', updated_at = NOW() WHERE id = $1`, [kr.id]);
        console.log(`[decomp-checker] KR ${kr.id} → in_progress (tasks running)`);
        actions.push({ action: 'status_change', check: 'kr_status', goal_id: kr.id, from: 'ready', to: 'in_progress' });
      }
    }

    // KR 完成检查：所有 Initiative 都 completed → KR completed
    if (initiatives.rows.length > 0 && initiatives.rows.every(i => i.status === 'completed' || i.status === 'archived')) {
      // 确认确实没有 active initiative
      const activeCount = initiatives.rows.filter(i => i.status === 'active' || i.status === 'in_progress').length;
      if (activeCount === 0) {
        await pool.query(`UPDATE goals SET status = 'completed', updated_at = NOW() WHERE id = $1`, [kr.id]);
        console.log(`[decomp-checker] KR ${kr.id} → completed (all initiatives done)`);
        actions.push({ action: 'status_change', check: 'kr_status', goal_id: kr.id, from: kr.status, to: 'completed' });
        continue;
      }
    }

    // 标记无活跃 Task 的 Initiative（planner 会处理）
    for (const init of initiatives.rows) {
      if (parseInt(init.active_tasks) === 0) {
        actions.push({
          action: 'needs_task',
          check: 'ready_kr_initiative',
          kr_id: kr.id,
          initiative_id: init.id,
          initiative_name: init.name
        });
      }
    }
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────────────

/**
 * Run all decomposition checks.
 * Called by tick.js each tick cycle.
 */
async function runDecompositionChecks() {
  try {
    const allActions = [];

    // Check A: pending KR → 秋米拆解
    try {
      const krActions = await checkPendingKRs();
      allActions.push(...krActions);
    } catch (err) {
      console.error('[decomp-checker] Check A (pending KRs) failed:', err.message);
    }

    // Check B: ready KR Initiative 状态 + Task 检测
    try {
      const initActions = await checkReadyKRInitiatives();
      allActions.push(...initActions);
    } catch (err) {
      console.error('[decomp-checker] Check B (ready KR initiatives) failed:', err.message);
    }

    // Summary
    const totalCreated = allActions.filter(a => a.action === 'create_decomposition').length;
    const needsTask = allActions.filter(a => a.action === 'needs_task').length;
    const statusChanges = allActions.filter(a => a.action === 'status_change').length;

    if (totalCreated > 0 || needsTask > 0 || statusChanges > 0) {
      console.log(`[decomp-checker] Created ${totalCreated} decomp tasks, ${needsTask} initiatives need tasks, ${statusChanges} status changes`);
    }

    return {
      actions: allActions,
      summary: {
        created: totalCreated,
        needs_task: needsTask,
        status_changes: statusChanges,
      },
      total_created: totalCreated,
    };
  } catch (err) {
    console.error('[decomp-checker] Failed:', err.message);
    return {
      actions: [],
      summary: { error: err.message },
      total_created: 0,
    };
  }
}

export {
  runDecompositionChecks,
  checkPendingKRs,
  checkReadyKRInitiatives,
  // Shared helpers (exported for testing)
  hasExistingDecompositionTask,
  canCreateDecompositionTask,
  createDecompositionTask,
  DEDUP_WINDOW_HOURS,
  WIP_LIMITS,
};
