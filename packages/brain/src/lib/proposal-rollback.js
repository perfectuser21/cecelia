// Current proposal rollback; the public wrapper supplies its canonical pool and reader.
export async function rollbackAppliedProposal(pool, proposalId, getProposal) {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'applied') {
    throw new Error(`Cannot rollback proposal in status "${proposal.status}"`);
  }

  const snapshot = proposal.snapshot || {};
  const results = [];

  // Restore tasks from snapshot
  for (const [taskId, taskData] of Object.entries(snapshot.tasks || {})) {
    try {
      await pool.query(`
        UPDATE tasks SET priority = $2, status = $3, payload = $4, updated_at = NOW()
        WHERE id = $1
      `, [taskId, taskData.priority, taskData.status, taskData.payload || {}]);
      results.push({ task_id: taskId, restored: true });
    } catch (err) {
      results.push({ task_id: taskId, restored: false, error: err.message });
    }
  }

  // Restore focus if snapshotted
  if (snapshot.focus !== undefined) {
    if (snapshot.focus === null) {
      await pool.query("DELETE FROM working_memory WHERE key = 'daily_focus_override'");
    } else {
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ('daily_focus_override', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
      `, [snapshot.focus]);
    }
    results.push({ focus: 'restored' });
  }

  // Delete tasks created by this proposal
  const changes = proposal.changes || [];
  for (const change of changes) {
    if (change.type === 'create_task') {
      const created = await pool.query(
        "SELECT id FROM tasks WHERE payload->>'proposal_id' = $1",
        [proposalId]
      );
      for (const row of created.rows) {
        const removed = await pool.query(
          "DELETE FROM tasks WHERE id = $1 AND status = 'queued' RETURNING id", [row.id]
        );
        if (removed.rowCount === 1) {
          results.push({ task_id: row.id, deleted: true });
          continue;
        }
        // The predicate is a safety boundary: an active/completed task stays intact.
        // A post-attempt read reports observed state, never credits another actor's deletion.
        let status = null;
        let reason = removed.rowCount === 0 ? 'not_found_after_delete_attempt' : 'delete_result_unknown';
        try {
          const observed = await pool.query('SELECT status FROM tasks WHERE id = $1', [row.id]);
          if (observed.rows[0]) {
            status = observed.rows[0].status ?? null;
            if (removed.rowCount === 0) {
              reason = status === null ? 'status_unknown' : status === 'queued' ? 'not_deleted' : 'not_queued';
            }
          }
        } catch {
          reason = 'status_read_failed';
        }
        results.push({ task_id: row.id, deleted: false, status, reason });
      }
    }
  }

  await pool.query(`
    UPDATE proposals SET status = 'rolled_back', rolled_back_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [proposalId]);

  const warnings = results.flatMap(result => {
    if (result.deleted === false) {
      return [{ kind: 'task_not_deleted', task_id: result.task_id, status: result.status, reason: result.reason }];
    }
    if (result.restored === false) return [{ kind: 'task_restore_failed', task_id: result.task_id }];
    return [];
  });
  // Preserve the existing best-effort lifecycle marker; it is not a claim that every item succeeded.
  return {
    proposal_id: proposalId,
    status: 'rolled_back',
    results,
    ...(warnings.length ? { partial: true, warnings } : {}),
  };
}
