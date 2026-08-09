import { syncNotionEntity } from './notion.js';

async function updateOutbox(pool, event, outcome, error = null) {
  if (outcome === 'done') {
    await pool.query(
      `UPDATE projection_outbox
       SET status='done', attempts=attempts+1, last_error=NULL, leased_at=NULL, updated_at=NOW()
       WHERE id=$1`,
      [event.id]
    );
    return;
  }
  if (outcome === 'deferred') {
    await pool.query(
      `UPDATE projection_outbox
       SET status='pending', last_error=$2, leased_at=NULL,
           available_at=NOW()+INTERVAL '5 minutes', updated_at=NOW()
       WHERE id=$1`,
      [event.id, error]
    );
    return;
  }
  await pool.query(
    `UPDATE projection_outbox
     SET status=CASE WHEN attempts+1 >= 5 THEN 'dead' ELSE 'failed' END,
         attempts=attempts+1, last_error=$2, leased_at=NULL,
         available_at=NOW()+LEAST(attempts+1, 5)*INTERVAL '2 minutes', updated_at=NOW()
     WHERE id=$1`,
    [event.id, error]
  );
}

export async function runProjectionOutbox(pool, {
  adapter = syncNotionEntity,
  limit = 50,
} = {}) {
  const { rows } = await pool.query(
    `UPDATE projection_outbox
     SET status='processing', leased_at=NOW(), updated_at=NOW()
     WHERE id IN (
       SELECT id FROM projection_outbox
       WHERE (status IN ('pending','failed') AND available_at <= NOW())
          OR (status='processing' AND leased_at < NOW()-INTERVAL '10 minutes')
       ORDER BY CASE WHEN entity_type='projects' THEN 0 ELSE 1 END,
                created_at ASC
       LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit]
  );

  const summary = { processed: rows.length, done: 0, failed: 0, deferred: 0 };
  for (const event of rows) {
    try {
      const result = await adapter(pool, event);
      if (result?.skipped && ['entity_not_found', 'unsupported_target'].includes(result.reason)) {
        summary.done += 1;
        await updateOutbox(pool, event, 'done');
      } else if (result?.skipped) {
        summary.deferred += 1;
        await updateOutbox(pool, event, 'deferred', result.reason || 'adapter_skipped');
      } else {
        summary.done += 1;
        await updateOutbox(pool, event, 'done');
      }
    } catch (error) {
      summary.failed += 1;
      await updateOutbox(pool, event, 'failed', error.message);
    }
  }
  return summary;
}
