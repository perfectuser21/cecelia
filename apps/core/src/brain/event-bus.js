/**
 * EventBus - Unified event recording for Cecelia's silent layer
 *
 * All critical operations emit events here. Events are stored in
 * cecelia_events table for audit, replay, and debugging.
 */

import pool from '../task-system/db.js';

/**
 * Ensure cecelia_events table exists
 */
async function ensureEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cecelia_events (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      source VARCHAR(50) NOT NULL,
      payload JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Index for querying by type and time
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cecelia_events_type_time
    ON cecelia_events (event_type, created_at DESC)
  `);
}

/**
 * Emit an event
 * @param {string} eventType - e.g. task_dispatched, task_completed, task_failed, circuit_open, patrol_cleanup
 * @param {string} source - e.g. tick, executor, patrol, circuit_breaker
 * @param {Object} payload - Event data
 */
async function emit(eventType, source, payload = {}) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3)`,
      [eventType, source, payload]
    );
  } catch (err) {
    // Don't let event logging failures break the main flow
    console.error(`[event-bus] Failed to emit ${eventType}:`, err.message);
  }
}

/**
 * Query events with optional filters
 * @param {Object} options
 * @param {string} [options.eventType] - Filter by event type
 * @param {string} [options.source] - Filter by source
 * @param {number} [options.limit] - Max results (default 50)
 * @param {string} [options.since] - ISO timestamp to filter from
 * @returns {Array} Events
 */
async function queryEvents({ eventType, source, limit = 50, since } = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (eventType) {
    conditions.push(`event_type = $${paramIdx++}`);
    params.push(eventType);
  }
  if (source) {
    conditions.push(`source = $${paramIdx++}`);
    params.push(source);
  }
  if (since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT id, event_type, source, payload, created_at
     FROM cecelia_events ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIdx}`,
    [...params, limit]
  );

  return result.rows;
}

/**
 * Get event counts by type for a time period
 * @param {string} since - ISO timestamp
 * @returns {Array} Counts by event type
 */
async function getEventCounts(since) {
  const result = await pool.query(
    `SELECT event_type, COUNT(*) as count
     FROM cecelia_events
     WHERE created_at >= $1
     GROUP BY event_type
     ORDER BY count DESC`,
    [since]
  );
  return result.rows;
}

export { ensureEventsTable, emit, queryEvents, getEventCounts };
