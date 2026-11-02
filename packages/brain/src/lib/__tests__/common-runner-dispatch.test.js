import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { createCommonRunnerDispatcher, commonRunnerFormalBinding, loadCommonRunnerProfiles } from '../common-runner-dispatch.js';
import { runCommonRunnerTasks } from '../../common-runner-executor.js';

const taskId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';
const token = 'contract-test-control-key-32-characters';
const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))); });

async function setup({ badSignature = false, wrongNonce = false, failStart = false, failStartOn, workerResponses = [], workerReceipt = {}, receiptForRequest, centralSpans = [], definition, profilesFile, reconciliation, tickEnabled, useDefaultStartGate = false } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const input = JSON.parse(text); requests.push({ path: req.url, input });
    const starts = requests.filter(r => r.path.endsWith('/start')).length;
    if ((failStart || starts === failStartOn) && req.url.endsWith('/start')) { req.socket.destroy(); return; }
    const receipt = { run_id: input.run_id, task_id: input.task_id, machine_id: 'node-a',
      request_nonce: wrongNonce ? 'stale' : input.request_nonce, status: 'running', profile_sha256: 'a'.repeat(64), mode: input.mode ?? task.result?.common_runner?.mode ?? 'exploration', ...workerReceipt, ...(workerResponses.shift() ?? {}),
      ...(await receiptForRequest?.({ path: req.url, input }) ?? {}) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ receipt, signature: badSignature ? '0'.repeat(64)
      : createHmac('sha256', token).update(JSON.stringify(receipt)).digest('hex') }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  const task = { id: taskId, status: 'in_progress', kind: 'agent', result: {}, payload: {} };
  const pool = { query: vi.fn(async (sql, params) => {
    if (sql.includes('FROM working_memory')) return { rows: [{ value_json: { enabled: tickEnabled } }] };
    if (sql.includes('SELECT') && sql.includes('FROM tasks')) {
      if ((sql.includes("status='in_progress'") && task.status !== 'in_progress') || (sql.includes("status='queued'") && task.status !== 'queued')) return { rows: [], rowCount: 0 };
      return { rows: [structuredClone(task)], rowCount: 1 };
    }
    if (sql.includes('FROM spans')) return { rows: centralSpans, rowCount: centralSpans.length };
    if (definition && sql.includes('FROM task_runs')) return { rows: [{ task_id: taskId, status: 'running', ended_at: null }], rowCount: 1 };
    if (sql.includes('UPDATE tasks')) {
      if (sql.includes('SET claimed_by')) task.claimed_by = 'common-runner';
      else task.result = { ...task.result, ...JSON.parse(params[1]) };
      if (sql.includes("status='in_progress'")) task.status = 'in_progress';
      return { rows: [structuredClone(task)], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }) };
  const authority = vi.fn(async (_db, input, operation) => operation({ executionVersionId: 'version-a', grantId: 'grant-a',
    node: { canonical_id: 'node-a', endpoints: { worker: `http://127.0.0.1:${server.address().port}` } } }, pool));
  const start = vi.fn(async () => ({ id: 'ledger-row', run_id: runId }));
  const finish = vi.fn(async () => ({ updated: true }));
  const reconcile = vi.fn(async () => reconciliation ?? { business_outcome: 'unknown', evidence_status: 'incomplete' });
  const dispatcher = createCommonRunnerDispatcher({ pool, token,
    env: { NODE_ENV: 'production', ...(profilesFile ? { COMMON_RUNNER_PROFILES_FILE: profilesFile } : {}) },
    ...(!profilesFile ? { profiles: { demo: { machine_id: 'node-a', profile_sha256: 'a'.repeat(64) } } } : {}),
    authorizeExecution: authority, resolveBoundNode: async () => ({ canonical_id: 'node-a', endpoints: { worker: `http://127.0.0.1:${server.address().port}` } }),
    executionDirectory: { current: () => ({ version: 'snapshot-a' }) }, startRun: start, finishRun: finish,
    ...(!useDefaultStartGate ? { assertCanStart: async () => {} } : {}),
    readReconciliation: reconcile,
    ...(definition ? { readDefinition: async () => definition } : {}) });
  return { dispatcher, task, requests, authority, start, finish, pool, reconcile };
}

describe('common runner HTTP dispatch', () => {
  it('the automatic completion job claims an opt-in task and reaches a real Worker HTTP server', async () => {
    const x = await setup(); x.task.status = 'queued';
    x.task.payload.common_runner = { run_id: runId, profile: 'demo', input: { from: 'brain-scheduler' }, mode: 'exploration' };
    const result = await runCommonRunnerTasks(x.pool, { dispatcher: x.dispatcher, recordEvent: vi.fn() });
    expect(result.dispatched).toBe(1);
    expect(x.requests.map(row => row.path)).toEqual([`/workflows/${runId}/start`]);
    expect(x.requests[0].input.input).toEqual({ from: 'brain-scheduler' });
    expect(x.task.claimed_by).toBe('common-runner'); expect(x.task.status).toBe('in_progress');
  });
  it('loads operator routing only from a protected regular file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-common-profile-'));
    const file = path.join(root, 'profiles.json');
    try {
      fs.writeFileSync(file, JSON.stringify({ profiles: { demo: { machine_id: 'node-a', profile_sha256: 'a'.repeat(64) } } }), { mode: 0o600 });
      expect(loadCommonRunnerProfiles(file).demo.machine_id).toBe('node-a');
      fs.chmodSync(file, 0o644);
      expect(() => loadCommonRunnerProfiles(file)).toThrow('common_runner_profiles_untrusted');
      expect(() => loadCommonRunnerProfiles('relative.json')).toThrow('common_runner_profiles_untrusted');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('recovers a bound run after the current routing file is removed, including repeated start', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-common-recovery-'));
    const file = path.join(root, 'profiles.json');
    fs.writeFileSync(file, JSON.stringify({ profiles: { demo: { machine_id: 'node-a', profile_sha256: 'a'.repeat(64) } } }), { mode: 0o600 });
    try {
      const x = await setup({ profilesFile: file });
      const body = { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' };
      await x.dispatcher.dispatch('start', runId, body);
      fs.unlinkSync(file);
      expect((await x.dispatcher.dispatch('inspect', runId, { task_id: taskId })).authenticated).toBe(true);
      expect((await x.dispatcher.dispatch('cancel', runId, { task_id: taskId })).authenticated).toBe(true);
      expect((await x.dispatcher.dispatch('flush', runId, { task_id: taskId })).authenticated).toBe(true);
      expect((await x.dispatcher.dispatch('start', runId, body)).authenticated).toBe(true);
      expect(x.requests.map(row => row.path.split('/').at(-1))).toEqual(['start', 'inspect', 'cancel', 'flush', 'inspect']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('persists task binding and central start before dispatch, verifies signed nonce and uses directory authority', async () => {
    const x = await setup();
    const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: { value: 3 }, mode: 'exploration' });
    expect(result.receipt.status).toBe('running');
    expect(x.task.result.common_runner.run_id).toBe(runId);
    expect(x.authority.mock.calls[0][1]).toMatchObject({ machineId: 'node-a', surface: 'managed_script', provider: 'script', profileId: 'demo' });
    expect(x.start).toHaveBeenCalledTimes(1);
    expect(x.requests[0].path).toBe(`/workflows/${runId}/start`);
    expect(x.requests[0].input.input).toEqual({ value: 3 });
  });
  it('rejects caller supplied execution location or commands before transport', async () => {
    const x = await setup();
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', mode: 'exploration', input: {}, url: 'http://evil', entry: 'evil.sh' })).rejects.toThrow('common_runner_request_invalid');
    expect(x.requests).toHaveLength(0);
  });
  it.each([{ badSignature: true }, { wrongNonce: true }])('rejects unauthenticated or replayed receipt %j', async options => {
    const x = await setup(options);
    const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' });
    expect(result.status).toBe('unknown');
    expect(result.receipt).toBeUndefined();
  });
  it('start response loss keeps durable identity and repeated start inspects without relaunch', async () => {
    const x = await setup({ failStart: true });
    const body = { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' };
    expect((await x.dispatcher.dispatch('start', runId, body)).status).toBe('unknown');
    expect((await x.dispatcher.dispatch('start', runId, body)).receipt.status).toBe('running');
    expect(x.requests.map(request => request.path)).toEqual([`/workflows/${runId}/start`, `/workflows/${runId}/inspect`]);
  });
  it('rejects changed input for an existing run without execution', async () => {
    const x = await setup();
    await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' });
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: { changed: true }, mode: 'exploration' })).rejects.toThrow('common_runner_identity_conflict');
    expect(x.requests).toHaveLength(1);
  });
  it('does not start when the central run cannot be durably registered', async () => {
    const x = await setup(); x.start.mockResolvedValueOnce(null);
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' })).rejects.toThrow('common_runner_run_registration_failed');
    expect(x.requests).toHaveLength(0);
  });
  it('honors execution directory denial before any worker side effect', async () => {
    const x = await setup(); x.authority.mockRejectedValueOnce(Error('execution_grant_denied'));
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' })).rejects.toThrow('execution_grant_denied');
    expect(x.start).not.toHaveBeenCalled(); expect(x.requests).toHaveLength(0);
  });
  it('does not take over a task already held by a manual session', async () => {
    const x = await setup(); x.task.claimed_by = 'session:manual';
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' })).rejects.toThrow('common_runner_task_owned');
    expect(x.requests).toHaveLength(0);
  });
  it.each([true, 'true'])('direct HTTP start cannot take a manual task marked headed_manual=%s', async marker => {
    const x = await setup(); x.task.payload.headed_manual = marker;
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' })).rejects.toThrow('common_runner_task_owned');
    expect(x.requests).toHaveLength(0); expect(x.start).not.toHaveBeenCalled();
  });
  it('direct HTTP start is restricted to the AI execution kind', async () => {
    const x = await setup(); x.task.kind = 'human';
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' })).rejects.toThrow('common_runner_task_owned');
    expect(x.requests).toHaveLength(0);
  });
  it('a signed not-started resource wait may resume the same run without duplicating its execution', async () => {
    const x = await setup({ workerResponses: [{ status: 'waiting_resources', execution_state: 'not_started' }] });
    const body = { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' };
    await x.dispatcher.dispatch('start', runId, body);
    expect(x.task.result.common_runner.launch_state).toBe('not_started');
    await x.dispatcher.dispatch('start', runId, body);
    expect(x.task.result.common_runner.launch_state).toBe('reserved');
    await x.dispatcher.dispatch('start', runId, body);
    expect(x.requests.map(r => r.path.split('/').at(-1))).toEqual(['start', 'start', 'inspect']);
    expect(x.start).toHaveBeenCalledTimes(1);
  });
  it('resuming not-started persists reserved before transport so a lost response never replays start', async () => {
    const x = await setup({ failStartOn: 2, workerResponses: [{ status: 'waiting_resources', execution_state: 'not_started' }] });
    const body = { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' };
    await x.dispatcher.dispatch('start', runId, body);
    expect((await x.dispatcher.dispatch('start', runId, body)).status).toBe('unknown');
    expect(x.task.result.common_runner.launch_state).toBe('reserved');
    await x.dispatcher.dispatch('start', runId, body);
    expect(x.requests.map(r => r.path.split('/').at(-1))).toEqual(['start', 'start', 'inspect']);
  });
  it('a wait-looking inspect response cannot reopen a previously ambiguous launch', async () => {
    const x = await setup({ failStartOn: 1, workerResponses: [{ status: 'waiting_resources', execution_state: 'not_started' }] });
    const body = { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' };
    await x.dispatcher.dispatch('start', runId, body);
    await x.dispatcher.dispatch('inspect', runId, { task_id: taskId });
    expect(x.task.result.common_runner.launch_state).toBe('reserved');
    await x.dispatcher.dispatch('start', runId, body);
    expect(x.requests.map(r => r.path.split('/').at(-1))).toEqual(['start', 'inspect', 'inspect']);
  });
  it('cancelling a signed resource wait persists intent and prevents any subsequent start', async () => {
    const x = await setup({ workerResponses: [{ status: 'waiting_resources', execution_state: 'not_started' }] });
    const body = { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' };
    await x.dispatcher.dispatch('start', runId, body);
    await x.dispatcher.dispatch('cancel', runId, { task_id: taskId });
    expect(x.task.result.common_runner.cancel_requested).toBe(true);
    await x.dispatcher.dispatch('start', runId, body);
    expect(x.requests.map(r => r.path.split('/').at(-1))).toEqual(['start', 'cancel', 'inspect']);
  });
  it('a signed delayed waiting response cannot erase a cancellation committed while start was in flight', async () => {
    let releaseStart, sawStart;
    const arrived = new Promise(resolve => { sawStart = resolve; });
    const release = new Promise(resolve => { releaseStart = resolve; });
    const x = await setup({ receiptForRequest: async ({ path }) => {
      if (!path.endsWith('/start')) return {};
      sawStart(); await release; return { status: 'waiting_resources', execution_state: 'not_started' };
    } });
    const body = { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' };
    const starting = x.dispatcher.dispatch('start', runId, body);
    await arrived;
    await x.dispatcher.dispatch('cancel', runId, { task_id: taskId });
    releaseStart(); await starting;
    expect(x.task.result.common_runner.cancel_requested).toBe(true);
    expect(x.task.result.common_runner.launch_state).toBe('reserved');
    await x.dispatcher.dispatch('start', runId, body);
    expect(x.requests.map(r => r.path.split('/').at(-1))).toEqual(['start', 'cancel', 'inspect']);
  });
  it('the real persistent tick pause blocks new starts but permits bound-run inspection', async () => {
    const x = await setup({ tickEnabled: false, useDefaultStartGate: true });
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' })).rejects.toThrow('common_runner_dispatch_paused');
    expect(x.requests).toHaveLength(0); expect(x.start).not.toHaveBeenCalled();
    x.task.result.common_runner = { run_id: runId, task_id: taskId, machine_id: 'node-a', profile: 'demo', profile_sha256: 'a'.repeat(64), mode: 'exploration', execution_version_id: 'version-a' };
    expect((await x.dispatcher.dispatch('inspect', runId, { task_id: taskId })).authenticated).toBe(true);
    expect(x.requests).toHaveLength(1);
  });
  it('formal runs require a previously fixed central definition', async () => {
    const x = await setup();
    await expect(x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'formal' })).rejects.toThrow('common_runner_formal_binding_required');
    expect(x.requests).toHaveLength(0);
  });
  it('finishes a run only after matching central record manifest and independently observed workflow validation', async () => {
    const validation = { workflow: { verdict: 'pass', acceptance_ref: 'wf-dod-v1', evidence: ['verified-file'] }, activities: { demo: { verdict: 'unknown' } } };
    const centralSpans = [{ occurrence_key: 'validation:1', payload_sha256: 'b'.repeat(64), evidence: {
      task_id: taskId, machine_id: 'node-a', profile_digest: 'a'.repeat(64), mode: 'exploration', kind: 'validation', activity: 'demo',
      workflow_validation: validation.workflow, validation: validation.activities.demo } }];
    const manifest = centralSpans.map(({ occurrence_key, payload_sha256 }) => ({ occurrence_key, payload_sha256 }));
    const writeback = { pending: 0, blocked: 0, total: 1, acked: 1, manifest_sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') };
    const x = await setup({ workerReceipt: { status: 'completed', validation, writeback }, centralSpans });
    const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' });
    expect(result.central_run.status).toBe('success');
    expect(x.finish).toHaveBeenCalledWith(expect.objectContaining({ runId, status: 'completed', result: expect.objectContaining({ actor: 'common-runner', evidence: expect.any(Array) }) }), expect.objectContaining({ strict: true }));
    expect(x.task.status).toBe('in_progress');
  });
  it.each([
    { status: 'completed', writeback: { pending: 1, blocked: 0, total: 1, acked: 0 } },
    { status: 'completed', writeback: { pending: 0, blocked: 0, total: 0, acked: 0 } },
    { status: 'unverified', writeback: { pending: 0, blocked: 0, total: 1, acked: 1 } },
  ])('never invents central completion with incomplete evidence %j', async workerReceipt => {
    const x = await setup({ workerReceipt });
    const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' });
    expect(result.central_run.status).toBe('running'); expect(x.finish).not.toHaveBeenCalled();
  });
  it('does not close a run when a signed worker manifest disagrees with central spans', async () => {
    const x = await setup({ workerReceipt: { status: 'completed', validation: { workflow: { verdict: 'pass' } },
      writeback: { pending: 0, blocked: 0, total: 1, acked: 1, manifest_sha256: '0'.repeat(64) } } });
    const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' });
    expect(result.central_run.status).toBe('running'); expect(x.finish).not.toHaveBeenCalled();
  });
  it('derives dynamic formal binding only from the central frozen definition', async () => {
    const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const definition = { binding: { id: uuid(1), run_id: runId, task_run_id: uuid(2), workflow_id: uuid(3),
      workflow_definition_version_id: uuid(4), attempt_key: 'a1', source_kind: 'internal' }, release: { target: 'node-a' },
    workflow: { payload: { activities: [{ slot_key: 'demo', reference_id: uuid(5), activity_id: uuid(6), activity_version_id: uuid(7) }] } },
    activities: [{ id: uuid(7), activity_id: uuid(6) }] };
    const x = await setup({ definition });
    await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'formal' });
    expect(x.requests[0].input.run_binding).toEqual(commonRunnerFormalBinding(definition, runId));
    expect(x.requests[0].input.run_binding.activities.demo.activity_definition_version_id).toBe(uuid(7));
    expect(x.task.result.common_runner.run_binding.run_binding_id).toBe(uuid(1));
    expect(() => commonRunnerFormalBinding({ ...definition, activities: [] }, runId)).toThrow('common_runner_formal_binding_required');
  });
  it.each([false, true])('cancellation requires independent cleanup verdict and identical central receipt (cleanup=%s)', async cleanupConfirmed => {
    const cleanup = cleanupConfirmed ? { verdict: 'pass', acceptance_ref: 'cleanup-v1', evidence: ['process-absent-lock-free'] } : null;
    const centralSpans = [{ occurrence_key: 'validation:cleanup', payload_sha256: 'c'.repeat(64), evidence: {
      task_id: taskId, machine_id: 'node-a', profile_digest: 'a'.repeat(64), mode: 'exploration', kind: 'validation',
      activity: 'cleanup', cleanup_validation: cleanup } }];
    const manifest = centralSpans.map(({ occurrence_key, payload_sha256 }) => ({ occurrence_key, payload_sha256 }));
    const writeback = { pending: 0, blocked: 0, total: 1, acked: 1, manifest_sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') };
    const x = await setup({ centralSpans, workerReceipt: { status: 'cancelled', validation: { cleanup }, writeback } });
    const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' });
    expect(result.central_run.status).toBe(cleanupConfirmed ? 'cancelled' : 'running');
    expect(x.finish).toHaveBeenCalledTimes(cleanupConfirmed ? 1 : 0);
  });
  it.each([false, true])('formal completion requires central path reconciliation including expected Steps (verified=%s)', async verified => {
    const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const definition = { binding: { id: uuid(1), run_id: runId, task_run_id: uuid(2), workflow_id: uuid(3),
      workflow_definition_version_id: uuid(4), attempt_key: 'a1', source_kind: 'internal' }, release: { target: 'node-a' },
    workflow: { payload: { activities: [{ slot_key: 'demo', reference_id: uuid(5), activity_id: uuid(6), activity_version_id: uuid(7) }] } },
    activities: [{ id: uuid(7), activity_id: uuid(6) }] };
    const workflow = { verdict: 'pass', acceptance_ref: 'wf-dod', evidence: ['wf-proof'] };
    const verdict = { verdict: 'pass', acceptance_ref: 'a-dod', evidence: ['a-proof'] };
    const centralSpans = [{ occurrence_key: 'validation:formal', payload_sha256: 'd'.repeat(64), evidence: {
      task_id: taskId, machine_id: 'node-a', profile_digest: 'a'.repeat(64), mode: 'formal', kind: 'validation', activity: 'demo',
      workflow_validation: workflow, validation: verdict, questions: { A4: { status: 'observed' } } } }];
    const manifest = centralSpans.map(({ occurrence_key, payload_sha256 }) => ({ occurrence_key, payload_sha256 }));
    const writeback = { pending: 0, blocked: 0, total: 1, acked: 1, manifest_sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') };
    const x = await setup({ definition, centralSpans, workerReceipt: { status: 'completed', validation: { workflow, activities: { demo: verdict } }, writeback },
      reconciliation: { business_outcome: verified ? 'pass' : 'unknown', evidence_status: verified ? 'verified' : 'incomplete' } });
    const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'formal' });
    expect(x.reconcile).toHaveBeenCalledWith(x.pool, runId);
    expect(result.central_run.status).toBe(verified ? 'success' : 'running'); expect(x.finish).toHaveBeenCalledTimes(verified ? 1 : 0);
  });
});
