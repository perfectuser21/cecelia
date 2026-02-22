/**
 * Initiative 4-Phase Orchestrator
 *
 * 状态机：plan → review → dev → verify → completed
 *
 * 被 tick.js Section 0.8.5 调用，纯函数 + DB 操作。
 * 只处理 execution_mode='orchestrated' 的 initiative。
 */

const VALID_TRANSITIONS = {
  'plan': ['review'],
  'review': ['dev', 'plan'],    // review → plan = needs_revision
  'dev': ['verify', 'plan'],     // dev → plan = replan (health check fail)
  'verify': ['dev', null],       // verify → null = completed; verify → dev = partial fail
};

/**
 * 判断 orchestrated initiative 的下一步操作
 *
 * @param {Object} initiative - { id, name, current_phase, dod_content }
 * @param {Object[]} tasks - 该 initiative 下的所有 tasks
 * @returns {{ action: string, detail?: any } | null}
 */
function getNextStepForInitiative(initiative, tasks) {
  const phase = initiative.current_phase;

  if (phase === 'plan') {
    const planTasks = tasks.filter(t => t.task_type === 'initiative_plan');
    const inFlight = planTasks.filter(t => ['queued', 'in_progress'].includes(t.status));
    const completed = planTasks.filter(t => t.status === 'completed');
    const failed = planTasks.filter(t => t.status === 'failed');

    if (planTasks.length === 0 || (failed.length > 0 && inFlight.length === 0 && completed.length === 0)) {
      return { action: 'create_plan_task' };
    }
    if (inFlight.length > 0) {
      return { action: 'waiting', detail: 'plan_task_in_flight' };
    }
    if (completed.length > 0) {
      return { action: 'transition', from: 'plan', to: 'review' };
    }
    return null;
  }

  if (phase === 'review') {
    const reviewTasks = tasks.filter(t => t.task_type === 'decomp_review');
    const inFlight = reviewTasks.filter(t => ['queued', 'in_progress'].includes(t.status));
    const completed = reviewTasks.filter(t => t.status === 'completed');

    if (reviewTasks.length === 0) {
      return { action: 'create_review_task' };
    }
    if (inFlight.length > 0) {
      return { action: 'waiting', detail: 'review_task_in_flight' };
    }
    if (completed.length > 0) {
      const latest = completed.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0];
      const verdict = latest.payload?.verdict || 'approved';
      if (verdict === 'approved') {
        return { action: 'promote_and_transition', from: 'review', to: 'dev' };
      }
      if (verdict === 'needs_revision') {
        return { action: 'transition', from: 'review', to: 'plan' };
      }
      if (verdict === 'rejected') {
        return { action: 'cancel_initiative' };
      }
    }
    return null;
  }

  if (phase === 'dev') {
    const devTasks = tasks.filter(t => t.task_type === 'dev');
    const inFlight = devTasks.filter(t => ['queued', 'in_progress'].includes(t.status));
    const completed = devTasks.filter(t => t.status === 'completed');
    const failed = devTasks.filter(t => t.status === 'failed');

    if (inFlight.length > 0) {
      return { action: 'waiting', detail: 'dev_tasks_in_flight' };
    }

    // Health check: 最近 5 个 dev 有 3 个失败 → replan
    const healthResult = checkInitiativeHealth(devTasks);
    if (healthResult.replan) {
      return { action: 'transition', from: 'dev', to: 'plan', detail: 'health_check_failed' };
    }

    // 所有 dev task 完成（没有 queued/in_progress）
    if (devTasks.length > 0 && inFlight.length === 0 && (completed.length > 0 || failed.length > 0)) {
      // 有 queued 的 draft tasks 不计入
      const draftTasks = tasks.filter(t => t.status === 'draft');
      if (draftTasks.length === 0) {
        return { action: 'transition', from: 'dev', to: 'verify' };
      }
    }
    return { action: 'waiting', detail: 'no_dev_tasks_yet' };
  }

  if (phase === 'verify') {
    const verifyTasks = tasks.filter(t => t.task_type === 'initiative_verify');
    const inFlight = verifyTasks.filter(t => ['queued', 'in_progress'].includes(t.status));
    const completed = verifyTasks.filter(t => t.status === 'completed');

    if (verifyTasks.length === 0) {
      return { action: 'create_verify_task' };
    }
    if (inFlight.length > 0) {
      return { action: 'waiting', detail: 'verify_task_in_flight' };
    }
    if (completed.length > 0) {
      const latest = completed.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0];
      const allPassed = latest.payload?.all_dod_passed === true;
      if (allPassed) {
        return { action: 'complete_initiative' };
      }
      // 部分失败：回到 dev 创建补充 task
      return { action: 'transition', from: 'verify', to: 'dev', detail: 'partial_dod_failure' };
    }
    return null;
  }

  return null;
}

