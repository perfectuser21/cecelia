import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, taskId, runId } from './recovery-rebase.fixture.js';
import { seedExecutionDirectoryFixture } from '../../__tests__/helpers/execution-directory-fixture.js';
import { executionProfileHash } from '../recovery-execution-profile.js';
import { collectGroundTruth } from '../ground-truth.js';
import { createDispatcher } from '../dispatcher.js';

// 仅隔离数据库传输与外部执行；恢复、冻结、观测、派发均运行真实模块。
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../../db.js', () => ({ default: db }));
const target = { machine: 'xian-mac-m4', provider: 'codex', account: 'team2' };
const oldProfile = {
  executor: 'codex', executor_account: 'team1',
  role_assignments: { generator: { machine: 'us-mac-m4', provider: 'codex', account: 'team1' } },
};
afterEach(() => vi.unstubAllEnvs());

async function recoveryFixture(mutate = () => {}) {
  const f = fixture();
  const snapshot = await seedExecutionDirectoryFixture();
  const node = snapshot.nodes.find(n => n.canonical_id === target.machine);
  const grant = node.grants.find(g => g.surface === 'harness' && g.account_id === target.account);
  Object.assign(f.request, { execution_target: { ...target }, expected_profile_hash: executionProfileHash(oldProfile) });
  mutate(f.request);
  const client = await f.pool.connect();
  const originalQuery = client.query;
  const state = { task: null, receipt: null, run: null };
  client.query = async (sql, params) => {
    if (/SELECT v\.\*,n.canonical_id/.test(sql)) return { rows: [node] };
    if (/SELECT \* FROM execution_grants/.test(sql)) return { rows: [grant] };
    const result = await originalQuery(sql, params);
    if (/FROM tasks/.test(sql) && /FOR UPDATE/.test(sql)) {
      result.rows[0].payload = { ...result.rows[0].payload, ...oldProfile,
        repo: 'cecelia', change_kind: 'capability_change', worktree_path: '/tmp/recovery-test' };
      state.task = structuredClone(result.rows[0]);
    }
    if (/FROM work_routing_receipts receipt/.test(sql)) {
      result.rows[0].router_version = 'work-router-v1';
      state.receipt = structuredClone(result.rows[0]);
    }
    if (/INSERT INTO work_routing_receipts/.test(sql)) {
      state.receipt = { ...state.receipt, ...result.rows[0], evidence: JSON.parse(params[15]), superseded: false };
    }
    if (/UPDATE tasks SET payload=/.test(sql)) {
      state.task.payload = { ...state.task.payload, ...JSON.parse(params[1]) };
    }
    if (/INSERT INTO initiative_runs/.test(sql)) {
      result.rows[0] = { ...result.rows[0], current_task_id: params[6], phase: params[1], contract_id: params[15] };
      state.run = structuredClone(result.rows[0]);
    }
    return result;
  };
  db.connect.mockImplementation(f.pool.connect);
  const { default: router } = await import('../../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.set('kernelRunStoreDeps', f.deps);
  app.use('/api/brain/orchestrator', router);
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'synthetic-cross-path-token');
  const send = () => request(app).post('/api/brain/orchestrator/relay-runs')
    .set('X-Internal-Token', 'synthetic-cross-path-token').send({
      initiative_id: f.input.initiativeId, current_task_id: taskId, phase: 'planning',
      created_source: 'explicit_recovery', predecessor_run_id: runId, recovery_rebase: f.request,
    });
  return { f, state, send };
}

function candidateAttempt(ownerRun, machine, hop = 2) {
  const id = randomUUID();
  const candidate = { type: 'git_candidate', verification_status: 'verified', source_attempt_id: id,
    repo: 'perfectuser21/cecelia', branch: 'cp-recovery', base_sha: 'b'.repeat(40),
    head_sha: 'd'.repeat(40), machine_id: machine, changed_files: ['packages/brain/src/example.js'] };
  return { id, run_id: ownerRun, role: 'generator', status: 'completed', hop,
    actual_machine_id: machine, result: { artifacts: [candidate] },
    task_bundle: { run_id: ownerRun, inputs: { task_id: taskId, workspace_spec: {
      repo: candidate.repo, branch: candidate.branch, base_sha: candidate.base_sha,
    } } } };
}

async function observe(state, attempts) {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (/SELECT \* FROM initiative_runs WHERE id/.test(sql)) return { rows: [state.run] };
    if (/SELECT \* FROM tasks WHERE id/.test(sql)) return { rows: [state.task] };
    if (/FROM work_routing_receipts receipt/.test(sql)) return { rows: [state.receipt] };
    if (/FROM harness_attempts/.test(sql) && !/role = 'evaluator'/.test(sql)) {
      // 故意含同任务旧run污染行，候选筛选必须自己再次校验run身份。
      return { rows: attempts };
    }
    return { rows: [] };
  } };
  const observed = await collectGroundTruth({ pool, execCmd: cmd => cmd.includes('gh pr list') ? '[]' : '',
    fileExists: () => false, readFile: () => '', readAuthCircuit: async () => [] },
  { taskId, runId: state.run.id });
  expect(queries.find(q => /FROM harness_attempts/.test(q.sql) && /ORDER BY hop/.test(q.sql)).params)
    .toEqual([state.run.id]);
  return observed;
}

