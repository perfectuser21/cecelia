const ALLOWED_COMMANDS = new Set([
  'start_requested',
  'cancel_requested',
  'annotate_requested',
]);

export async function recordProjectionCommand(pool, {
  target,
  externalId,
  entityType = 'tasks',
  entityId,
  commandType,
  payload = {},
}) {
  if (!target || !externalId || !ALLOWED_COMMANDS.has(commandType)) {
    throw new Error('invalid projection command');
  }
  const { rows } = await pool.query(
    `INSERT INTO projection_commands (
       target, external_id, entity_type, entity_id, command_type, payload
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (target, external_id, command_type) DO UPDATE
       SET payload = EXCLUDED.payload
     RETURNING *`,
    [target, externalId, entityType, entityId || null, commandType, JSON.stringify(payload)]
  );
  return rows[0] ?? null;
}

async function finish(pool, id, status, reason = null) {
  await pool.query(
    `UPDATE projection_commands
     SET status=$2, reason=$3, leased_at=NULL, processed_at=NOW()
     WHERE id=$1`,
    [id, status, reason]
  );
}

async function fail(pool, command, error) {
  await pool.query(
    `UPDATE projection_commands
     SET status=CASE WHEN attempts+1 >= 5 THEN 'dead' ELSE 'failed' END,
         attempts=attempts+1, reason=$2, leased_at=NULL,
         available_at=NOW()+LEAST(attempts+1, 5)*INTERVAL '2 minutes'
     WHERE id=$1`,
    [command.id, error]
  );
}

async function applyOne(pool, command) {
  const { rows } = await pool.query(
    'SELECT id, status FROM tasks WHERE id=$1 FOR UPDATE',
    [command.entity_id]
  );
  const task = rows[0];
  if (!task) {
    await finish(pool, command.id, 'rejected', 'task_not_found');
    return 'rejected';
  }

  if (command.command_type === 'start_requested') {
    if (!['queued', 'pending'].includes(task.status)) {
      await finish(pool, command.id, 'rejected', `invalid_status:${task.status}`);
      return 'rejected';
    }
    await pool.query(
      `UPDATE tasks
       SET priority = CASE WHEN priority='P2' THEN 'P1' ELSE priority END,
           payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
             'start_requested_at', NOW(), 'start_requested_source', 'projection'
           ),
           updated_at = NOW()
       WHERE id=$1`,
      [task.id]
    );
  } else if (command.command_type === 'cancel_requested') {
    if (!['queued', 'pending', 'blocked', 'paused'].includes(task.status)) {
      await finish(pool, command.id, 'rejected', `active_or_terminal:${task.status}`);
      return 'rejected';
    }
    await pool.query(
      `UPDATE tasks SET status='cancelled', updated_at=NOW() WHERE id=$1`,
      [task.id]
    );
  } else if (command.command_type === 'annotate_requested') {
    const annotation = String(command.payload?.annotation ?? '').trim();
    if (!annotation) {
      await finish(pool, command.id, 'rejected', 'empty_annotation');
      return 'rejected';
    }
    await pool.query(
      `UPDATE tasks
       SET description=COALESCE(description, '') || $2, updated_at=NOW()
       WHERE id=$1`,
      [task.id, `\n[Projection 批注] ${annotation}`]
    );
  }

  await pool.query(
    `INSERT INTO cecelia_events (event_type, source, payload)
     VALUES ('projection_command_applied', $1, $2)`,
    [command.target, JSON.stringify({ command_id: command.id, command_type: command.command_type, task_id: task.id })]
  );
  await finish(pool, command.id, 'applied');
  return 'applied';
}

export async function applyProjectionCommands(pool, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `UPDATE projection_commands
     SET status='processing', leased_at=NOW()
     WHERE id IN (
       SELECT id FROM projection_commands
       WHERE (status IN ('pending','failed') AND available_at <= NOW())
          OR (status='processing' AND leased_at < NOW()-INTERVAL '10 minutes')
       ORDER BY created_at ASC LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit]
  );

  const result = { applied: 0, rejected: 0, failed: 0 };
  for (const command of rows) {
    try {
      const outcome = await applyOne(pool, command);
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      await fail(pool, command, error.message);
    }
  }
  return result;
}
