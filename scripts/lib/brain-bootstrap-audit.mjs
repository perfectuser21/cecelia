const STALE_SCRIPT_TASK_ID = '866191a5-cf47-4974-8810-8bda9ad7d4d8';
const STALE_SCRIPT_RUN_ID = '0b34ca86-a9db-473d-ac4c-3cae1a0672db';
const STALE_SCRIPT_EXECUTION_ID = `script-${STALE_SCRIPT_TASK_ID}-a1`;

async function confirmStaleScriptOnHost(run) {
  if (run.payload?.host !== 'mmv' || run.payload?.opc_batch_script !== 'opc-objects-sync.py'
      || run.payload?.script_run_id !== STALE_SCRIPT_EXECUTION_ID) return false;
  try {
    const { execFileSync } = await import('node:child_process');
    const { sshTargetFor, resolveMachineId } = await import('./src/machine-registry.js');
    const { SSH_BASE_ARGS } = await import('./src/lib/ssh-args.js');
    const target = sshTargetFor(resolveMachineId(run.payload.host));
    const remote = `for suffix in sh sup pid exit out err timedout; do
      test ! -e "$HOME/brain-runs/${STALE_SCRIPT_EXECUTION_ID}.$suffix" || exit 4
    done
    ps -axo comm=,args= | awk '$1 ~ /python/ && index($0, "opc-objects-sync.py") { found=1 } END { exit found ? 5 : 0 }' || exit 5
    printf NO_PROCESS_NO_ARTIFACT`;
    const output = execFileSync('ssh', [...SSH_BASE_ARGS, target, remote], {
      encoding: 'utf8', timeout: 15000, stdio: 'pipe',
    }).trim();
    return output === 'NO_PROCESS_NO_ARTIFACT';
  } catch { return false; }
}

async function confirmHistoricalKernelDead(db, run, now) {
  if (run.executor_kind !== 'kernel-process'
      || run.payload?.harness_runtime !== 'kernel-v1'
      || !/^[a-f0-9-]{36}$/.test(run.run_id)) return false;
  const historical = (await db.query(
    `SELECT id, current_task_id, phase, completed_at,
            orchestrator_heartbeat_at, controller_lease_expires_at
       FROM initiative_runs WHERE id = $1::uuid AND current_task_id = $2`,
    [run.run_id, run.task_id],
  )).rows[0];
  if (!historical || historical.phase !== 'failed' || !historical.completed_at) return false;
  const heartbeat = Date.parse(historical.orchestrator_heartbeat_at ?? '');
  const lease = Date.parse(historical.controller_lease_expires_at ?? '');
  return Number.isFinite(lease) && lease < now
    && (!Number.isFinite(heartbeat) || heartbeat < now - 3 * 60 * 1000);
}