function dispatchFixture() {
  const created = [], launched = [];
  const deps = {
    machineId: 'us-mac-m4', leaseOwner: 'cross-path-test', randomUUID,
    createCallbackSecret: () => 'synthetic-callback-secret',
    resolveAccountHome: (_provider, account) => `/tmp/synthetic-${account}`,
    loadSkill: name => ({ name, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: 'test instructions' }),
    registry: { resolve: () => ({ name: 'codex', start: () => ({ command: 'codex', args: [], stdin: '{}' }) }) },
    attemptStore: {
      createAttempt: async input => { created.push(input); return input; },
      markStarting: async id => ({ id, status: 'starting', lease_owner: 'cross-path-test', lease_generation: 0 }),
      recordLaunchReceipt: async (id, receipt) => ({ id, ...receipt }),
      fail: vi.fn(),
    },
    launcher: { launch: async input => {
      launched.push(input);
      return { actualMachineId: input.target.machine, executionTransport: 'remote-bridge',
        attestationStatus: 'verified', containerId: null, remoteJobId: 'synthetic-job', jobId: 'synthetic-job' };
    }, cancel: vi.fn() },
  };
  return { created, launched, dispatch: createDispatcher(deps) };
}

async function dispatchAndCheck(d, observed, action, hop) {
  const result = await d.dispatch(action, { taskId, runId: observed.run.id, hop, observed,
    decision: { phase: action === 'spawn:planner' ? 'planning' : 'evaluate' },
    validationClock: { pipeline_started_at: '2026-10-02T00:00:00.000Z', deadline_at: '2026-10-02T01:30:00.000Z' } });
  expect(result).toMatchObject({ status: 'LAUNCHED', provider: 'codex' });
  expect(d.created.at(-1)).toMatchObject({ runId: observed.run.id, machineId: target.machine,
    accountId: target.account, provider: target.provider });
  expect(d.launched.at(-1).target).toEqual(target);
}

describe('恢复目标跨真实入口、ground-truth、dispatcher', () => {
  it('新planning无候选及旧us完成投影均实际派发到冻结的西安team2', async () => {
    const r = await recoveryFixture();
    const response = await r.send();
    expect(response.status).toBe(201);
    expect(response.body.run.phase).toBe('planning');
    expect(response.body.run.id).not.toBe(runId);
    expect(r.state.receipt.evidence.recovery_rebase.execution_profile.target).toEqual(target);
    const d = dispatchFixture();
    for (const attempts of [[], [candidateAttempt(runId, 'us-mac-m4', 99)]]) {
      const observed = await observe(r.state, attempts);
      expect(observed.candidate).toBeNull();
      await dispatchAndCheck(d, observed, 'spawn:planner', d.created.length + 1);
    }
    expect(d.created).toHaveLength(2);
    expect(d.launched).toHaveLength(2);
    expect(r.f.calls.some(c => /UPDATE initiative_runs|UPDATE work_routing_receipts/.test(c.sql))).toBe(false);
  });

  it('同新run可信西安候选压过旧us投影，Evaluator和Judge保持候选机器亲和', async () => {
    const r = await recoveryFixture();
    expect((await r.send()).status).toBe(201);
    const current = candidateAttempt(r.state.run.id, target.machine);
    const observed = await observe(r.state, [candidateAttempt(runId, 'us-mac-m4', 99), current]);
    expect(observed.candidate).toEqual(current.result.artifacts[0]);
    const identity = { contract_id: randomUUID(), manifest_sha256: 'e'.repeat(64), source_revision: 'f'.repeat(40) };
    const evaluatorId = randomUUID();
    const ready = { ...observed, contract: { approved: true, identity, row: null },
      evaluateVerdict: { verdict: 'PASS', attempt_id: evaluatorId,
        pr_head_sha: observed.candidate.head_sha, contract_identity: identity },
      evaluateResult: { attempt_id: evaluatorId, status: 'completed', checks: [], decision: { outcome: 'PASS' } } };
    const d = dispatchFixture();
    await dispatchAndCheck(d, ready, 'spawn:evaluator', 3);
    await dispatchAndCheck(d, ready, 'spawn:judge', 4);
    expect(d.created.map(a => a.role)).toEqual(['evaluator', 'judge']);
    expect(d.launched.map(a => a.bundle.inputs.candidate)).toEqual([observed.candidate, observed.candidate]);
  });

  it.each([
    ['旧profile冲突', request => { request.expected_profile_hash = '0'.repeat(64); }, 409],
    ['非法target', request => { request.execution_target.machine = 'http://invalid'; }, 400],
  ])('%s在正规入口拒绝且零attempt/launch', async (_name, mutate, status) => {
    const r = await recoveryFixture(mutate);
    const d = dispatchFixture();
    const response = await r.send();
    if (response.status === 201) {
      await dispatchAndCheck(d, await observe(r.state, []), 'spawn:planner', 1);
    }
    expect(response.status).toBe(status);
    expect(r.state.run).toBeNull();
    expect(r.f.calls.some(c => /INSERT INTO initiative_runs|INSERT INTO work_routing_receipts/.test(c.sql))).toBe(false);
    expect(d.created).toEqual([]);
    expect(d.launched).toEqual([]);
  });
});
