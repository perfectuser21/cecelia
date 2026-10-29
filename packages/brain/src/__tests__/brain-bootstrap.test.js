import { describe, it, expect } from 'vitest';
import { verifyBootstrapReceipt } from '../../../../scripts/lib/brain-bootstrap-verify.mjs';
import { auditBootstrapExecution } from '../../../../scripts/lib/brain-bootstrap-audit.mjs';

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
      runs: [{ id: 'run-1', run_id: 'script-1', task_id: 'task-1', status: 'running',
        started_at: '2026-10-14T20:24:35.981Z', task_status: 'failed',
        executor_kind: 'script', task_type: 'script_run', payload: { script_run_id: 'script-1', timeout_sec: 900 },
        result: { verdict: 'FAILED_EXECUTION_OUTCOME_UNKNOWN', evidence: {
          run_id: 'script-1', task_run_id: 'run-1', remote_process: 'none_on_2026-10-30',
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
    const stale = await auditBootstrapExecution(db, async () => 'unknown', input);
    expect(stale).toMatchObject({ safe: true, stale_terminal_runs: 1, blocking_runs: 0 });
    expect((await auditBootstrapExecution(db, async () => 'alive', input)).safe).toBe(false);
    rows.runs[0].task_status = 'in_progress';
    expect((await auditBootstrapExecution(db, async () => 'unknown', input)).safe).toBe(false);
    rows.runs[0].task_status = 'failed';
    rows.runs[0].result.evidence.task_run_id = 'other-run';
    expect((await auditBootstrapExecution(db, async () => 'unknown', input)).safe).toBe(false);
  });
});
