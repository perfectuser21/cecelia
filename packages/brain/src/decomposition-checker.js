/** 旧拆解已退役；保留缺少 KR 的目标战略会议检查及兼容入口。 */
import pool from './db.js';
import { createTask } from './actions.js';

// ───────────────────────────────────────────────────────────────────
// Check D: Objective 无 KR → 创建战略会议任务
// ───────────────────────────────────────────────────────────────────

/**
 * 检测是否有 strategic_meeting 任务已存在于指定 goal 下。
 */
async function hasExistingStrategicMeetingTask(goalId) {
  const result = await pool.query(`
    SELECT id FROM tasks
    WHERE goal_id = $1
      AND task_type = 'strategic_meeting'
      AND status IN ('queued', 'in_progress')
    LIMIT 1
  `, [goalId]);
  return result.rows.length > 0;
}

/**
 * 检测 pending/in_progress 状态的 Objective 是否缺少子 KR。
 * 无子 KR 时整个规划链根本不启动，需要人工制定 KR。
 *
 * 处理：创建 strategic_meeting 任务，提示需要为该 Objective 制定 KR。
 *
 * 触发条件：
 *   - Objective status IN ('pending', 'in_progress')
 *   - 无活跃子 KR（key_results 表，objective_id = objective.id，status NOT IN ('completed', 'cancelled')）
 *   - 没有已存在的 strategic_meeting 任务（幂等）
 */
async function checkObjectiveWithoutKR() {
  const actions = [];

  // 检测无 KR 的 Objective（新 OKR 表：objectives + key_results）
  const result = await pool.query(`
    SELECT g.id, g.title, g.description, NULL::text AS priority, 'objective' AS type
    FROM objectives g
    WHERE g.status IN ('pending', 'in_progress', 'active')
      AND NOT EXISTS (
        SELECT 1 FROM key_results kr
        WHERE kr.objective_id = g.id
          AND kr.status NOT IN ('completed', 'cancelled')
      )
  `);

  for (const objective of result.rows) {
    if (await hasExistingStrategicMeetingTask(objective.id)) {
      actions.push({ action: 'skip_dedup', check: 'objective_without_kr', goal_id: objective.id, title: objective.title });
      continue;
    }

    const title = `战略会议: 为「${objective.title}」制定 KR`;
    const description = [
      `Objective「${objective.title}」下没有任何活跃的 KR，规划链无法启动。`,
      '',
      '请召开战略会议，为该 Objective 制定关键结果（Key Results）：',
      '',
      '1. 分析 Objective 的核心目标和当前进展',
      '2. 制定 2-4 个可量化的 KR（关键结果）',
      '3. 每个 KR 需要：标题、描述、优先级、可量化的成功标准',
      '4. 通过 Brain API 创建 KR：',
      '   POST http://localhost:5221/api/brain/action/create-okr',
      `   Body: { "objective_id": "${objective.id}", "key_results": [...] }`,
      '',
      `Objective ID: ${objective.id}`,
      `Objective 标题: ${objective.title}`,
      `Objective 描述: ${objective.description || '(无)'}`,
      `类型: ${objective.type}`,
      `优先级: ${objective.priority}`,
    ].join('\n');

    const created = await createTask({
      source: 'discovery',
      source_id: `objective-strategy:${objective.id}`,
      title,
      description,
      goal_id: objective.id,
      task_type: 'strategic_meeting',
      priority: objective.priority || 'P1',
      trigger_source: 'brain_auto',
    });
    const task = created.task;
    console.log(`[decomp-checker] Check D: Objective ${objective.id} (${objective.title}) has no KR, created strategic_meeting task`);
    actions.push({ action: 'create_strategic_meeting', check: 'objective_without_kr', goal_id: objective.id, task_id: task.id, title: objective.title });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────
// 保留接口形状，供旧回滚路径和现有 API 使用。
async function runDecompositionChecks() {
  try {
    const actions = await checkObjectiveWithoutKR();
    return {
      actions,
      summary: {
        created: 0,
        status_changes: 0,
        strategic_meetings_created: actions.filter(a => a.action === 'create_strategic_meeting').length,
      },
      total_created: 0,
    };
  } catch (err) {
    console.error('[decomp-checker] Objective without KR check failed:', err.message);
    return { actions: [], summary: { created: 0, status_changes: 0, strategic_meetings_created: 0 }, total_created: 0 };
  }
}

export { runDecompositionChecks, checkObjectiveWithoutKR, hasExistingStrategicMeetingTask };
