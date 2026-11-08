import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { createCommonRunnerDispatcher, commonRunnerFormalBinding, loadCommonRunnerProfiles, httpTransport } from '../common-runner-dispatch.js';
import { runCommonRunnerTasks } from '../../common-runner-executor.js';

const taskId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';
const token = 'contract-test-control-key-32-characters';
const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))); });

async function setup({ badSignature = false, wrongNonce = false, failStart = false, failStartOn, workerResponses = [], workerReceipt = {}, receiptForRequest, centralSpans = [], definition, profilesFile, reconciliation, tickEnabled, useDefaultStartGate = false, directoryEndpoint, savedCentralRun, finishAlready = false, taskPolicy, definitionAfterStart, registrationError, priorRun, grant, policyFile, machineId = 'node-a', profileSha = 'a'.repeat(64) } = {}) {
  const requests = [];let registered=false;
  const candidate=policyFile?JSON.parse(fs.readFileSync(policyFile,'utf8')).profiles.demo:null;
  const policyState=candidate?{
    task:{id:candidate.evidence_task_id,status:'in_progress',result:{ship_candidate:{schema_version:1,stage:'candidate',task_id:candidate.evidence_task_id,repo:candidate.source_repo,head_sha:candidate.source_commit,actor:'unit-candidate',facts:['fixed source'],evidence:['unit:source-readback']}}},
    release:{id:candidate.release_id,environment:'scratch',target:candidate.machine_id,payload:{components:[{kind:'repo',repo:candidate.source_repo,revision:candidate.source_commit}],verification:{status:'verified',ci_status:'verified'}}},
  }:null;
  if(policyState)policyState.observation={id:candidate.observation_id,release_id:candidate.release_id,payload:{environment:'scratch',target:candidate.machine_id,components:structuredClone(policyState.release.payload.components)},collector:'unit-collector',evidence_ref:'unit:current-observation'};
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const input = JSON.parse(text); requests.push({ path: req.url, input });
    const starts = requests.filter(r => r.path.endsWith('/start')).length;
    if ((failStart || starts === failStartOn) && req.url.endsWith('/start')) { req.socket.destroy(); return; }
    const receipt = { run_id: input.run_id, task_id: input.task_id, machine_id: machineId,
      request_nonce: wrongNonce ? 'stale' : input.request_nonce, status: 'running', profile_sha256: profileSha, mode: input.mode ?? task.result?.common_runner?.mode ?? 'exploration', ...workerReceipt, ...(workerResponses.shift() ?? {}),
      ...(await receiptForRequest?.({ path: req.url, input }) ?? {}) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ receipt, signature: badSignature ? '0'.repeat(64)
      : createHmac('sha256', token).update(JSON.stringify(receipt)).digest('hex') }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  const task = { id: taskId, status: 'in_progress', kind: 'agent', result: {}, payload: {} };
  const pool = { query: vi.fn(async (sql, params) => {
    if (policyState && sql.includes('FROM release_versions')) return {rows:[policyState.release]};
    if (policyState && sql.includes('FROM release_observations')) return {rows:[policyState.observation]};
    if (policyState && sql.includes('SELECT id,status,result FROM tasks')) return {rows:[policyState.task]};
    if (sql.includes('FROM working_memory')) return { rows: [{ value_json: { enabled: tickEnabled } }] };
    if (sql.includes('SELECT') && sql.includes('FROM tasks')) {
      if ((sql.includes("status='in_progress'") && task.status !== 'in_progress') || (sql.includes("status='queued'") && task.status !== 'queued')) return { rows: [], rowCount: 0 };
      return { rows: [structuredClone(task)], rowCount: 1 };
    }
    if (sql.includes('FROM spans')) return { rows: centralSpans, rowCount: centralSpans.length };
    if (savedCentralRun && sql.includes('SELECT status,task_id,ended_at,result FROM task_runs')) return {rows:[savedCentralRun],rowCount:1};
    if (priorRun && sql.includes('FROM task_runs')) return {rows:[priorRun],rowCount:1};
    if ((definition || registered) && sql.includes('FROM task_runs')) return { rows: [{ task_id: taskId, status: 'running', ended_at: null }], rowCount: 1 };
    if (sql.includes('UPDATE tasks')) {
      if (sql.includes('SET claimed_by')) task.claimed_by = 'common-runner';
      else task.result = { ...task.result, ...JSON.parse(params[1]) };
      if (sql.includes("status='in_progress'")) task.status = 'in_progress';
      return { rows: [structuredClone(task)], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }) };
  const authority = vi.fn(async (_db, input, operation) => operation({ executionVersionId: 'version-a', grantId: 'grant-a', grant,
    node: { canonical_id: machineId, endpoints: { worker: directoryEndpoint ?? `http://127.0.0.1:${server.address().port}` } } }, pool));
  const start = vi.fn(async input => {if(input.definition){if(registrationError)throw registrationError;registered=true;}return { id: 'ledger-row', run_id: runId };});
  const readDefinition=vi.fn(async()=>definition??(registered?definitionAfterStart:null));
  const finish = vi.fn(async () => ({ updated: !finishAlready }));
  const reconcile = vi.fn(async () => reconciliation ?? { business_outcome: 'unknown', evidence_status: 'incomplete' });
  const dispatcher = createCommonRunnerDispatcher({ pool, token,
    allowLoopbackForTests: true,
    env: { NODE_ENV: 'production', ...(profilesFile ? { COMMON_RUNNER_PROFILES_FILE: profilesFile } : {}), ...(policyFile ? { EXECUTION_MANAGED_SCRIPT_CANDIDATES_FILE: policyFile } : {}) },
    ...(!profilesFile ? { profiles: { demo: { machine_id: machineId, profile_sha256: profileSha } } } : {}),
    authorizeExecution: authority, resolveBoundNode: async () => ({ canonical_id: machineId, endpoints: { worker: directoryEndpoint ?? `http://127.0.0.1:${server.address().port}` } }),
    executionDirectory: { current: () => ({ version: 'snapshot-a' }) }, startRun: start, finishRun: finish,
    ...(!useDefaultStartGate ? { assertCanStart: async () => {} } : {}),
    readReconciliation: reconcile, taskPolicy,
    ...(definition || definitionAfterStart ? { readDefinition } : {}) });
  return { dispatcher, task, requests, authority, start, finish, pool, reconcile, readDefinition, policyState };
}

describe('common runner HTTP dispatch', () => {
  it.each(['https://example.com', 'http://169.254.169.254:5231', 'http://127.0.0.1:5231',
    'http://100.63.255.255:5231', 'http://100.128.0.1:5231', 'http://100.71.151.105:80',
    'http://100.71.151.105:5231/private', 'http://100.71.151.105:5231/?redirect=evil',
    'http://name.example:5231', 'http://user:pass@100.71.151.105:5231'])('rejects an unsafe authorized endpoint before sending credentials: %s', async endpoint => {
    const fetchFn = vi.fn();
    await expect(httpTransport({ endpoint, action: 'start', runId, body: {}, token, fetchFn })).rejects.toThrow('common_runner_transport_unconfigured');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each(['http://100.64.0.1:5231', 'http://100.127.255.254:5231/'])('uses a validated numeric tailnet origin and a URL object: %s', async endpoint => {
    const fetchFn = vi.fn(async () => ({ ok: true, body: (async function* () { yield Buffer.from('{}'); })() }));
    await httpTransport({ endpoint, action: 'inspect', runId, body: {}, token, fetchFn });
    const [url, options] = fetchFn.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(url.origin).toBe(new URL(endpoint).origin);
    expect(url.pathname).toBe(`/workflows/${encodeURIComponent(runId)}/${encodeURIComponent('inspect')}`);
    expect(options.redirect).toBe('error');
  });
  it.each(['https://example.com', 'http://169.254.169.254:5231'])('cannot send a token even when the execution directory authorizes unsafe endpoint %s', async directoryEndpoint => {
    const x = await setup({ directoryEndpoint });
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await x.dispatcher.dispatch('start', runId, { task_id: taskId, profile: 'demo', input: {}, mode: 'exploration' });
      expect(result.status).toBe('unknown'); expect(result.reason).toBe('common_runner_transport_unconfigured');
      expect(network).not.toHaveBeenCalled(); expect(x.requests).toHaveLength(0);
    } finally { network.mockRestore(); }
  });
  it.each([{ runId: '../metadata', action: 'start' }, { runId, action: 'start/../../metadata' }])('rejects path injection before transport (%j)', async input => {
    const fetchFn = vi.fn();
    await expect(httpTransport({ endpoint: 'http://100.71.151.105:5231', ...input, body: {}, token, fetchFn })).rejects.toThrow('common_runner_request_invalid');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('does not allow loopback fixture transport in an actual production process', async () => {
    const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    const fetchFn = vi.fn();
    try {
      await expect(httpTransport({ endpoint: 'http://127.0.0.1:5231', action: 'inspect', runId, body: {}, token,
        fetchFn, allowLoopbackForTests: true })).rejects.toThrow('common_runner_transport_unconfigured');
      expect(fetchFn).not.toHaveBeenCalled();
    } finally { process.env.NODE_ENV = old; }
  });
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

describe('needs_review中央闭环',()=>{
  function reviewEvidence({cleanupPass=true,executionUnknown=false,pending=0}={}){
    const cleanup={verdict:cleanupPass?'pass':'unknown',acceptance_ref:'cleanup@1',evidence:cleanupPass?['independent-lock-release-readback']:[]};
    const validation={workflow:{verdict:'unknown'},activities:{demo:{verdict:'fail',acceptance_ref:'demo@1',evidence:['failed-check']}},cleanup};
    const centralSpans=[{occurrence_key:'validation:review',payload_sha256:'e'.repeat(64),evidence:{task_id:taskId,machine_id:'node-a',profile_digest:'a'.repeat(64),mode:'exploration',kind:'validation',activity:'demo',workflow_validation:validation.workflow,validation:validation.activities.demo,cleanup_validation:cleanup}}];
    const manifest=centralSpans.map(({occurrence_key,payload_sha256})=>({occurrence_key,payload_sha256}));
    const writeback={pending,blocked:0,total:1,acked:pending?0:1,manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
    return {centralSpans,workerReceipt:{status:'needs_review',execution_unknown:executionUnknown,validation,writeback}};
  }
  it('完整记录和清场独立读回后用failed生命周期保存needs_review业务状态',async()=>{
    const x=await setup(reviewEvidence());const r=await x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'});
    expect(r.central_run).toMatchObject({status:'needs_review',recording_status:'confirmed'});
    expect(x.finish).toHaveBeenCalledWith(expect.objectContaining({runId,status:'failed',result:expect.objectContaining({common_runner:expect.objectContaining({business_status:'needs_review'})})}),expect.objectContaining({strict:true}));
  });
  it.each([undefined,false,true])('免清场声明只有同时明确原执行已停止才允许审查归位 %s',async executionUnknown=>{
    const evidence=reviewEvidence({cleanupPass:false});evidence.workerReceipt.cleanup_required=false;evidence.workerReceipt.execution_unknown=executionUnknown;
    const x=await setup(evidence);const r=await x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'});
    expect(r.central_run.status).toBe(executionUnknown===false?'needs_review':'running');expect(x.finish).toHaveBeenCalledTimes(executionUnknown===false?1:0);
  });
  it.each([false,true])('finish ACK丢失仅凭同task且业务状态相同的中央记录确认needs_review %s',async matching=>{
    const x=await setup({...reviewEvidence(),finishAlready:true,savedCentralRun:{status:'failed',task_id:taskId,ended_at:'2026-11-03T00:00:00Z',result:{common_runner:{business_status:matching?'needs_review':'failed'}}}});
    const r=await x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'});
    expect(r.central_run.status).toBe(matching?'needs_review':'running');expect(r.central_run.recording_status).toBe(matching?'confirmed':'pending');
  });
  it.each([{cleanupPass:false},{executionUnknown:true},{pending:1}])('未独立确认资源清理或记录不得关闭run %j',async overrides=>{
    const x=await setup(reviewEvidence(overrides));const r=await x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'});
    expect(r.central_run).toMatchObject({status:'running',recording_status:'pending'});expect(x.finish).not.toHaveBeenCalled();
  });
});

describe('internal workflow source policy', () => {
  it('retains the public agent-only guard even when payload claims workflow authority', async () => {
    const x=await setup(); x.task.kind='workflow'; x.task.task_type='workflow_dispatch';
    x.task.payload={common_runner_authorized:true};
    await expect(x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'})).rejects.toThrow('common_runner_task_owned');
    expect(x.requests).toHaveLength(0);
  });
  it('calls trusted source authorization inside the transaction and supports immutable source ownership', async () => {
    const policy=vi.fn(async ({task,db,action,body}) => {
      expect(db).toBeDefined(); expect(task.task_type).toBe('workflow_dispatch'); expect(action).toBe('start');
      return task.payload.workflow_definition?.snapshot_sha256==='f'.repeat(64) && body.profile==='demo';
    });
    const x=await setup({taskPolicy:policy}); x.task.kind='workflow'; x.task.task_type='workflow_dispatch';
    x.task.payload={commander_protocol:'commander-v2',workflow_definition:{snapshot_sha256:'f'.repeat(64)}};
    const result=await x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'});
    expect(result.authenticated).toBe(true); expect(policy).toHaveBeenCalledOnce(); expect(x.requests).toHaveLength(1);
  });
  it('rejects a source policy refusal before either registration or worker transport', async () => {
    const x=await setup({taskPolicy:async()=>false}); x.task.kind='workflow';
    await expect(x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'})).rejects.toThrow('common_runner_task_owned');
    expect(x.start).not.toHaveBeenCalled(); expect(x.requests).toHaveLength(0);
  });
});
describe('central unknown execution veto',()=>{
 it.each(['completed','failed'])('does not settle signed %s when worker admits unknown execution',async status=>{
  const validation={workflow:{verdict:'pass',acceptance_ref:'wf',evidence:['actual']},activities:{}};
  const centralSpans=[{occurrence_key:'validation:unknown',payload_sha256:'f'.repeat(64),evidence:{task_id:taskId,machine_id:'node-a',profile_digest:'a'.repeat(64),mode:'exploration',kind:'validation',workflow_validation:validation.workflow}}];
  const manifest=centralSpans.map(({occurrence_key,payload_sha256})=>({occurrence_key,payload_sha256}));
  const writeback={pending:0,blocked:0,total:1,acked:1,manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
  const x=await setup({centralSpans,workerReceipt:{status,execution_unknown:true,validation,writeback}});
  const result=await x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'});
  expect(result.central_run).toEqual({status:'running',recording_status:'pending'});expect(x.finish).not.toHaveBeenCalled();expect(x.task.status).toBe('in_progress');
 });
});
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function ordinaryFormal(){
 const approved={release_id:uuid(11),observation_id:uuid(12),workflow_id:uuid(3),workflow_definition_version_id:uuid(4),snapshot_sha256:'b'.repeat(64),runtime_snapshot_sha256:'c'.repeat(64),expected_path:[{reference_id:uuid(5),activity_id:uuid(6),activity_definition_version_id:uuid(7)}]};
 const fixed={binding:{id:uuid(1),run_id:runId,task_run_id:uuid(2),workflow_id:uuid(3),workflow_definition_version_id:uuid(4),attempt_key:taskId+':1',source_kind:'internal'},release:{target:'node-a'},workflow:{payload:{activities:[{slot_key:'demo',reference_id:uuid(5),activity_id:uuid(6),activity_version_id:uuid(7)}]}},activities:[{id:uuid(7),activity_id:uuid(6)}]};
 return {approved,fixed,body:{task_id:taskId,profile:'demo',input:{},mode:'formal'}};
}
describe('普通agent正式入口原事务内部绑定',()=>{
 it('只从Task固定声明建立真实internal binding，再独立读回并幂等发起原run',async()=>{
  const f=ordinaryFormal(),x=await setup({definitionAfterStart:f.fixed});x.task.payload.workflow_definition=f.approved;
  expect((await x.dispatcher.dispatch('start',runId,f.body)).authenticated).toBe(true);await x.dispatcher.dispatch('start',runId,f.body);
  expect(x.start).toHaveBeenCalledTimes(1);expect(x.start).toHaveBeenCalledWith(expect.objectContaining({taskId,runId,source:'common-runner',definition:{...f.approved,actor:'common-runner',attempt_key:taskId+':1'}}),expect.objectContaining({pool:x.pool,transactionClient:x.pool}));
  expect(x.readDefinition).toHaveBeenCalledTimes(2);expect(x.requests.map(r=>r.path.split('/').at(-1))).toEqual(['start','inspect']);expect(x.requests[0].input.run_binding).toEqual(commonRunnerFormalBinding(f.fixed,runId));
  expect(x.authority.mock.invocationCallOrder[0]).toBeLessThan(x.start.mock.invocationCallOrder[0]);
 });
 it('保留Task原attempt_key，定义校验失败不产生reservation或Worker调用',async()=>{
  const f=ordinaryFormal(),error=Object.assign(Error('invalid-frozen-definition'),{status:422});f.approved.attempt_key='original-attempt';const x=await setup({definitionAfterStart:f.fixed,registrationError:error});x.task.payload.workflow_definition=f.approved;
  await expect(x.dispatcher.dispatch('start',runId,f.body)).rejects.toThrow('invalid-frozen-definition');expect(x.start.mock.calls[0][0].definition.attempt_key).toBe('original-attempt');expect(x.requests).toHaveLength(0);expect(x.task.result.common_runner).toBeUndefined();
 });
 it('缺既有binding的workflow来源不能借普通agent自动绑定路径起跑',async()=>{
  const f=ordinaryFormal(),x=await setup({definitionAfterStart:f.fixed,taskPolicy:async()=>true});x.task.kind='workflow';x.task.task_type='workflow_dispatch';x.task.payload.workflow_definition=f.approved;
  await expect(x.dispatcher.dispatch('start',runId,f.body)).rejects.toThrow('common_runner_formal_binding_required');expect(x.start).not.toHaveBeenCalled();expect(x.requests).toHaveLength(0);
 });
 it('旧run归属冲突在任何固定定义写入和Worker调用前拒绝',async()=>{
  const f=ordinaryFormal(),x=await setup({definitionAfterStart:f.fixed,priorRun:{task_id:uuid(99),status:'running',ended_at:null}});x.task.payload.workflow_definition=f.approved;
  await expect(x.dispatcher.dispatch('start',runId,f.body)).rejects.toThrow('common_runner_identity_conflict');expect(x.start).not.toHaveBeenCalled();expect(x.requests).toHaveLength(0);
 });
 it('grant拒绝优先于任何普通formal定义绑定和Worker调用',async()=>{
  const f=ordinaryFormal(),x=await setup({definitionAfterStart:f.fixed});x.task.payload.workflow_definition=f.approved;x.authority.mockRejectedValue(Error('execution_grant_denied'));
  await expect(x.dispatcher.dispatch('start',runId,f.body)).rejects.toThrow('execution_grant_denied');expect(x.start).not.toHaveBeenCalled();expect(x.requests).toHaveLength(0);
 });
});
function policyFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'common-grant-')),file=path.join(root,'policy.json');
 const c={machine_id:'us-mac-m4',machine_registry_id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',profile_sha256:'a'.repeat(64),source_repo:'owner/repo',source_commit:'b'.repeat(40),release_id:uuid(21),observation_id:uuid(22),evidence_task_id:uuid(23),expires_at:new Date(Date.now()+3600000).toISOString()};
 const write=()=>fs.writeFileSync(file,JSON.stringify({schema_version:1,profiles:{demo:c}}),{mode:0o600});write();
 const grant={provenance:'mac_managed_profile/v1:'+createHash('sha256').update(JSON.stringify(c)).digest('hex'),profile_id:'demo',node_version_id:'version-a',state:'active',account_id:'',repo_scope:[],evidence_task_id:c.evidence_task_id,expires_at:c.expires_at};return {root,file,c,grant,write};
}
describe('受保护Mac profile grant不可随同名配置漂移',()=>{
 it('同名profile SHA更换不能复用旧政策grant触发任何startRun或Worker',async()=>{
  const p=policyFixture();try{const x=await setup({machineId:'us-mac-m4',profileSha:'c'.repeat(64),grant:p.grant,policyFile:p.file});await expect(x.dispatcher.dispatch('start',runId,{task_id:taskId,profile:'demo',input:{},mode:'exploration'})).rejects.toThrow('execution_script_grant_policy_mismatch');expect(x.start).not.toHaveBeenCalled();expect(x.requests).toHaveLength(0);}finally{fs.rmSync(p.root,{recursive:true,force:true});}
 });
 it('已签未启动回执重试必须重新核政策，撤销不能靠旧reservation再次start',async()=>{
  const p=policyFixture();try{const x=await setup({machineId:'us-mac-m4',grant:p.grant,policyFile:p.file,workerResponses:[{status:'waiting_resources',execution_state:'not_started'}]});const body={task_id:taskId,profile:'demo',input:{},mode:'exploration'};await x.dispatcher.dispatch('start',runId,body);p.c.source_commit='c'.repeat(40);p.write();await expect(x.dispatcher.dispatch('start',runId,body)).rejects.toThrow('execution_script_grant_policy_mismatch');expect(x.requests).toHaveLength(1);expect(x.start).toHaveBeenCalledTimes(1);}finally{fs.rmSync(p.root,{recursive:true,force:true});}
 });
});
it.each([{source_kind:'external'},{external_origin:'legacy-ack'},{task_run_id:uuid(99)}])('普通Task正式声明不得夹带运行来源或既有task_run %j',async extra=>{
 const f=ordinaryFormal(),x=await setup({definitionAfterStart:f.fixed});x.task.payload.workflow_definition={...f.approved,...extra};
 await expect(x.dispatcher.dispatch('start',runId,f.body)).rejects.toThrow('common_runner_formal_binding_required');expect(x.start).not.toHaveBeenCalled();expect(x.requests).toHaveLength(0);
});
it.each(['release-drift','evidence-withdrawn'])('新Mac grant启动重试须异步读回当前中央政策证据：%s',async change=>{
 const p=policyFixture();try{
  const x=await setup({machineId:'us-mac-m4',grant:p.grant,policyFile:p.file,workerResponses:[{status:'waiting_resources',execution_state:'not_started'}]}),body={task_id:taskId,profile:'demo',input:{},mode:'exploration'};
  await x.dispatcher.dispatch('start',runId,body);
  if(change==='release-drift')x.policyState.observation.payload.components=[];else x.policyState.task.status='cancelled';
  await expect(x.dispatcher.dispatch('start',runId,body)).rejects.toThrow('execution_script_');expect(x.requests).toHaveLength(1);expect(x.start).toHaveBeenCalledTimes(1);
 }finally{fs.rmSync(p.root,{recursive:true,force:true});}
});
