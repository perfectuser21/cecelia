export const REQUIRED_TIMED_ROLES = Object.freeze([
  'planner',
  'generator',
  'reviewer',
  'evaluator',
  'judge',
  'reporter',
]);

export const DERIVED_TIME_ROLES = Object.freeze(['judge', 'reporter']);

const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);

function epoch(value) {
  if (value == null) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateAttemptTime(attempt) {
  const createdAt = epoch(attempt.created_at);
  const startedAt = epoch(attempt.started_at);
  const completedAt = epoch(attempt.completed_at);
  const derived = attempt.time_derived === true;

  if (createdAt == null || startedAt == null || completedAt == null) {
    return {
      active_time_ms: 0,
      wait_time_ms: 0,
      wall_time_ms: 0,
      derived,
    };
  }

  const activeTime = completedAt - startedAt;
  const waitTime = startedAt - createdAt;
  const wallTime = completedAt - createdAt;
  if (activeTime < 0 || waitTime < 0 || wallTime < 0) {
    return {
      active_time_ms: 0,
      wait_time_ms: 0,
      wall_time_ms: 0,
      derived,
    };
  }

  return {
    active_time_ms: activeTime,
    wait_time_ms: waitTime,
    wall_time_ms: wallTime,
    derived,
  };
}

function emptyMetric(role, workstreamKey) {
  return {
    role,
    workstream_key: workstreamKey,
    active_time_ms: 0,
    wall_time_ms: 0,
    wait_time_ms: 0,
    retry_count: 0,
    recovery_count: 0,
    invalid_count: 0,
  };
}

function telemetryNotFound() {
  const error = new Error('telemetry_not_found');
  error.code = 'telemetry_not_found';
  return error;
}

function logicalCycleId(row) {
  return row.logical_cycle_id == null
    ? `intent:${row.run_id}:${row.hop}`
    : String(row.logical_cycle_id);
}

export async function queryAttemptTelemetry(db, {
  taskId,
  tenantId,
  includeAttempts = true,
}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('queryAttemptTelemetry requires a PostgreSQL client');
  }
  if (!taskId || !tenantId) throw telemetryNotFound();

  const runsResult = await db.query(
    `SELECT DISTINCT r.id
       FROM tasks t
       JOIN initiative_runs r ON r.current_task_id = t.id
      WHERE t.id = $1
        AND COALESCE(NULLIF(t.payload->>'tenant_id', ''), 'default') = $2
      ORDER BY r.id`,
    [taskId, tenantId],
  );
  const runIds = (runsResult.rows ?? []).map((row) => row.id);
  if (runIds.length === 0) throw telemetryNotFound();

  const attemptsResult = await db.query(
    `SELECT id, run_id, hop, role, status, logical_cycle_id, attempt_kind,
            retry_of_attempt_id, restart_reason, workstream_key, time_derived,
            created_at, started_at, completed_at, updated_at, result
       FROM harness_attempts
      WHERE run_id = ANY($1::uuid[])
      ORDER BY created_at, hop, id`,
    [runIds],
  );
  const rows = attemptsResult.rows ?? [];
  const rawCounts = {};
  const logicalCycles = new Set();
  const metricMap = new Map();

  for (const row of rows) {
    rawCounts[row.role] = (rawCounts[row.role] ?? 0) + 1;
    logicalCycles.add(logicalCycleId(row));
    if (!TERMINAL_STATUSES.has(row.status)) continue;

    const workstreamKey = row.workstream_key ?? 'ws1';
    const key = `${row.role}\u0000${workstreamKey}`;
    const metric = metricMap.get(key) ?? emptyMetric(row.role, workstreamKey);
    const timing = calculateAttemptTime(row);
    metric.active_time_ms += timing.active_time_ms;
    metric.wait_time_ms += timing.wait_time_ms;
    metric.wall_time_ms += timing.wall_time_ms;
    metric.retry_count += row.attempt_kind === 'retry' ? 1 : 0;
    metric.recovery_count += ['resume', 'recovery'].includes(row.attempt_kind) ? 1 : 0;
    metric.invalid_count += row.result?.evaluation?.valid === false ? 1 : 0;
    metricMap.set(key, metric);
  }

  const roleMetrics = [...metricMap.values()].sort((left, right) => (
    left.role.localeCompare(right.role)
    || left.workstream_key.localeCompare(right.workstream_key)
  ));
  const totals = {
    active_time_ms: 0,
    wall_time_ms: 0,
    wait_time_ms: 0,
    retry_count: 0,
    recovery_count: 0,
    invalid_count: 0,
  };
  for (const metric of roleMetrics) {
    for (const key of Object.keys(totals)) totals[key] += metric[key];
  }

  return {
    task_id: taskId,
    run_count: runIds.length,
    logical_cycle_count: logicalCycles.size,
    raw_counts: rawCounts,
    totals,
    role_metrics: roleMetrics,
    attempts: includeAttempts
      ? rows.map((row) => ({
          attempt_id: row.id,
          run_id: row.run_id,
          hop: row.hop,
          role: row.role,
          status: row.status,
          logical_cycle_id: logicalCycleId(row),
          attempt_kind: row.attempt_kind ?? 'initial',
          retry_of_attempt_id: row.retry_of_attempt_id ?? null,
          restart_reason: row.restart_reason ?? null,
          workstream_key: row.workstream_key ?? 'ws1',
          started_at: row.started_at == null ? null : new Date(row.started_at).toISOString(),
          completed_at: row.completed_at == null ? null : new Date(row.completed_at).toISOString(),
          derived: row.time_derived === true,
        }))
      : [],
  };
}
