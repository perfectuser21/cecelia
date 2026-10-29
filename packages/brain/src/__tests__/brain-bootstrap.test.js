import { describe, it, expect } from 'vitest';
import { verifyBootstrapReceipt } from '../../../../scripts/lib/brain-bootstrap-verify.mjs';
import { auditBootstrapExecution, bridgeProcessSnapshotSafe } from '../../../../scripts/lib/brain-bootstrap-audit.mjs';

const oldImage = `sha256:${'a'.repeat(64)}`;
const newImage = `sha256:${'b'.repeat(64)}`;
const oldSha = 'c'.repeat(40);
const newSha = 'd'.repeat(40);
const decisionId = '11111111-1111-4111-8111-111111111111';
const actual = {
  old_version: '1.445.84', old_image_id: oldImage, old_git_sha: oldSha,
  new_version: '1.445.85', new_image_id: newImage, new_git_sha: newSha,
  old_health_version: '1.445.84', old_health_git_sha: oldSha,
  old_container_health_version: '1.445.84', old_container_health_git_sha: oldSha,
  old_image_git_sha: oldSha, new_image_git_sha: newSha,
};
const receipt = {
  schema_version: 'brain-drain-bootstrap/v1',
  old_version: '1.445.84', old_image_id: oldImage, old_git_sha: oldSha,
  new_version: '1.445.85', new_image_id: newImage, new_git_sha: newSha,
  approval_decision_id: decisionId,
  expires_at: '2026-10-30T00:20:00.000Z',
};
const now = Date.parse('2026-10-30T00:00:00.000Z');

