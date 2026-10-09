import { createReviewTask, shouldTriggerReview } from './review-gate.js';

/** 拆解完成：Project→Task 产出送审；确认门仍由主理人处理。 */
export async function triggerCompletedDecompositionReview(pool, taskId, {
  shouldReview = shouldTriggerReview, createReview = createReviewTask,
} = {}) {
  const { rows: tasks } = await pool.query(
    'SELECT task_type, payload, result, goal_id, project_id FROM tasks WHERE id = $1', [taskId]
  );
  const task = tasks[0];
  if (![true, 'true'].includes(task?.payload?.decomposition) || task.task_type === 'decomp_review' || !task.goal_id) {
    return { skipped: true, reason: 'not_decomposition' };
  }
  const krId = task.goal_id;
  const { rows: krs } = await pool.query(
    `SELECT id, title, status FROM key_results WHERE id = $1
     AND (status = $2 OR ($3::boolean AND status = 'reviewing'))`,
    [krId, 'decomposing', task.payload?.revision === true]
  );
  if (!krs.length) return { skipped: true, reason: 'kr_not_decomposing' };
  const projectId = task.project_id || task.payload?.project_id || task.result?.decomposition_project_id
    || (task.payload?.entity_type === 'project' ? task.payload?.entity_id : null) || null;
  const { rows: projects } = await pool.query(
    `SELECT id, name FROM projects WHERE kr_id = $1
     AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at DESC`, [krId, projectId]
  );
  if (!projectId && projects.length > 1) return { skipped: true, reason: 'ambiguous_project' };
  const project = projects[0];
  if (!project) return { skipped: true, reason: 'no_project' };
  const { rows: children } = await pool.query(
    `SELECT title FROM tasks WHERE project_id = $1 AND task_type <> 'project'
     ORDER BY sequence_no ASC NULLS LAST, created_at ASC`, [project.id]
  );
  if (!children.length) return { skipped: true, reason: 'no_tasks' };
  if (await shouldReview(pool, 'project', project.id)) {
    await createReview(pool, {
      entityType: 'project', entityId: project.id, entityName: project.name, parentKrId: krId,
    });
  }
  await pool.query(
    `UPDATE projects SET status = 'pending_review', updated_at = NOW()
     WHERE id = $1 AND status IN ('active', 'planning')`, [project.id]
  );
  const { rows: existing } = await pool.query(
    `SELECT id FROM pending_actions WHERE action_type = 'okr_decomp_review'
     AND status = 'pending_approval' AND params->>'kr_id' = $1
     AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`, [krId]
  );
  const params = JSON.stringify({ kr_id: krId, project_id: project.id });
  const context = JSON.stringify({
    kr_id: krId, kr_title: krs[0].title, project_name: project.name,
    tasks: children.map(child => child.title), decomposition_task_id: taskId,
    decomposed_at: new Date().toISOString(),
  });
  if (!existing.length) {
    await pool.query(
      `INSERT INTO pending_actions(action_type, category, params, context, priority, source, expires_at, status)
       VALUES('okr_decomp_review','approval',$1,$2,'urgent','okr_decomposer',
              NOW()+INTERVAL '72 hours','pending_approval')`, [params, context]
    );
  } else {
    await pool.query(
      `UPDATE pending_actions SET params = $1, context = $2 WHERE id = $3`,
      [params, context, existing[0].id]
    );
  }
  await pool.query(
    `UPDATE key_results SET status = 'reviewing', updated_at = NOW()
     WHERE id = $1 AND status = 'decomposing'`, [krId]
  );
  return { reviewed: true, project_id: project.id, kr_id: krId };
}
