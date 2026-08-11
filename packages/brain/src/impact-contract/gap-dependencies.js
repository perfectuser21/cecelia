/** Gap 修复任务、逐 Gap 硬依赖与查询操作。 */

export async function assignRepairTask(db, gapId, repairTaskId) {
  const result = await db.query(
    'UPDATE harness_gaps SET repair_task_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [repairTaskId, gapId],
  );
  if (result.rows.length === 0) {
    const err = new Error(`gap_not_found: ${gapId}`);
    err.code = 'gap_not_found';
    err.httpStatus = 404;
    throw err;
  }
  return result.rows[0];
}

export async function addHardDependency(db, {
  fromTaskId,
  toTaskId,
  gapId,
  edgeType = 'hard',
}) {
  const result = await db.query(
    `INSERT INTO task_dependencies (from_task_id, to_task_id, gap_id, edge_type, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (from_task_id, to_task_id)
       DO UPDATE SET status = 'pending',
                     edge_type = EXCLUDED.edge_type
     RETURNING *, (xmax = 0) AS created`,
    [fromTaskId, toTaskId, gapId, edgeType],
  );
  await db.query(
    `INSERT INTO harness_gap_dependencies
       (gap_id, source_task_id, repair_task_id, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (gap_id)
       DO UPDATE SET source_task_id = EXCLUDED.source_task_id,
                     repair_task_id = EXCLUDED.repair_task_id,
                     status = 'pending',
                     updated_at = NOW()`,
    [gapId, fromTaskId, toTaskId],
  );
  const row = result.rows[0];
  return { dep: row, created: row.created };
}

export async function assignRepairTaskWithDependency(db, gapId, repairTaskId) {
  const isPool = typeof db.connect === 'function' && db.constructor?.name !== 'Client';
  const client = isPool ? await db.connect() : db;
  try {
    if (isPool) await client.query('BEGIN');
    const currentResult = await client.query(
      'SELECT * FROM harness_gaps WHERE id = $1 FOR UPDATE',
      [gapId],
    );
    const currentGap = currentResult.rows[0];
    if (!currentGap) {
      const err = new Error(`gap_not_found: ${gapId}`);
      err.code = 'gap_not_found';
      err.httpStatus = 404;
      throw err;
    }

    if (currentGap.repair_task_id && currentGap.repair_task_id !== repairTaskId) {
      await client.query(
        `UPDATE harness_gap_dependencies
         SET status = 'cancelled', updated_at = NOW()
         WHERE gap_id = $1 AND status = 'pending'`,
        [gapId],
      );
      await client.query(
        `UPDATE task_dependencies AS dependency
         SET status = 'cancelled'
         WHERE dependency.from_task_id = $1
           AND dependency.to_task_id = $2
           AND dependency.status = 'pending'
           AND NOT EXISTS (
             SELECT 1
             FROM harness_gap_dependencies AS pending_gap
             WHERE pending_gap.source_task_id = dependency.from_task_id
               AND pending_gap.repair_task_id = dependency.to_task_id
               AND pending_gap.status = 'pending'
           )`,
        [currentGap.source_task_id, currentGap.repair_task_id],
      );
    }

    const gap = await assignRepairTask(client, gapId, repairTaskId);
    const { dep } = await addHardDependency(client, {
      fromTaskId: gap.source_task_id,
      toTaskId: repairTaskId,
      gapId,
    });
    if (isPool) await client.query('COMMIT');
    return { gap, dependency: dep };
  } catch (error) {
    if (isPool) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (isPool) client.release();
  }
}

export async function createRepairTaskForGap(db, gap, { repo } = {}) {
  if (gap.repair_task_id) return { id: gap.repair_task_id, created: false };
  const sourceResult = await db.query(
    `SELECT title, goal_id, project_id, domain, payload
     FROM tasks WHERE id = $1`,
    [gap.source_task_id],
  );
  const source = sourceResult.rows[0];
  if (!source) {
    const error = new Error(`gap source task not found: ${gap.source_task_id}`);
    error.code = 'source_task_missing';
    throw error;
  }
  const sourcePayload = source.payload && typeof source.payload === 'object'
    ? source.payload
    : {};
  const inheritedPayload = Object.fromEntries([
    'sprint_dir',
    'contract_path',
    'contract_draft_path',
    'prd_path',
    'task_plan_path',
    'journey_id',
    'ability_id',
  ].filter((key) => sourcePayload[key] !== undefined).map((key) => [key, sourcePayload[key]]));
  const title = `[Impact Gap] ${gap.impact_node_id}: ${source.title}`.slice(0, 255);
  const payload = {
    ...inheritedPayload,
    change_kind: 'bugfix',
    gear: 'single',
    impact_contract_required: true,
    impact_contract_decision_id: '4bc109e9',
    harness_gap_id: gap.id,
    source_task_id: gap.source_task_id,
    impact_node_id: gap.impact_node_id,
    current_revision: gap.current_revision,
    base_repo: repo ?? sourcePayload.base_repo ?? null,
  };
  const inserted = await db.query(
    `INSERT INTO tasks (
       title, description, task_type, status, priority, goal_id, project_id,
       payload, trigger_source, domain, owner_role, created_by
     ) VALUES (
       $1, $2, 'dev', 'queued', $3, $4, $5,
       $6::jsonb, 'impact_diff_gate', $7, $8, 'cecelia-brain'
     )
     RETURNING *`,
    [
      title,
      `Repair Impact Contract drift for ${gap.impact_node_id} at ${gap.current_revision}`,
      gap.severity === 'critical' ? 'P0' : 'P1',
      source.goal_id,
      source.project_id,
      JSON.stringify(payload),
      source.domain,
      gap.owner,
    ],
  );
  const repairTask = inserted.rows[0];
  if (!repairTask) throw new Error(`failed to create repair task for gap ${gap.id}`);
  await assignRepairTaskWithDependency(db, gap.id, repairTask.id);
  return { ...repairTask, created: true };
}

export async function listGapsByStatus(db, status) {
  const result = await db.query(
    'SELECT * FROM harness_gaps WHERE status = $1 ORDER BY created_at DESC',
    [status],
  );
  return result.rows;
}

export async function getGapsByTask(db, taskId) {
  const result = await db.query(
    `SELECT * FROM harness_gaps
     WHERE source_task_id = $1 OR repair_task_id = $1
     ORDER BY created_at DESC`,
    [taskId],
  );
  return result.rows;
}

export async function getGapById(db, gapId) {
  const result = await db.query('SELECT * FROM harness_gaps WHERE id = $1', [gapId]);
  return result.rows[0] ?? null;
}

export async function getGapEvents(db, gapId) {
  const result = await db.query(
    `SELECT * FROM gap_events
     WHERE gap_id = $1
     ORDER BY created_at ASC`,
    [gapId],
  );
  return result.rows;
}

export async function getDependenciesByTask(db, taskId) {
  const result = await db.query(
    `SELECT * FROM task_dependencies
     WHERE from_task_id = $1 OR to_task_id = $1
     ORDER BY created_at DESC`,
    [taskId],
  );
  return result.rows;
}
