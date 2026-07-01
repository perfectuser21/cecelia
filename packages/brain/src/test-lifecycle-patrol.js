import { existsSync } from 'fs';
import { join } from 'path';
import { raise } from './alerting.js';
import pool from './db.js';

export const PATROL_HOUR_UTC = 2;
export const PATROL_WINDOW_MINUTES = 5;
const STALE_DAYS = 30;

export function isInPatrolWindow(now = new Date()) {
  return now.getUTCHours() === PATROL_HOUR_UTC && now.getUTCMinutes() < PATROL_WINDOW_MINUTES;
}

function repoRoot() {
  return process.env.REPO_ROOT || new URL('../../..', import.meta.url).pathname;
}

export async function runTestLifecyclePatrol(db = pool, now = new Date()) {
  const patrolDate = now.toISOString().slice(0, 10);
  const root = repoRoot();

  const { rows } = await db.query(
    'SELECT id, file_path, status, feature_id, scanned_at FROM test_registry'
  );

  const staleAlerts = [];

  for (const row of rows) {
    const fileExists = existsSync(join(root, row.file_path));

    if (!fileExists) {
      await db.query('DELETE FROM test_registry WHERE id = $1', [row.id]);
      continue;
    }
  }

  return { staleAlerts };
}
