import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import { bootstrapNotionDatabases, configureNotionProjection } from '../projection/notion.js';
import { queueLaneSql } from '../task-queue-lanes.js';

const router = Router();
router.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

router.get('/projections/status', async (_req, res) => {
  try {
    const [outbox, links, commands, targets] = await Promise.all([
      pool.query(`SELECT target, status, COUNT(*)::int AS count
                  FROM projection_outbox GROUP BY target, status ORDER BY target, status`),
      pool.query(`SELECT target, entity_type, COUNT(*)::int AS count, MAX(last_synced_at) AS last_synced_at
                  FROM projection_links GROUP BY target, entity_type ORDER BY target, entity_type`),
      pool.query(`SELECT target, status, COUNT(*)::int AS count
                  FROM projection_commands GROUP BY target, status ORDER BY target, status`),
      pool.query(`SELECT target, enabled,
                         COALESCE(config ? 'task_db_id', false) AS task_database_ready,
                         COALESCE(config ? 'project_db_id', false) AS project_database_ready,
                         last_success_at, last_error, updated_at
                  FROM projection_targets ORDER BY target`),
    ]);
    res.json({
      outbox: outbox.rows,
      links: links.rows,
      commands: commands.rows,
      targets: targets.rows,
      credentials: {
        notion_token: Boolean(process.env.NOTION_INBOX_TOKEN || process.env.NOTION_API_TOKEN || process.env.NOTION_API_KEY),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load projection status', details: error.message });
  }
});

router.post('/projections/requeue', async (req, res) => {
  try {
    const { target = 'notion' } = req.body ?? {};
    const { rowCount } = await pool.query(
      `UPDATE projection_outbox
       SET status='pending', attempts=0, last_error=NULL, available_at=NOW(), updated_at=NOW()
       WHERE target=$1 AND status IN ('failed','dead')`,
      [target]
    );
    res.json({ requeued: rowCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to requeue projection', details: error.message });
  }
});

router.post('/projections/notion/bootstrap', async (req, res) => {
  try {
    const result = await bootstrapNotionDatabases(pool, req.body?.parent_page_id);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/projections/notion/configure', async (req, res) => {
  try {
    const result = await configureNotionProjection(pool, {
      taskDbId: req.body?.task_db_id,
      projectDbId: req.body?.project_db_id,
      parentPageId: req.body?.parent_page_id ?? null,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/workbench/activity', async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 100, 300);
    const [attempts, events] = await Promise.all([
      pool.query(
        `SELECT ha.id, ha.provider, ha.role, ha.phase, ha.status, ha.machine_id,
                ha.started_at, ha.completed_at, ha.error_code, ha.error_message,
                ir.current_task_id AS task_id, t.title AS task_title
         FROM harness_attempts ha
         JOIN initiative_runs ir ON ir.id=ha.run_id
         LEFT JOIN tasks t ON t.id=ir.current_task_id
         ORDER BY ha.created_at DESC LIMIT $1`,
        [limit]
      ),
      pool.query(
        `SELECT e.id, e.event_type, e.source, e.payload, e.task_id, e.created_at,
                t.title AS task_title
         FROM cecelia_events e
         LEFT JOIN tasks t ON t.id=e.task_id
         ORDER BY e.created_at DESC LIMIT $1`,
        [limit]
      ),
    ]);
    res.json({ attempts: attempts.rows, events: events.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load workbench activity', details: error.message });
  }
});

router.get('/workbench/summary', async (_req, res) => {
  try {
    const [tasks, captures, projection] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('queued','pending') AND claimed_by IS NULL)::int AS waiting,
           COUNT(*) FILTER (WHERE ${queueLaneSql('tasks')}='ready')::int AS ready,
           COUNT(*) FILTER (WHERE ${queueLaneSql('tasks')}='ide')::int AS ide,
           COUNT(*) FILTER (WHERE ${queueLaneSql('tasks')}='pipeline')::int AS pipeline,
           COUNT(*) FILTER (WHERE status='in_progress' AND claimed_by IS NOT NULL)::int AS in_progress,
           COUNT(*) FILTER (WHERE status IN ('blocked','paused','quarantined','failed'))::int AS blocked,
           COUNT(*) FILTER (WHERE status='completed')::int AS done,
           COUNT(*) FILTER (WHERE status='cancelled')::int AS dropped
         FROM tasks`
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status='captured')::int AS captured,
                COUNT(*) FILTER (WHERE status='clarified')::int AS clarified
         FROM captures`
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('pending','failed'))::int AS pending,
                COUNT(*) FILTER (WHERE status='dead')::int AS dead
         FROM projection_outbox`
      ),
    ]);
    res.json({ tasks: tasks.rows[0], captures: captures.rows[0], projection: projection.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load workbench summary', details: error.message });
  }
});

export default router;