/**
 * 带乐观锁的 phase 转换
 *
 * @param {import('pg').Pool} pool
 * @param {Object} initiative - { id }
 * @param {string} from - 当前 phase
 * @param {string|null} to - 目标 phase（null = completed）
 * @returns {Promise<boolean>} 是否成功
 */
async function handlePhaseTransition(pool, initiative, from, to) {
  // 验证转换合法性
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    console.warn(`[orchestrator] 非法转换: ${from} → ${to} (initiative ${initiative.id})`);
    return false;
  }

  if (to === null) {
    // completed
    const result = await pool.query(`
      UPDATE projects
      SET status = 'completed', current_phase = NULL, completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND current_phase = $2
    `, [initiative.id, from]);
    return (result.rowCount ?? 0) > 0;
  }

  const result = await pool.query(`
    UPDATE projects
    SET current_phase = $1, updated_at = NOW()
    WHERE id = $2 AND current_phase = $3
  `, [to, initiative.id, from]);

  const success = (result.rowCount ?? 0) > 0;
  if (success) {
    console.log(`[orchestrator] Phase 转换: ${from} → ${to} (initiative ${initiative.id})`);
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('initiative_phase_transition', 'orchestrator', $1)
    `, [JSON.stringify({
      initiative_id: initiative.id,
      from,
      to,
      timestamp: new Date().toISOString(),
    })]);
  }
  return success;
}

/**
 * 将 draft tasks 提升为 queued（review 通过后）
 *
 * @param {import('pg').Pool} pool
 * @param {string} initiativeId
 * @returns {Promise<number>} 提升数量
 */
async function promoteInitiativeTasks(pool, initiativeId) {
  const result = await pool.query(`
    UPDATE tasks
    SET status = 'queued', updated_at = NOW()
    WHERE project_id = $1 AND status = 'draft'
    RETURNING id
  `, [initiativeId]);
  const count = result.rowCount ?? 0;
  if (count > 0) {
    console.log(`[orchestrator] Promoted ${count} draft tasks → queued (initiative ${initiativeId})`);
  }
  return count;
}

/**
 * 创建 initiative_plan task
 *
 * @param {import('pg').Pool} pool
 * @param {Object} initiative - { id, name, description, dod_content }
 * @param {string} krId
 * @param {string} repoPath
 * @returns {Promise<Object>} created task
 */
async function createPlanTask(pool, initiative, krId, repoPath) {
  const result = await pool.query(`
    INSERT INTO tasks (title, description, task_type, status, project_id, goal_id, priority, payload, trigger_source)
    VALUES ($1, $2, 'initiative_plan', 'queued', $3, $4, 'P0', $5, 'orchestrator')
    RETURNING *
  `, [
    `Plan: ${initiative.name}`,
    `读代码自主拆解 Task for initiative "${initiative.name}"`,
    initiative.id,
    krId || null,
    JSON.stringify({
      initiative_id: initiative.id,
      initiative_name: initiative.name,
      dod_content: initiative.dod_content,
      repo_path: repoPath,
      description: initiative.description,
    }),
  ]);
  console.log(`[orchestrator] Created plan task: ${result.rows[0].id} for initiative ${initiative.id}`);
  return result.rows[0];
}

/**
 * 创建 initiative_verify task
 *
 * @param {import('pg').Pool} pool
 * @param {Object} initiative - { id, name, dod_content }
 * @param {Object[]} devTasks - 已完成的 dev tasks
 * @param {string} krId
 * @returns {Promise<Object>} created task
 */
async function createVerifyTask(pool, initiative, devTasks, krId) {
  const result = await pool.query(`
    INSERT INTO tasks (title, description, task_type, status, project_id, goal_id, priority, payload, trigger_source)
    VALUES ($1, $2, 'initiative_verify', 'queued', $3, $4, 'P0', $5, 'orchestrator')
    RETURNING *
  `, [
    `Verify: ${initiative.name}`,
    `DoD 验收 for initiative "${initiative.name}"`,
    initiative.id,
    krId || null,
    JSON.stringify({
      initiative_id: initiative.id,
      initiative_name: initiative.name,
      dod_content: initiative.dod_content,
      dev_tasks: devTasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    }),
  ]);
  console.log(`[orchestrator] Created verify task: ${result.rows[0].id} for initiative ${initiative.id}`);
  return result.rows[0];
}

/**
 * 健康检查：最近 5 个 dev task 有 3 个失败 → 需要 replan
 *
 * @param {Object[]} devTasks - dev 类型的 tasks
 * @returns {{ replan: boolean, reason?: string }}
 */
function checkInitiativeHealth(devTasks) {
  if (devTasks.length < 5) return { replan: false };

  // 按完成时间排序，取最近 5 个已结束的
  const finished = devTasks
    .filter(t => ['completed', 'failed'].includes(t.status))
    .sort((a, b) => new Date(b.completed_at || b.updated_at || 0) - new Date(a.completed_at || a.updated_at || 0))
    .slice(0, 5);

  if (finished.length < 5) return { replan: false };

  const failedCount = finished.filter(t => t.status === 'failed').length;
  if (failedCount >= 3) {
    return { replan: true, reason: `${failedCount}/5 recent dev tasks failed` };
  }
  return { replan: false };
}

/**
 * 主入口：遍历所有 orchestrated initiative，调用 getNextStep 并执行
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ actions: number, details: Object[] }>}
 */
async function checkOrchestratedInitiatives(pool) {
  const result = await pool.query(`
    SELECT p.id, p.name, p.current_phase, p.dod_content, p.description,
           p.parent_id, p.kr_id,
           parent_proj.repo_path
    FROM projects p
    LEFT JOIN projects parent_proj ON parent_proj.id = p.parent_id
    WHERE p.type = 'initiative'
      AND p.execution_mode = 'orchestrated'
      AND p.current_phase IS NOT NULL
      AND p.status = 'active'
  `);

  const details = [];
  let actions = 0;

  for (const initiative of result.rows) {
    // 获取该 initiative 下的所有 tasks
    const tasksResult = await pool.query(`
      SELECT id, title, task_type, status, payload, completed_at, updated_at
      FROM tasks
      WHERE project_id = $1
      ORDER BY created_at ASC
    `, [initiative.id]);

    // 解析 payload
    const tasks = tasksResult.rows.map(t => ({
      ...t,
      payload: typeof t.payload === 'string' ? JSON.parse(t.payload) : t.payload,
    }));

    const step = getNextStepForInitiative(initiative, tasks);
    if (!step || step.action === 'waiting') {
      details.push({ initiative_id: initiative.id, step: step || { action: 'no_action' } });
      continue;
    }

    // 获取 KR ID（从 initiative 或 parent project）
    let krId = initiative.kr_id;
    if (!krId && initiative.parent_id) {
      const krResult = await pool.query(
        'SELECT kr_id FROM project_kr_links WHERE project_id = $1 LIMIT 1',
        [initiative.parent_id]
      );
      krId = krResult.rows[0]?.kr_id || null;
    }

    try {
      if (step.action === 'create_plan_task') {
        await createPlanTask(pool, initiative, krId, initiative.repo_path);
        actions++;
      } else if (step.action === 'create_review_task') {
        // 复用 decomp_review task type（Vivian）
        await pool.query(`
          INSERT INTO tasks (title, description, task_type, status, project_id, goal_id, priority, payload, trigger_source)
          VALUES ($1, $2, 'decomp_review', 'queued', $3, $4, 'P0', $5, 'orchestrator')
        `, [
          `Review: ${initiative.name}`,
          `审查 initiative "${initiative.name}" 的 task 拆解质量`,
          initiative.id,
          krId,
          JSON.stringify({
            entity_type: 'initiative',
            entity_id: initiative.id,
            initiative_name: initiative.name,
            dod_content: initiative.dod_content,
          }),
        ]);
        actions++;
      } else if (step.action === 'transition') {
        const success = await handlePhaseTransition(pool, initiative, step.from, step.to);
        if (success) actions++;
      } else if (step.action === 'promote_and_transition') {
        await promoteInitiativeTasks(pool, initiative.id);
        const success = await handlePhaseTransition(pool, initiative, step.from, step.to);
        if (success) actions++;
      } else if (step.action === 'create_verify_task') {
        const devTasks = tasks.filter(t => t.task_type === 'dev');
        await createVerifyTask(pool, initiative, devTasks, krId);
        actions++;
      } else if (step.action === 'complete_initiative') {
        const success = await handlePhaseTransition(pool, initiative, 'verify', null);
        if (success) actions++;
      } else if (step.action === 'cancel_initiative') {
        await pool.query(`
          UPDATE projects SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1
        `, [initiative.id]);
        actions++;
      }

      details.push({ initiative_id: initiative.id, step });
    } catch (err) {
      console.error(`[orchestrator] Error processing initiative ${initiative.id}: ${err.message}`);
      details.push({ initiative_id: initiative.id, step, error: err.message });
    }
  }

  return { actions, details };
}

export {
  getNextStepForInitiative,
  handlePhaseTransition,
  promoteInitiativeTasks,
  createPlanTask,
  createVerifyTask,
  checkInitiativeHealth,
  checkOrchestratedInitiatives,
  VALID_TRANSITIONS,
};
