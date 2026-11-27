import { randomUUID } from 'node:crypto';
import pool from './db.js';
import { collectBrainDrainScope } from './brain-drain-scope.js';

const PROTOCOL = 'brain-process-drain-v1';
const DRAIN_STATE_KEY = 'tick_draining';
export const DRAIN_RESTORE_MAX_AGE_MS = 15 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let _draining = false;
let _drainStartedAt = null;
let _drainId = null;
let revision = 0;
const launches = new Map();

let controlTail = Promise.resolve();
function writeControl(operation) {
  const result = controlTail.then(operation);
  controlTail = result.catch(() => {});
  return result;
}
function persistDrainState() {
  const value = { draining: true, drain_started_at: _drainStartedAt, drain_id: _drainId, protocol: PROTOCOL };
  return writeControl(() => pool.query(`INSERT INTO working_memory (key,value_json,updated_at)
    VALUES ($1,$2,NOW()) ON CONFLICT (key)
    DO UPDATE SET value_json=$2,updated_at=NOW()`, [DRAIN_STATE_KEY, value]));
}
function clearPersistedDrainState(id) {
  return pool.query(`DELETE FROM working_memory WHERE key=$1
    AND (value_json->>'drain_id') IS NOT DISTINCT FROM $2::text`, [DRAIN_STATE_KEY, id ?? null]);
}

export async function restoreDrainState() {
  const before = revision;
  const saved = (await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [DRAIN_STATE_KEY])).rows[0]?.value_json;
  if (revision !== before || saved?.draining !== true) return;
  if (saved.drain_id == null) {
    const started = Date.parse(saved.drain_started_at ?? '');
    if (!Number.isFinite(started) || Date.now() - started > DRAIN_RESTORE_MAX_AGE_MS) {
      await writeControl(() => clearPersistedDrainState(null));
      return;
    }
  }
  revision++;
  _draining = true;
  _drainStartedAt = saved.drain_started_at ?? null;
  _drainId = typeof saved.drain_id === 'string' && UUID.test(saved.drain_id) ? saved.drain_id : randomUUID();
  if (saved.drain_id !== _drainId) await persistDrainState();
}
export function isDraining() { return _draining; }
export function getDrainStartedAt() { return _drainStartedAt; }

export function beginBrainLaunch(taskId) {
  if (_draining) return null;
  const token = Symbol('brain-launch');
  launches.set(token, { taskId, startedAt: new Date().toISOString() });
  return token;
}
export function ownsBrainLaunch(token, taskId) {
  const entry = launches.get(token);
  return Boolean(entry && (!entry.taskId || entry.taskId === taskId));
}
export function finishBrainLaunch(token) { launches.delete(token); }

/** Task-associated counterevidence only; anonymous admission policy is unchanged. */
export function getTaskLaunchIds() {
  return Object.freeze([...new Set([...launches.values()]
    .map(entry => entry.taskId).filter(id => typeof id === 'string' && id.length > 0))]);
}

function response(blockers = [], independent = 0) {
  return {
    protocol: PROTOCOL, drain_id: _drainId, draining: _draining, drain_started_at: _drainStartedAt,
    safe_to_swap: _draining && blockers.length === 0,
    remaining: blockers.length, blockers,
    in_progress_tasks: blockers.filter(item => item.task_id).map(item => ({ id: item.task_id })),
    independent_task_count: independent,
  };
}

export async function drainTick() {
  const already = _draining;
  let persistence;
  if (!already) {
    revision++;
    _draining = true;
    _drainStartedAt = new Date().toISOString();
    _drainId = randomUUID();
    persistence = persistDrainState();
  }
  const id = _drainId;
  const startedRevision = revision;
  await persistence;
  const status = await getDrainStatus();
  if (!_draining || _drainId !== id || revision !== startedRevision) {
    return { ...status, success: false, safe_to_swap: false, reason: 'drain_identity_changed' };
  }
  return { success: true, ...(already ? { already_draining: true } : {}), ...status };
}

export async function getDrainStatus() {
  if (!_draining) return { ...response(), safe_to_swap: false };
  const id = _drainId;
  const observedLaunches = new Map(launches);
  const { rows } = await pool.query(`SELECT id,title,status,executor_kind,payload,claimed_by,claimed_at,started_at
    FROM tasks WHERE status IN ('in_progress','dispatched') ORDER BY started_at`);
  const { getActiveProcesses } = await import('./executor.js');
  const stored = (await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [DRAIN_STATE_KEY])).rows[0]?.value_json;
  for (const [token, launch] of launches) observedLaunches.set(token, launch);
  const scope = collectBrainDrainScope(rows, getActiveProcesses(), [...observedLaunches.values()]);
  if (stored?.draining !== true || stored.drain_id !== id) scope.blockers.push({
    kind: 'unknown', reason: 'drain_persistence_unconfirmed',
  });
  if (!_draining || _drainId !== id) return {
    ...response(scope.blockers, scope.independent_task_count), safe_to_swap: false, reason: 'drain_identity_changed',
  };
  return response(scope.blockers, scope.independent_task_count);
}

export async function cancelDrain(expectedDrainId) {
  if (_draining && expectedDrainId !== undefined && expectedDrainId !== _drainId) {
    return { success: false, reason: 'drain_identity_changed', drain_id: _drainId };
  }
  const cancellingRevision = ++revision;
  const activeId = _drainId;
  const active = _draining;
  const cancelled = await writeControl(async () => {
    const stored = (await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [DRAIN_STATE_KEY])).rows[0]?.value_json;
    const storedActive = stored?.draining === true;
    const storedId = storedActive ? stored.drain_id ?? null : null;
    if (storedActive && ((active && storedId !== activeId) ||
        (expectedDrainId !== undefined && storedId !== expectedDrainId))) {
      return { success: false, reason: 'drain_identity_changed', drain_id: storedId };
    }
    await clearPersistedDrainState(active ? activeId : storedId);
    const id = active ? activeId : storedId;
    return { success: true, was_draining: active || storedActive,
      ...((active || storedActive) && id ? { drain_id: id } : {}) };
  });
  if (!cancelled.success) return cancelled;
  if (revision !== cancellingRevision) return { success: false, reason: 'drain_identity_changed' };
  _draining = false;
  _drainStartedAt = null;
  _drainId = null;
  return cancelled;
}
export function _getDrainState() { return { draining: _draining, drainStartedAt: _drainStartedAt, drainId: _drainId }; }
export function _resetDrainState() {
  revision++; _draining = false; _drainStartedAt = null; _drainId = null; launches.clear();
}