describe('one-time .84 drain bootstrap', () => {
  it('accepts only exact old and new image/SHA bindings with a short approval window', () => {
    expect(verifyBootstrapReceipt(receipt, actual, now)).toMatchObject({ approval_decision_id: decisionId });
    for (const key of ['old_image_id', 'new_image_id', 'old_git_sha', 'new_git_sha']) {
      expect(() => verifyBootstrapReceipt(receipt, { ...actual, [key]: 'wrong' }, now), key).toThrow();
    }
    expect(() => verifyBootstrapReceipt(receipt, { ...actual, new_image_git_sha: oldSha }, now)).toThrow();
    expect(() => verifyBootstrapReceipt(receipt, { ...actual, old_container_health_git_sha: newSha }, now)).toThrow();
    expect(() => verifyBootstrapReceipt({ ...receipt, expires_at: '2026-10-29T23:00:00Z' }, actual, now)).toThrow();
  });

  it('rejects a live lease, pending callback, active attempt or unknown remote task', async () => {
    const rows = {
      tasks: [{ id: 'script-old', task_type: 'script_run', executor_kind: 'script', payload: {} }],
      leases: [], callbacks: [{ count: 0 }], attempts: [{ count: 0 }], runs: [],
      decisions: [{ status: 'active', made_by: 'user', decision: `批准 ${oldImage} ${newImage} ${oldSha} ${newSha} 1.445.84 1.445.85` }],
    };
    const db = { query: async (sql) => {
      if (sql.includes('current_database()')) return { rows: [{ database: 'cecelia' }] };
      const table = /FROM (tasks|task_leases|callback_queue|harness_attempts|decisions|task_runs)/.exec(sql)?.[1];
      const key = { task_leases: 'leases', callback_queue: 'callbacks', harness_attempts: 'attempts', task_runs: 'runs' }[table] ?? table;
      return { rows: rows[key] };
    } };
    const input = { approval_decision_id: decisionId, ...actual };
    expect((await auditBootstrapExecution(db, async () => 'unknown', input)).safe).toBe(false);
    expect((await auditBootstrapExecution(db, async () => 'alive', input)).safe).toBe(false);
    expect((await auditBootstrapExecution(db, async () => 'dead', input)).safe).toBe(true);
    for (const key of ['leases', 'callbacks', 'attempts']) {
      rows[key] = key === 'leases'
        ? [{ task_id: 'running', task_status: 'in_progress', executor_kind: 'script' }]
        : [{ count: 1 }];
      expect((await auditBootstrapExecution(db, async () => 'dead', input)).safe, key).toBe(false);
      rows[key] = key === 'leases' ? [] : [{ count: 0 }];
    }
    rows.leases = [
      { task_id: 'finished', task_status: 'completed', executor_kind: 'headed-session' },
      { task_id: 'headed', task_status: 'in_progress', executor_kind: 'headed-session' },
    ];
    expect(await auditBootstrapExecution(db, async () => 'dead', input)).toMatchObject({
      safe: true, active_leases: 0, ignored_ledger_leases: 2,
    });
    rows.decisions[0].decision = `${oldImage} ${newImage} ${oldSha} 1.445.84 1.445.85`;
    expect((await auditBootstrapExecution(db, async () => 'dead', input)).safe).toBe(false);
  });

  it('separates a formally reconciled stale run from live or unknown execution', async () => {
    const rows = {
      tasks: [], leases: [], callbacks: [{ count: 0 }], attempts: [{ count: 0 }],
      runs: [{ id: '0b34ca86-a9db-473d-ac4c-3cae1a0672db',
        run_id: 'script-866191a5-cf47-4974-8810-8bda9ad7d4d8-a1',
        task_id: '866191a5-cf47-4974-8810-8bda9ad7d4d8', status: 'running',
        started_at: '2026-10-14T20:24:35.981Z', task_status: 'failed',
        executor_kind: 'script', task_type: 'script_run', payload: {
          script_run_id: 'script-866191a5-cf47-4974-8810-8bda9ad7d4d8-a1', timeout_sec: 900 },
        result: { verdict: 'FAILED_EXECUTION_OUTCOME_UNKNOWN', evidence: {
          run_id: 'script-866191a5-cf47-4974-8810-8bda9ad7d4d8-a1',
          task_run_id: '0b34ca86-a9db-473d-ac4c-3cae1a0672db', remote_process: 'none_on_2026-10-30',
          remote_artifacts: 'none_on_2026-10-30',
        } } }],
      decisions: [{ status: 'active', made_by: 'user', decision: `批准 ${oldImage} ${newImage} ${oldSha} ${newSha} 1.445.84 1.445.85` }],
    };
    const db = { query: async (sql) => {
      if (sql.includes('current_database()')) return { rows: [{ database: 'cecelia' }] };
      const table = /FROM (tasks|task_leases|callback_queue|harness_attempts|decisions|task_runs)/.exec(sql)?.[1];
      const key = { task_leases: 'leases', callback_queue: 'callbacks', harness_attempts: 'attempts', task_runs: 'runs' }[table] ?? table;
      return { rows: rows[key] };
    } };
    const input = { approval_decision_id: decisionId, ...actual };
    const stale = await auditBootstrapExecution(db, async () => 'unknown', input,
      { confirmStaleScript: async () => true });
    expect(stale).toMatchObject({ safe: true, stale_terminal_runs: 1, blocking_runs: 0 });
    expect((await auditBootstrapExecution(db, async () => 'alive', input)).safe).toBe(false);
    expect((await auditBootstrapExecution(db, async () => 'unknown', input)).safe).toBe(false);
    rows.runs[0].task_status = 'in_progress';
    expect((await auditBootstrapExecution(db, async () => 'unknown', input)).safe).toBe(false);
    rows.runs[0].task_status = 'failed';
    rows.runs[0].result.evidence.task_run_id = 'other-run';
    expect((await auditBootstrapExecution(db, async () => 'unknown', input)).safe).toBe(false);
  });

  it('uses the exact historical Kernel run lease instead of a stale task_runs label', async () => {
    const runId = '634a52ba-d870-4338-9f40-e4e33e17fadd';
    const taskId = '03cbb852-8572-48a6-8822-9b72a82bed0e';
    const source = { id: runId, current_task_id: taskId, phase: 'failed',
      completed_at: '2026-09-30T07:07:43Z',
      orchestrator_heartbeat_at: '2026-09-30T07:07:42Z',
      controller_lease_expires_at: '2026-09-30T07:37:42Z' };
    const db = { query: async (sql) => {
      if (sql.includes('current_database()')) return { rows: [{ database: 'cecelia' }] };
      if (sql.includes('FROM decisions')) return { rows: [{ status: 'active', made_by: 'user',
        decision: `${oldImage} ${newImage} ${oldSha} ${newSha} 1.445.84 1.445.85` }] };
      if (sql.includes('FROM task_runs')) return { rows: [{ id: 'task-run-row', task_id: taskId,
        run_id: runId, status: 'running', task_status: 'failed', executor_kind: 'kernel-process',
        task_type: 'harness_initiative', payload: { harness_runtime: 'kernel-v1' } }] };
      if (sql.includes('FROM initiative_runs')) return { rows: [source] };
      if (sql.includes('FROM callback_queue') || sql.includes('FROM harness_attempts')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    } };
    const input = { approval_decision_id: decisionId, ...actual };
    expect(await auditBootstrapExecution(db, async () => 'unknown', input)).toMatchObject({
      safe: true, stale_terminal_runs: 1, blocking_runs: 0,
    });
    source.controller_lease_expires_at = '2999-01-01T00:00:00Z';
    expect((await auditBootstrapExecution(db, async () => 'unknown', input)).safe).toBe(false);
  });

  it('requires fresh independent proof for only the two superseded device attempts and old bridge run', async () => {
    const runs = [
      { id: 'device-row', task_id: '13508736-1359-4587-b995-5e35507cd5d4',
        run_id: 'social-keyword-leadgen-crontab-auto09270600__a0.preflight',
        task_status: 'completed', task_type: 'device_job', executor_kind: null, status: 'running' },
      { id: 'bridge-row', task_id: '93bb2a4e-7152-4dd6-b3b8-2f2e17d97322',
        run_id: '91d3234a-7f50-402e-9014-e07e9ce07fd1',
        task_status: 'completed', task_type: 'data', executor_kind: 'bridge',
        context: { executor: 'codex-bridge' }, status: 'running',
        started_at: '2026-10-10T07:39:47Z' },
    ];
    const db = { query: async (sql) => {
      if (sql.includes('current_database()')) return { rows: [{ database: 'cecelia' }] };
      if (sql.includes('FROM decisions')) return { rows: [{ status: 'active', made_by: 'user',
        decision: `${oldImage} ${newImage} ${oldSha} ${newSha} 1.445.84 1.445.85` }] };
      if (sql.includes('FROM task_runs')) return { rows: runs };
      if (sql.includes('FROM callback_queue') || sql.includes('FROM harness_attempts')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    } };
    const input = { approval_decision_id: decisionId, ...actual };
    const confirmDevice = async () => true;
    const confirmBridge = async () => true;
    expect(await auditBootstrapExecution(db, async () => 'unknown', input,
      { confirmDevice, confirmBridge })).toMatchObject({ safe: true, blocking_runs: 0, stale_terminal_runs: 2 });
    runs[0].run_id = 'other-a0.preflight';
    expect((await auditBootstrapExecution(db, async () => 'unknown', input,
      { confirmDevice, confirmBridge })).safe).toBe(false);
    runs[0].run_id = 'social-keyword-leadgen-crontab-auto09270600__a0.preflight';
    runs[1].context.executor = 'other';
    expect((await auditBootstrapExecution(db, async () => 'unknown', input,
      { confirmDevice, confirmBridge })).safe).toBe(false);
  });

  it('limits concurrent run probes so an audit does not exhaust the production DB pool', async () => {
    const runs = Array.from({ length: 30 }, (_, i) => ({ id: `run-${i}`, run_id: `run-${i}`,
      task_id: `task-${i}`, task_status: 'failed', executor_kind: 'bridge', status: 'running' }));
    const db = { query: async (sql) => {
      if (sql.includes('current_database()')) return { rows: [{ database: 'cecelia' }] };
      if (sql.includes('FROM decisions')) return { rows: [{ status: 'active', made_by: 'user',
        decision: `${oldImage} ${newImage} ${oldSha} ${newSha} 1.445.84 1.445.85` }] };
      if (sql.includes('FROM task_runs')) return { rows: runs };
      if (sql.includes('FROM callback_queue') || sql.includes('FROM harness_attempts')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    } };
    let active = 0; let maxActive = 0;
    const probe = async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return maxActive > 12 ? 'unknown' : 'dead';
    };
    const input = { approval_decision_id: decisionId, ...actual };
    expect((await auditBootstrapExecution(db, probe, input)).safe).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(12);
  });

  it('distinguishes unrelated Codex app-server processes from old bridge exec workers', () => {
    const started = Date.parse('2026-10-10T07:39:47Z');
    const bridge = ' 1605 Thu Oct 29 19:41:13 2026 /opt/homebrew/bi /opt/homebrew/bin/node /repo/codex-bridge.cjs';
    const appServer = ' 1606 Thu Oct 29 19:42:13 2026 /opt/homebrew/bi node /opt/homebrew/bin/codex app-server --listen stdio://';
    expect(bridgeProcessSnapshotSafe(`${bridge}\n${appServer}`, started, 'run-id', 'task-id')).toBe(true);
    const oldExec = ' 1607 Thu Oct 29 19:43:13 2026 /opt/homebrew/bi /usr/bin/codex exec --json';
    expect(bridgeProcessSnapshotSafe(`${bridge}\n${oldExec}`, started, 'run-id', 'task-id')).toBe(false);
  });
});
