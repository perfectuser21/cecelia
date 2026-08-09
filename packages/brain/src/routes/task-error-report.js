import { Router } from 'express';
import pool from '../db.js';
import { blockTask } from '../task-updater.js';
import { classifyFailure as importedClassifyFailure } from '../quarantine.js';

const router = Router();
const FAILURE_CLASS = {
  TIMEOUT: 'timeout',
  SERVER_ERROR: 'server_error',
  TASK_ERROR: 'task_error',
};
const TTL_MAP = {
  network: 5 * 60 * 1000,
  timeout: 5 * 60 * 1000,
  server_error: 5 * 60 * 1000,
  rate_limit: 10 * 60 * 1000,
  billing_cap: 30 * 60 * 1000,
  auth: 15 * 60 * 1000,
  resource: 5 * 60 * 1000,
};

function classifyFailure(...args) {
  if (typeof importedClassifyFailure === 'function') return importedClassifyFailure(...args);
  return { class: 'task_error', retry_strategy: null };
}

router.post('/:id/error-report', async (req, res) => {
  try {
    const { id } = req.params;
    const { error_type, error_message, stack_trace, context = {} } = req.body;
    if (!error_message) return res.status(400).json({ error: 'error_message is required' });

    const taskResult = await pool.query('SELECT id, title, status, payload FROM tasks WHERE id = $1', [id]);
    if (taskResult.rows.length === 0) return res.status(404).json({ error: 'Task not found', id });

    const classification = classifyFailure(error_message, taskResult.rows[0]);
    const ttlMs = TTL_MAP[classification.class];
    if (ttlMs !== undefined) {
      const blockedUntil = new Date(Date.now() + ttlMs).toISOString();
      await blockTask(id, {
        reason: `${classification.class} error - auto-blocked`,
        detail: { error_type: error_type || classification.class, error_message, stack_trace, context, failure_classification: classification },
        until: blockedUntil,
      });
      return res.json({ action: 'blocked', task_id: id, failure_class: classification.class, blocked_until: blockedUntil, reason: classification.retry_strategy?.reason || 'Transient error' });
    }

    if (classification.class === FAILURE_CLASS.TASK_ERROR) {
      await pool.query(
        `UPDATE tasks SET status='failed', updated_at=NOW(),
           payload=COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id=$1`,
        [id, JSON.stringify({ error_details: error_message, failure_classification: classification, last_error_at: new Date().toISOString() })]
      );
      return res.json({ action: 'failed', task_id: id, failure_class: classification.class, reason: classification.retry_strategy?.reason || 'Task error - retryable' });
    }

    const { quarantineTask } = await import('../quarantine.js');
    await quarantineTask(id, 'permanent_error', { failure_class: classification.class, error_message, stack_trace, context });
    return res.json({ action: 'quarantined', task_id: id, failure_class: classification.class, reason: 'Permanent error - requires human review' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process error report', details: err.message });
  }
});

export default router;
