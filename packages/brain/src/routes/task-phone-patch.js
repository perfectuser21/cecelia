import { phoneOrdinaryQueueSql } from '../task-queue-lanes.js';

const PHONE_METADATA_FIELDS = new Set(['title', 'priority', 'description']);
export function phoneMetadataOnly(body) {
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every(key => PHONE_METADATA_FIELDS.has(key));
}

// Use the request-scoped pool: the headed wrapper authenticates and locks on this first task read.
export async function readPhonePatchAuthority(pool, id) {
  const result = await pool.query(
    `SELECT id, (${phoneOrdinaryQueueSql('tasks')}) AS ordinary_eligible FROM tasks WHERE id = $1`, [id],
  );
  if (result.rows.length === 0) return 'missing';
  if (result.rows.length !== 1 || typeof result.rows[0].ordinary_eligible !== 'boolean') {
    throw Error('phone_patch_authority_unknown');
  }
  return result.rows[0].ordinary_eligible ? 'ordinary' : 'phone';
}

export function phonePatchRejection(res, authority, id, legacy = false) {
  if (authority === 'phone') return res.status(409).json({ error: 'phone_task_owned' });
  if (authority === 'missing') return res.status(404).json(legacy
    ? { success: false, error: 'Task not found', code: 'TASK_NOT_FOUND' }
    : { error: 'Task not found', id });
  return res.status(409).json({ error: 'task_patch_conflict' });
}

export async function checkPhonePatchWrite(pool, result, res, id, legacy = false) {
  if (![0, 1].includes(result.rowCount) || result.rows.length !== result.rowCount) {
    throw Error('phone_patch_mutation_count_unknown');
  }
  if (result.rowCount === 1) return true;
  phonePatchRejection(res, await readPhonePatchAuthority(pool, id), id, legacy);
  return false;
}
