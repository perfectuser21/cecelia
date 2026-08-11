/** 注册 tasks/:id 的字段更新与状态保护路由。 */
export function registerTaskPatchRoute(router, { pool, terminalStatuses }) {
  router.patch('/:id', async (req, res) => {
    try {
      const {
        status,
        priority,
        title,
        okr_initiative_id: okrInitiativeId,
        pr_url: prUrl,
        result: taskResult,
        description,
      } = req.body;
      let harnessDemoted = false;
      let harnessDemoteReason = null;

      if (status !== undefined) {
        const current = await pool.query(
          `SELECT status,
                  task_type,
                  payload->>'orchestrator' AS orchestrator,
                  EXISTS (
                    SELECT 1 FROM harness_gaps
                    WHERE source_task_id = tasks.id AND status <> 'resolved'
                  ) AS has_unresolved_harness_gaps,
                  EXISTS (
                    SELECT 1 FROM harness_gap_dependencies
                    WHERE source_task_id = tasks.id AND status = 'pending'
                  ) OR EXISTS (
                    SELECT 1 FROM task_dependencies
                    WHERE from_task_id = tasks.id
                      AND edge_type = 'hard'
                      AND status = 'pending'
                  ) AS has_pending_hard_dependencies
           FROM tasks
           WHERE id = $1`,
          [req.params.id],
        );
        if (!current.rows.length) {
          return res.status(404).json({ error: 'Task not found', id: req.params.id });
        }
        const currentTask = current.rows[0];
        if (
          currentTask.status === 'blocked'
          && ['queued', 'in_progress', 'completed'].includes(status)
          && (
            currentTask.has_unresolved_harness_gaps
            || currentTask.has_pending_hard_dependencies
          )
        ) {
          return res.status(409).json({
            error: 'harness_gap_dependencies_unresolved',
            details: 'Harness Gap 或硬依赖尚未验真完成',
          });
        }
        if (terminalStatuses.includes(currentTask.status) && !terminalStatuses.includes(status)) {
          return res.status(409).json({
            error: 'State machine violation',
            details: `Cannot transition from terminal status '${currentTask.status}' to '${status}'`,
          });
        }
        if (
          status === 'completed'
          && currentTask.task_type === 'harness_initiative'
          && currentTask.orchestrator === 'skill-relay'
        ) {
          const { finalizeHarnessTask } = await import('../lib/harness-finalize.js');
          const finalization = await finalizeHarnessTask(req.params.id, { pool });
          if (finalization.applies && !finalization.allow) {
            harnessDemoted = true;
            harnessDemoteReason = finalization.reason;
          }
        }
      }

      const setClauses = [];
      const params = [];
      let paramIndex = 1;
      if (status !== undefined && !harnessDemoted) {
        setClauses.push(`status = $${paramIndex++}`);
        params.push(status);
        if (status === 'in_progress') {
          setClauses.push('started_at = COALESCE(started_at, NOW())');
          setClauses.push(`claimed_by = COALESCE(claimed_by, $${paramIndex++})`);
          params.push(`session:${req.headers?.['x-session-id'] || 'engine-patch'}`);
          setClauses.push('claimed_at = COALESCE(claimed_at, NOW())');
          setClauses.push(`executor_kind = COALESCE(executor_kind, $${paramIndex++})`);
          params.push('headed-session');
        }
        if (status === 'completed') setClauses.push('completed_at = COALESCE(completed_at, NOW())');
      }
      for (const [column, value] of [
        ['priority', priority],
        ['title', title],
        ['description', description],
        ['okr_initiative_id', okrInitiativeId],
        ['pr_url', prUrl],
      ]) {
        if (value !== undefined) {
          setClauses.push(`${column} = $${paramIndex++}`);
          params.push(value);
        }
      }
      if (taskResult !== undefined) {
        setClauses.push(`success_metrics = $${paramIndex++}`);
        params.push(JSON.stringify(taskResult));
      }
      if (setClauses.length === 0 && !harnessDemoted) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      if (description) {
        const current = await pool.query(
          'SELECT status, blocked_reason, metadata FROM tasks WHERE id = $1',
          [req.params.id],
        );
        const task = current.rows[0];
        if (task?.status === 'blocked' && task.blocked_reason === 'pre_flight_rejected') {
          setClauses.push("status = 'queued'", 'blocked_reason = NULL', 'blocked_at = NULL', 'blocked_detail = NULL');
          const cleanedMetadata = { ...(task.metadata || {}) };
          delete cleanedMetadata.pre_flight_fail_count;
          delete cleanedMetadata.pre_flight_failed;
          delete cleanedMetadata.pre_flight_issues;
          delete cleanedMetadata.pre_flight_suggestions;
          setClauses.push(`metadata = $${paramIndex++}::jsonb`);
          params.push(JSON.stringify(cleanedMetadata));
        }
      }

      setClauses.push('updated_at = NOW()');
      params.push(req.params.id);
      const result = await pool.query(
        `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params,
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: 'Task not found', id: req.params.id });
      }
      return res.json(harnessDemoted
        ? { ...result.rows[0], accepted: false, reason: harnessDemoteReason }
        : result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update task', details: error.message });
    }
  });
}