export async function auditBootstrapExecution(db, probe, binding,
  confirmStaleScript = async () => false, now = Date.now()) {
  const database = (await db.query('SELECT current_database() AS database')).rows[0]?.database;
  if (database !== 'cecelia') throw new Error('bootstrap_wrong_database');

  const decision = (await db.query(
    'SELECT status, made_by, decision FROM decisions WHERE id = $1',
    [binding.approval_decision_id],
  )).rows[0];
  const approvals = [binding.old_version, binding.old_image_id, binding.old_git_sha,
    binding.new_version, binding.new_image_id, binding.new_git_sha];
  const approvalValid = decision?.made_by === 'user' && decision?.status === 'active'
    && approvals.every((value) => decision.decision?.includes(value));

  const [taskRows, leaseRows, callbackRows, attemptRows, runRows] = await Promise.all([
    db.query(`SELECT id, title, task_type, executor_kind, payload, updated_at
                FROM tasks WHERE status = 'in_progress'
                  AND executor_kind IS DISTINCT FROM 'headed-session'`),
    db.query(`SELECT l.task_id, t.status AS task_status, t.executor_kind
                FROM task_leases l LEFT JOIN tasks t ON t.id = l.task_id
               WHERE l.released_at IS NULL AND l.lease_until > NOW()`),
    db.query('SELECT COUNT(*)::int AS count FROM callback_queue WHERE processed_at IS NULL'),
    db.query(`SELECT COUNT(*)::int AS count FROM harness_attempts
               WHERE status IN ('queued','starting','running')`),
    db.query(`SELECT r.id, r.run_id, r.task_id, r.status, r.started_at,
                     t.status AS task_status, t.task_type, t.executor_kind,
                     t.payload, t.result, t.last_attempt_at
                FROM task_runs r LEFT JOIN tasks t ON t.id = r.task_id
               WHERE r.ended_at IS NULL AND r.status IN ('queued','starting','running')`),
  ]);
  const checks = await Promise.all(taskRows.rows.map(async (task) => {
    let verdict = 'unknown';
    try { verdict = await probe(task); } catch { /* unknown blocks promotion */ }
    if (!['alive', 'dead', 'unknown'].includes(verdict)) verdict = 'unknown';
    return { id: task.id, executor_kind: task.executor_kind, verdict };
  }));
  const terminal = new Set(['completed', 'failed', 'cancelled', 'archived']);
  const executionLeases = leaseRows.rows.filter((lease) =>
    lease.executor_kind !== 'headed-session' && !terminal.has(lease.task_status));
  const activeLeases = executionLeases.length;
  const ignoredLedgerLeases = leaseRows.rows.length - activeLeases;
  const runChecks = await Promise.all(runRows.rows.map(async (run) => {
    if (run.executor_kind === 'headed-session') {
      return { run_id: run.run_id, verdict: 'headed_ledger', blocking: false };
    }
    let verdict = 'unknown';
    try { verdict = await probe({ ...run, id: run.task_id }); } catch { /* fail closed */ }
    if (!['alive', 'dead', 'unknown'].includes(verdict)) verdict = 'unknown';
    const terminalParent = terminal.has(run.task_status);
    const evidence = run.result?.evidence;
    const timeoutSec = Number(run.payload?.timeout_sec);
    const ageMs = now - Date.parse(run.started_at);
    const staleScriptCandidate = terminalParent && run.task_status === 'failed'
      && run.task_id === STALE_SCRIPT_TASK_ID && run.id === STALE_SCRIPT_RUN_ID
      && run.run_id === STALE_SCRIPT_EXECUTION_ID
      && run.executor_kind === 'script' && run.task_type === 'script_run'
      && run.result?.verdict === 'FAILED_EXECUTION_OUTCOME_UNKNOWN'
      && evidence?.run_id === run.run_id && evidence?.task_run_id === run.id
      && evidence?.remote_process === `none_on_${new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}`
      && evidence?.remote_artifacts === evidence.remote_process
      && Number.isSafeInteger(timeoutSec) && timeoutSec > 0 && timeoutSec <= 3600
      && Number.isFinite(ageMs) && ageMs > (timeoutSec + 900) * 1000;
    const staleScript = staleScriptCandidate && verdict === 'unknown'
      && await confirmStaleScript(run);
    const staleKernel = terminalParent && verdict === 'unknown'
      && await confirmHistoricalKernelDead(db, run, now);
    // task_runs is a ledger. A terminal parent alone cannot settle an unknown
    // process; the script exception requires a fresh independent remote probe.
    const staleTerminal = terminalParent && (verdict === 'dead'
      || staleScript || staleKernel);
    return { run_id: run.run_id, task_id: run.task_id, verdict,
      stale_terminal: staleTerminal, blocking: verdict === 'alive' || (!staleTerminal && verdict !== 'dead') };
  }));
  const blockingRuns = runChecks.filter((run) => run.blocking).length;
  const staleTerminalRuns = runChecks.filter((run) => run.stale_terminal).length;
  const pendingCallbacks = Number(callbackRows.rows[0]?.count);
  const activeAttempts = Number(attemptRows.rows[0]?.count);
  const countsKnown = [activeLeases, pendingCallbacks, activeAttempts]
    .every((value) => Number.isSafeInteger(value) && value >= 0);
  return {
    safe: approvalValid && countsKnown && activeLeases === 0 && blockingRuns === 0
      && pendingCallbacks === 0 && activeAttempts === 0
      && checks.every(({ verdict }) => verdict === 'dead'),
    approval_valid: approvalValid,
    active_leases: activeLeases,
    ignored_ledger_leases: ignoredLedgerLeases,
    pending_callbacks: pendingCallbacks,
    active_attempts: activeAttempts,
    blocking_runs: blockingRuns,
    stale_terminal_runs: staleTerminalRuns,
    runs: runChecks,
    tasks: checks,
  };
}

// Deployed through docker exec -i into the old Brain container. No DB mutation.
if (process.env.BOOTSTRAP_AUDIT_CLI === '1') {
  let pool;
  try {
    ({ default: pool } = await import('./src/db.js'));
    const { EXECUTOR_CONTRACTS, resolveLivenessKind } = await import('./src/executor-contracts.js');
    const binding = JSON.parse(process.env.BOOTSTRAP_ACTUAL_JSON || 'null');
    const result = await auditBootstrapExecution(pool, async (task) => {
      const contract = EXECUTOR_CONTRACTS[resolveLivenessKind(task)];
      return contract?.probe ? contract.probe(task, { pool }) : 'unknown';
    }, binding, confirmStaleScriptOnHost);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.safe) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`bootstrap_audit_failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}
