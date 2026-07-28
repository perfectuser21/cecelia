import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { signMachineAttestation } from '../../orchestrator/machine-attestation.js';
import { computeRoleResultRawSha256 } from '../../orchestrator/execution-contract.js';

const require = createRequire(import.meta.url);
const { finalizeRoleResult } = require(
  '../../../../../docker/cecelia-runner/result-channel-finalizer.cjs',
);

const mocks = vi.hoisted(() => ({
  store: {
    getById: vi.fn(),
    assertFreshRoleSession: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    heartbeat: vi.fn(),
    markRunning: vi.fn(),
    persistFleetHeartbeat: vi.fn(),
  },
  pool: { query: vi.fn() },
}));

vi.mock('../../orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => mocks.store,
}));
vi.mock('../../db.js', () => ({ default: mocks.pool }));
vi.mock('../../lib/harness-thread-lookup.js', () => ({ lookupHarnessThread: vi.fn() }));
vi.mock('../../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../../lib/harness-orphan-guard.js', () => ({
  handleRelayExitConsistency: vi.fn(async () => ({ action: 'noop' })),
}));

const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';
const taskId = '44444444-4444-4444-8444-444444444444';
const prHeadSha = '0123456789abcdef0123456789abcdef01234567';
const contractSha = 'abcdef0123456789abcdef0123456789abcdef01';
const callbackToken = 'attempt-callback-secret';
const leaseOwner = 'brain-1:123';
const fleetSecret = 'kernel-fleet-bridge-secret-at-least-32-bytes';
const localMachineId = 'us-mac-m4';
const remoteMachineId = 'xian-mac-m4';
const remoteJobId = 'xian-job-7';
const credentialRef = '33333333-3333-4333-8333-333333333333';

const attempt = {
  id: attemptId,
  run_id: runId,
  hop: 4,
  role: 'evaluator',
  provider: 'codex',
  status: 'running',
  lease_owner: leaseOwner,
  lease_generation: 2,
  requested_machine_id: localMachineId,
  actual_machine_id: localMachineId,
  execution_transport: 'local-docker',
  remote_job_id: null,
  machine_attestation_status: 'local',
  callback_secret_hash: createHash('sha256').update(callbackToken).digest('hex'),
  task_bundle: {
    inputs: {
      contract_round: 2,
      pull_request: { head_sha: 'sha-1' },
    },
  },
};

const validResult = {
  contract_version: '1.0',
  attempt_id: attemptId,
  status: 'completed',
  summary: 'all checks passed',
  artifacts: [],
  checks: [{ command: 'npm test', exit_code: 0 }],
  decision: { outcome: 'PASS', reason: 'behavior tests passed' },
  error: null,
  provider_metadata: { provider: 'codex', session_id: 'thread-1' },
};

function commanderAttempt(overrides = {}) {
  return {
    ...attempt,
    role: 'commander',
    task_bundle: {
      expected_output: 'commander-directive/v1',
      inputs: {
        commander_bundle: {
          run_id: runId,
          commander_attempt_id: attemptId,
          event_cursor: 5,
        },
      },
    },
    ...overrides,
  };
}

function commanderResult(overrides = {}) {
  return {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'completed',
    summary: 'Continue the current Kernel decision.',
    artifacts: [],
    checks: [],
    decision: {
      schema: 'commander-directive/v1',
      run_id: runId,
      event_cursor: 5,
      action: 'continue_default',
      reason: 'Continue the current Kernel decision.',
      evidence_refs: ['event:5'],
    },
    error: null,
    provider_metadata: { provider: 'codex', session_id: 'commander-session' },
    ...overrides,
  };
}

function remoteAttempt(overrides = {}) {
  return {
    ...attempt,
    requested_machine_id: remoteMachineId,
    actual_machine_id: remoteMachineId,
    execution_transport: 'remote-bridge',
    remote_job_id: remoteJobId,
    machine_attestation_status: 'verified',
    ...overrides,
  };
}

function remoteResult(overrides = {}) {
  const machineId = overrides.machine_id ?? remoteMachineId;
  const jobId = overrides.job_id ?? remoteJobId;
  const attestation = overrides.machine_attestation ?? signMachineAttestation({
    secret: fleetSecret,
    attemptId,
    machineId,
    jobId,
  });
  return {
    ...validResult,
    provider_metadata: {
      ...validResult.provider_metadata,
      machine_id: machineId,
      machine_attestation: attestation,
    },
  };
}

function fleetAttempt(overrides = {}) {
  return {
    ...attempt,
    requested_machine_id: remoteMachineId,
    actual_machine_id: remoteMachineId,
    execution_transport: 'fleet-worker',
    remote_job_id: remoteJobId,
    machine_attestation_status: 'verified',
    ...overrides,
  };
}

function fleetResult(overrides = {}) {
  return {
    ...validResult,
    provider_metadata: {
      ...validResult.provider_metadata,
      credential_ref: credentialRef,
      credential_copy_mutated: false,
      ...overrides,
    },
  };
}

function postCallback(app, body = validResult, token = callbackToken, owner = leaseOwner) {
  let call = request(app)
    .post(`/api/brain/harness/attempts/${attemptId}/callback`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Harness-Lease-Owner', owner);
  return call.send(body);
}

function postFleetHeartbeat(app, {
  providerSessionId = null,
  attemptRecord = fleetAttempt(),
  heartbeatNonce = randomUUID(),
  observedAt = new Date().toISOString(),
  leaseSeconds = 180,
} = {}) {
  const body = {
    schema_version: 'fleet-attempt-heartbeat/v1',
    heartbeat_nonce: heartbeatNonce,
    observed_at: observedAt,
    lease_seconds: leaseSeconds,
    provider_session_id: providerSessionId,
  };
  const signingPayload = `${[
    'cecelia-fleet-heartbeat/v1',
    attemptId,
    attemptRecord.actual_machine_id,
    runId,
    attemptRecord.remote_job_id,
    attemptRecord.lease_owner,
    String(attemptRecord.lease_generation),
    heartbeatNonce,
    observedAt,
    String(leaseSeconds),
    providerSessionId ?? '',
  ].join('\n')}\n`;
  mocks.store.getById.mockResolvedValue(attemptRecord);
  return request(app)
    .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
    .set('X-Cecelia-Fleet-Protocol', 'fleet-heartbeat/v1')
    .set('X-Cecelia-Fleet-Worker-Id', attemptRecord.actual_machine_id)
    .set('X-Cecelia-Fleet-Run-Id', runId)
    .set('X-Cecelia-Fleet-Job-Id', attemptRecord.remote_job_id)
    .set('X-Cecelia-Fleet-Lease-Owner', attemptRecord.lease_owner)
    .set(
      'X-Cecelia-Fleet-Lease-Generation',
      String(attemptRecord.lease_generation),
    )
    .set('X-Cecelia-Fleet-Heartbeat-Nonce', heartbeatNonce)
    .set(
      'Authorization',
      `Cecelia-Fleet-HMAC-SHA256 ${
        createHmac('sha256', fleetSecret).update(signingPayload).digest('hex')
      }`,
    )
    .send(body);
}

function evaluatorRoleCallback() {
  const behaviorTests = [{
    command: 'npm test',
    exit_code: 0,
    log_tail: 'green',
  }];
  const claimed = {
    verdict: 'PASS',
    task_id: taskId,
    attempt_id: attemptId,
    behavior_tests: behaviorTests,
  };
  const pullRequest = {
    type: 'pull_request',
    url: 'https://github.com/perfectuser21/cecelia/pull/4391',
    number: 4391,
    head_ref: 'cp-result-channel',
    head_sha: prHeadSha,
    state: 'OPEN',
  };
  return {
    ...validResult,
    artifacts: [{
      type: 'evaluation_target',
      url: pullRequest.url,
      number: pullRequest.number,
      head_ref: pullRequest.head_ref,
      head_sha: pullRequest.head_sha,
      contract_sha: contractSha,
    }],
    checks: behaviorTests,
    decision: {
      outcome: 'PASS',
      reason: '',
      pr_head_sha: prHeadSha,
      contract_sha: contractSha,
      unverifiable: [],
    },
    role_result: {
      kind: 'evaluator',
      raw_sha256: computeRoleResultRawSha256(claimed),
      claimed,
      verified: {
        contract_sha: contractSha,
        pull_request: pullRequest,
        behavior_tests: behaviorTests,
      },
    },
  };
}

function finalizedRoleCallback(role, rawEnvelope, verifierEnvelope) {
  return finalizeRoleResult({
    expectedOutput: `harness-result/${role}-v1`,
    binding: {
      task_id: taskId,
      run_id: runId,
      attempt_id: attemptId,
      role,
    },
    providerResult: {
      contract_version: '1.0',
      attempt_id: attemptId,
      status: 'completed',
      summary: `${role} completed`,
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex', session_id: 'thread-1' },
    },
    rawEnvelope,
    verifierEnvelope,
  });
}

it('production server 从环境注入 bridge token 且不记录 secret', () => {
  const serverSource = readFileSync(new URL('../../../server.js', import.meta.url), 'utf8');

  expect(serverSource).toContain(
    "app.set('kernelFleetBridgeToken', process.env.KERNEL_FLEET_BRIDGE_TOKEN);",
  );
  expect(serverSource).not.toMatch(
    /console\.(?:log|warn|error)\([\s\S]{0,200}process\.env\.KERNEL_FLEET_BRIDGE_TOKEN/,
  );
});

describe('POST /harness/attempts/:attemptId/callback', () => {
  let app;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    mocks.store.getById.mockResolvedValue(attempt);
    mocks.store.assertFreshRoleSession.mockResolvedValue(true);
    mocks.store.complete
      .mockResolvedValueOnce({ attempt: { ...attempt, status: 'completed' }, deduped: false })
      .mockResolvedValueOnce({ attempt: null, deduped: true });
    mocks.store.fail.mockResolvedValue({ attempt: { ...attempt, status: 'failed' }, deduped: false });
    mocks.store.heartbeat.mockResolvedValue({ ...attempt, heartbeat_at: new Date().toISOString() });
    mocks.store.markRunning.mockResolvedValue({ ...attempt, provider_session_id: 'thread-live' });
    mocks.store.persistFleetHeartbeat.mockImplementation(async (heartbeat) => ({
      attempt: fleetAttempt(),
      receipt: {
        ...heartbeat,
        receipt_id: randomUUID(),
        attempt_id: heartbeat.attemptId,
        run_id: heartbeat.runId,
        worker_id: heartbeat.workerId,
        job_id: heartbeat.jobId,
        lease_owner: heartbeat.leaseOwner,
        lease_generation: heartbeat.leaseGeneration,
        heartbeat_nonce: heartbeat.heartbeatNonce,
        request_sha256: heartbeat.requestSha256,
        observed_at: heartbeat.observedAt,
        lease_seconds: heartbeat.leaseSeconds,
        provider_session_id: heartbeat.providerSessionId,
        heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + 180_000).toISOString(),
      },
      deduped: false,
    }));
    mocks.pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { default: router } = await import('../harness-callback.js');
    app = express();
    app.set('kernelFleetBridgeToken', fleetSecret);
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('接受 machine attestation 与 launch receipt 一致的 xian callback', async () => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app, remoteResult());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, deduped: false });
    expect(mocks.store.complete).toHaveBeenCalledOnce();
  });

  it('persists a valid Commander Directive as the terminal Attempt result', async () => {
    mocks.store.getById.mockResolvedValue(commanderAttempt());

    const response = await postCallback(app, commanderResult());

    expect(response.status).toBe(200);
    expect(mocks.store.complete).toHaveBeenCalledWith(
      attemptId,
      expect.objectContaining({
        status: 'completed',
        decision: expect.objectContaining({
          schema: 'commander-directive/v1',
          run_id: runId,
          event_cursor: 5,
        }),
      }),
      { leaseOwner },
    );
    const proposalCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('commander.directive_proposed')
    ));
    expect(proposalCalls).toHaveLength(1);
    expect(JSON.parse(proposalCalls[0][1][3])).toMatchObject({
      attempt_id: attemptId,
      directive: {
        schema: 'commander-directive/v1',
        run_id: runId,
        event_cursor: 5,
      },
    });
  });

  it.each([
    [
      'unknown Directive field',
      commanderResult({
        decision: {
          ...commanderResult().decision,
          raw_provider_output: 'must not persist',
        },
      }),
    ],
    [
      'foreign Run identity',
      commanderResult({
        decision: {
          ...commanderResult().decision,
          run_id: '44444444-4444-4444-8444-444444444444',
        },
      }),
    ],
    [
      'mismatched bundle cursor',
      commanderResult({
        decision: {
          ...commanderResult().decision,
          event_cursor: 4,
        },
      }),
    ],
  ])('rejects Commander callback with %s before persistence', async (_name, body) => {
    mocks.store.getById.mockResolvedValue(commanderAttempt());

    const response = await postCallback(app, body);

    expect(response.status).toBe(400);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('Fleet Worker attempt 不得降级使用旧 Bearer callback', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult({
      credential_copy_mutated: true,
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('fleet_callback_hmac_required');
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['missing credential ref', { credential_ref: undefined }],
    ['invalid credential ref', { credential_ref: 'not-a-uuid' }],
    ['non-boolean mutation evidence', { credential_copy_mutated: 'false' }],
    ['provider credential field', { access_token: 'must-not-persist' }],
  ])('旧 Bearer 路径不解析 Fleet Codex callback 的 %s', async (_case, metadata) => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult(metadata));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('fleet_callback_hmac_required');
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('拒绝 dedicated canary contract 缺少 CANARY_OK 的 completed callback', async () => {
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role: 'reporter',
      task_bundle: {
        ...attempt.task_bundle,
        expected_output: 'harness-result/canary-v1',
      },
    });

    const response = await postCallback(app, {
      ...validResult,
      decision: null,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/CANARY_OK/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it.each([
    [
      'requested machine',
      remoteAttempt({ requested_machine_id: 'xian-mac-m1' }),
      remoteResult(),
    ],
    [
      'actual machine',
      remoteAttempt({ actual_machine_id: 'xian-mac-m1' }),
      remoteResult(),
    ],
  ])('拒绝 callback machine_id 与 %s receipt 不一致', async (_label, receipt, body) => {
    mocks.store.getById.mockResolvedValue(receipt);

    const response = await postCallback(app, body);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('machine_attestation_mismatch');
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it.each([
    [
      'copied from another attempt',
      signMachineAttestation({
        secret: fleetSecret,
        attemptId: '33333333-3333-4333-8333-333333333333',
        machineId: remoteMachineId,
        jobId: remoteJobId,
      }),
    ],
    ['invalid', '0'.repeat(64)],
  ])('拒绝 %s machine attestation', async (_label, machineAttestation) => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app, remoteResult({
      machine_attestation: machineAttestation,
    }));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('machine_attestation_mismatch');
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('local receipt 无 remote attestation 时仍可完成 callback', async () => {
    mocks.store.getById.mockResolvedValue(attempt);

    const response = await postCallback(app);

    expect(response.status).toBe(200);
    expect(mocks.store.complete).toHaveBeenCalledOnce();
  });

  it('从 persisted TaskBundle 注入 evaluator task authority 后接受 exact role_result', async () => {
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      task_bundle: {
        expected_output: 'harness-result/evaluator-v1',
        inputs: {
          task_id: taskId,
          contract_sha: contractSha,
          pull_request: {
            url: 'https://github.com/perfectuser21/cecelia/pull/4391',
            head_ref: 'cp-result-channel',
            head_sha: prHeadSha,
            state: 'OPEN',
          },
        },
      },
    });

    const response = await postCallback(app, evaluatorRoleCallback());

    expect(response.status).toBe(200);
    expect(mocks.store.complete).toHaveBeenCalledWith(
      attemptId,
      expect.objectContaining({
        role_result: expect.objectContaining({ kind: 'evaluator' }),
      }),
      { leaseOwner },
    );
  });

  it('拒绝 evaluator role_result 绕过 persisted TaskBundle task authority', async () => {
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      task_bundle: {
        expected_output: 'harness-result/evaluator-v1',
        inputs: {
          task_id: runId,
          contract_sha: contractSha,
          pull_request: { head_sha: prHeadSha },
        },
      },
    });

    const response = await postCallback(app, evaluatorRoleCallback());

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/task_id authority mismatch/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['reviewer contract SHA', () => {
      const rubric = {
        dod_machineability: 10,
        scope_match_prd: 10,
        test_is_red: 10,
        internal_consistency: 10,
        risk_registered: 10,
        verification_oracle_completeness: 10,
        ci_workflow_alignment: 10,
      };
      return {
        attempt: {
          ...attempt,
          role: 'reviewer',
          task_bundle: {
            expected_output: 'harness-result/reviewer-v1',
            inputs: {
              task_id: taskId,
              sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
              contract_sha: 'a'.repeat(40),
            },
          },
        },
        body: finalizedRoleCallback('reviewer', {
          verdict: 'REVISION',
          rubric_scores: rubric,
          judgments_written: 0,
          feedback: 'fix contract',
        }, {
          contract_sha: 'b'.repeat(40),
          verdict: 'REVISION',
          rubric_scores: rubric,
          judgments_written: 0,
        }),
      };
    }],
    ['proposer expected branch', () => {
      const sprintDir = 'sprints/07280905-kernel-result-channel-bootstrap';
      const artifact = (path) => ({
        path,
        sha256: `sha256:${'c'.repeat(64)}`,
      });
      return {
        attempt: {
          ...attempt,
          role: 'proposer',
          task_bundle: {
            expected_output: 'harness-result/proposer-v1',
            inputs: {
              task_id: taskId,
              sprint_dir: sprintDir,
              propose_branch: 'cp-authoritative-proposer',
            },
          },
        },
        body: finalizedRoleCallback('proposer', {
          propose_branch: 'cp-forged-proposer',
          workstream_count: 1,
          task_plan_path: `${sprintDir}/task-plan.json`,
        }, {
          propose_branch: 'cp-forged-proposer',
          head_sha: prHeadSha,
          artifacts: {
            contract_draft: artifact(`${sprintDir}/contract-draft.md`),
            contract_dod: artifact(`${sprintDir}/contract-dod.md`),
            task_plan: artifact(`${sprintDir}/task-plan.json`),
            contract_tests: artifact(`${sprintDir}/tests`),
          },
        }),
      };
    }],
    ['evaluator PR head', () => {
      const body = evaluatorRoleCallback();
      return {
        attempt: {
          ...attempt,
          task_bundle: {
            expected_output: 'harness-result/evaluator-v1',
            inputs: {
              task_id: taskId,
              sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
              contract_sha: contractSha,
              pull_request: {
                url: 'https://github.com/perfectuser21/cecelia/pull/4391',
                head_ref: 'cp-result-channel',
                head_sha: 'f'.repeat(40),
                state: 'OPEN',
              },
            },
          },
        },
        body,
      };
    }],
    ['generator-fix existing PR', () => {
      const pullRequest = {
        type: 'pull_request',
        url: 'https://github.com/perfectuser21/cecelia/pull/4391',
        number: 4391,
        head_ref: 'cp-result-channel',
        head_sha: prHeadSha,
        state: 'OPEN',
      };
      return {
        attempt: {
          ...attempt,
          role: 'generator',
          task_bundle: {
            expected_output: 'harness-result/generator-v1',
            inputs: {
              task_id: taskId,
              sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
              attempt_kind: 'fix',
              pull_request: { ...pullRequest, head_sha: 'f'.repeat(40) },
            },
          },
        },
        body: finalizedRoleCallback('generator', {
          verdict: 'DONE',
          pr_url: pullRequest.url,
        }, {
          pull_request: pullRequest,
        }),
      };
    }],
  ])('拒绝 %s 与 persisted TaskBundle authority 不一致且不产生副作用', async (_name, fixture) => {
    const value = fixture();
    mocks.store.getById.mockResolvedValue(value.attempt);

    const response = await postCallback(app, value.body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/authority mismatch/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('generator-fix 缺 persisted existing PR authority 时 fail closed', async () => {
    const pullRequest = {
      type: 'pull_request',
      url: 'https://github.com/perfectuser21/cecelia/pull/4391',
      number: 4391,
      head_ref: 'cp-result-channel',
      head_sha: prHeadSha,
      state: 'OPEN',
    };
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role: 'generator',
      task_bundle: {
        expected_output: 'harness-result/generator-v1',
        inputs: {
          task_id: taskId,
          sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
          attempt_kind: 'fix',
        },
      },
    });

    const response = await postCallback(app, finalizedRoleCallback('generator', {
      verdict: 'DONE',
      pr_url: pullRequest.url,
    }, {
      pull_request: pullRequest,
    }));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/generator PR authority is required/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it.each([
    ['generator', 'url'],
    ['generator', 'head_ref'],
    ['generator', 'head_sha'],
    ['generator', 'state'],
    ['evaluator', 'url'],
    ['evaluator', 'head_ref'],
    ['evaluator', 'head_sha'],
    ['evaluator', 'state'],
    ['reporter', 'url'],
    ['reporter', 'head_ref'],
    ['reporter', 'head_sha'],
    ['reporter', 'state'],
  ])('%s 的 persisted PR 只有 %s 时 fail closed 且无副作用', async (role, onlyField) => {
    const sprintDir = 'sprints/07280905-kernel-result-channel-bootstrap';
    const reportPath = `${sprintDir}/harness-report.md`;
    const pullRequest = {
      type: 'pull_request',
      url: 'https://github.com/perfectuser21/cecelia/pull/4391',
      number: 4391,
      head_ref: 'cp-result-channel',
      head_sha: prHeadSha,
      state: 'OPEN',
    };
    const bodyByRole = {
      generator: () => finalizedRoleCallback('generator', {
        verdict: 'DONE',
        pr_url: pullRequest.url,
      }, { pull_request: pullRequest }),
      evaluator: evaluatorRoleCallback,
      reporter: () => finalizedRoleCallback('reporter', {
        verdict: 'DONE',
        task_id: taskId,
        report_path: reportPath,
        pr_url: pullRequest.url,
        screenshots: [],
        concerns: '',
      }, {
        pull_request: pullRequest,
        report: { path: reportPath, sha256: `sha256:${'a'.repeat(64)}` },
        learning: {
          path: `${sprintDir}/learning.md`,
          sha256: `sha256:${'b'.repeat(64)}`,
        },
        screenshots: [],
        learnings_inserted: 1,
      }),
    };
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role,
      task_bundle: {
        expected_output: `harness-result/${role}-v1`,
        inputs: {
          task_id: taskId,
          sprint_dir: sprintDir,
          contract_sha: contractSha,
          attempt_kind: role === 'generator' ? 'fix' : 'initial',
          pull_request: { [onlyField]: pullRequest[onlyField] },
        },
      },
    });

    const response = await postCallback(app, bodyByRole[role]());

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/PR authority is required/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('callback PR number 必须匹配 server-owned URL 解析值', async () => {
    const body = evaluatorRoleCallback();
    body.role_result.verified.pull_request.number = 9999;
    body.artifacts[0].number = 9999;
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role: 'evaluator',
      task_bundle: {
        expected_output: 'harness-result/evaluator-v1',
        inputs: {
          task_id: taskId,
          sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
          contract_sha: contractSha,
          pull_request: {
            url: 'https://github.com/perfectuser21/cecelia/pull/4391',
            head_ref: 'cp-result-channel',
            head_sha: prHeadSha,
            state: 'OPEN',
          },
        },
      },
    });

    const response = await postCallback(app, body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/PR number authority mismatch/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('reporter-v1 缺 persisted PR/sprint authority 时 fail closed，canary 路径不受影响', async () => {
    const pullRequest = {
      type: 'pull_request',
      url: 'https://github.com/perfectuser21/cecelia/pull/4391',
      number: 4391,
      head_ref: 'cp-result-channel',
      head_sha: prHeadSha,
      state: 'OPEN',
    };
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role: 'reporter',
      task_bundle: {
        expected_output: 'harness-result/reporter-v1',
        inputs: { task_id: taskId },
      },
    });
    const reportPath = 'sprints/07280905-kernel-result-channel-bootstrap/harness-report.md';

    const response = await postCallback(app, finalizedRoleCallback('reporter', {
      verdict: 'DONE',
      task_id: taskId,
      report_path: reportPath,
      pr_url: pullRequest.url,
      screenshots: [],
      concerns: '',
    }, {
      pull_request: pullRequest,
      report: { path: reportPath, sha256: `sha256:${'a'.repeat(64)}` },
      learning: {
        path: 'sprints/07280905-kernel-result-channel-bootstrap/learning.md',
        sha256: `sha256:${'b'.repeat(64)}`,
      },
      screenshots: [],
      learnings_inserted: 1,
    }));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/reporter sprint authority is required/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('launch receipt 尚未确认时拒绝 callback，避免远端先回调绕过验签', async () => {
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      requested_machine_id: remoteMachineId,
      actual_machine_id: null,
      execution_transport: null,
      remote_job_id: null,
      machine_attestation_status: null,
    });

    const response = await postCallback(app, remoteResult());

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('launch_receipt_unconfirmed');
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.store.fail).not.toHaveBeenCalled();
  });

  it('remote receipt 无 machine attestation 时拒绝 callback', async () => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('machine_attestation_mismatch');
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('重复的 verified xian callback 保持幂等', async () => {
    const runningAttempt = remoteAttempt();
    const completedAttempt = {
      ...runningAttempt,
      status: 'completed',
      result: remoteResult(),
    };
    mocks.store.getById
      .mockReset()
      .mockResolvedValueOnce(runningAttempt)
      .mockResolvedValueOnce(completedAttempt)
      .mockResolvedValueOnce(completedAttempt);

    const first = await postCallback(app, remoteResult());
    const second = await postCallback(app, remoteResult());

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, deduped: false });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, deduped: true });
  });

  it('校验、完成 attempt，并让重复 callback 幂等返回 deduped', async () => {
    const completedAttempt = { ...attempt, status: 'completed', result: validResult };
    mocks.store.getById
      .mockReset()
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce(completedAttempt)
      .mockResolvedValueOnce(completedAttempt);
    const first = await postCallback(app);
    const second = await postCallback(app);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, deduped: false });
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(mocks.store.assertFreshRoleSession).toHaveBeenCalledWith({
      runId,
      attemptId,
      role: 'evaluator',
      sessionId: 'thread-1',
    });
  });

  it('无密钥或错密钥的 callback 返回 401，伪造 reviewer APPROVED 不得写 verdict', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'reviewer' });
    const forged = {
      ...validResult,
      decision: { outcome: 'APPROVED', reason: 'forged approval' },
    };

    const missing = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('X-Harness-Lease-Owner', leaseOwner)
      .send(forged);
    const wrong = await postCallback(app, forged, 'wrong-secret');

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:reviewer/.test(sql))).toBe(false);
  });

  it('终态 callback 的 lease_owner 不匹配时返回 409', async () => {
    const response = await postCallback(app, validResult, callbackToken, 'other-owner');
    expect(response.status).toBe(409);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('认证后发生换租时拒绝旧 worker，且不得追加 evaluator verdict', async () => {
    mocks.store.complete.mockReset().mockResolvedValue({ attempt: null, deduped: true });
    mocks.store.getById
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce({ ...attempt, status: 'starting', lease_owner: 'brain-2:456' });

    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/lease/i);
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:evaluate/.test(sql))).toBe(false);
  });

  it('evaluator decision 写入 SHA 锚定的 append-only verdict 行', async () => {
    const response = await postCallback(app);

    expect(response.status).toBe(200);
    const verdictCall = mocks.pool.query.mock.calls.find(([sql]) => /verdict:evaluate/.test(sql));
    expect(verdictCall).toBeTruthy();
    expect(verdictCall[1].join(' ')).toContain('sha-1');
  });

  it('reviewer verdict 从服务端 TaskBundle 锚定 round/SHA，不接收 worker 自报 SHA', async () => {
    const contractSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValueOnce({
      ...attempt,
      role: 'reviewer',
      task_bundle: { inputs: { contract_round: 3, contract_sha: contractSha } },
    });
    const response = await postCallback(app, {
        ...validResult,
        decision: { outcome: 'APPROVED', reason: 'contract covers PRD', contract_sha: 'b'.repeat(40) },
      });

    expect(response.status).toBe(200);
    const verdictCall = mocks.pool.query.mock.calls.find(([sql]) => /verdict:reviewer/.test(sql));
    expect(verdictCall).toBeTruthy();
    expect(verdictCall[1].join(' ')).toContain('3');
    expect(verdictCall[1].join(' ')).toContain(contractSha);
    expect(verdictCall[1].join(' ')).not.toContain('b'.repeat(40));
  });

  it('generator-fix 未声明 SHA 时以 trigger SHA 写入已验证 callback', async () => {
    const triggerSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.complete.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'completed' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT r.pr_url')) {
        return { rows: [{ pr_url: 'https://github.com/acme/repo/pull/42', trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrHeadResolver', vi.fn(async () => triggerSha));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: ['Codex completed the requested fix.'],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(200);
    const callbackCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ));
    expect(callbackCalls).toHaveLength(1);
    const detail = JSON.parse(callbackCalls[0][1][6]);
    expect(detail).toMatchObject({
      verification_status: 'verified',
      pr_head_sha: triggerSha,
    });
  });

  it('generator-fix 未声明 SHA 且 resolver 失败时以 trigger SHA 写 pending callback', async () => {
    const triggerSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.complete.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'completed' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT r.pr_url')) {
        return { rows: [{ pr_url: 'https://github.com/acme/repo/pull/42', trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrHeadResolver', vi.fn(async () => { throw new Error('GitHub unavailable'); }));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: ['Codex completed the requested fix.'],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(200);
    const callbackCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ));
    expect(callbackCalls).toHaveLength(1);
    const detail = JSON.parse(callbackCalls[0][1][6]);
    expect(detail).toMatchObject({
      verification_status: 'verification_pending',
      pr_head_sha: triggerSha,
    });
    expect(detail.no_progress_reason).not.toBe('callback_sha_unverified');
  });

  it('generator-fix blocked 也是已收到的终态 callback，必须持久化供收敛回放', async () => {
    const triggerSha = 'a'.repeat(40);
    const advancedSha = 'b'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.complete.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'blocked' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT r.pr_url')) {
        return { rows: [{ pr_url: 'https://github.com/acme/repo/pull/42', trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrHeadResolver', vi.fn(async () => advancedSha));

    const response = await postCallback(app, {
      ...validResult,
      status: 'blocked',
      summary: 'contract environment unavailable',
      artifacts: [],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(200);
    const callbackCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ));
    expect(callbackCalls).toHaveLength(1);
    expect(JSON.parse(callbackCalls[0][1][6])).toMatchObject({
      status: 'blocked',
      verification_status: 'verified',
      pr_head_sha: advancedSha,
    });
  });

  it('跨角色/attempt session 复用冲突返回 409，且不完成 attempt', async () => {
    mocks.store.assertFreshRoleSession.mockRejectedValueOnce(new Error('role_session_reuse'));
    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/role_session_reuse/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('拒绝 callback 冒充另一个 provider', async () => {
    const response = await postCallback(app, {
        ...validResult,
        provider_metadata: { provider: 'claude', session_id: 'session-x' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/provider_mismatch/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('拒绝 attempt_id 不匹配或 schema 不完整的结果', async () => {
    const mismatch = await postCallback(app, {
      ...validResult,
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(mismatch.status).toBe(400);

    const invalid = await postCallback(app, { status: 'completed' });
    expect(invalid.status).toBe(400);
  });

  it('failed result 走 fail 终态，不伪装为 completed', async () => {
    const response = await postCallback(app, {
        ...validResult,
        status: 'failed',
        summary: 'provider process failed',
        decision: null,
        error: { code: 'provider_exit', message: 'exit 1' },
      });

    expect(response.status).toBe(200);
    expect(mocks.store.fail).toHaveBeenCalledWith(attemptId, {
      code: 'provider_exit',
      message: 'exit 1',
      status: 'failed',
      failureClass: 'runner_failure',
    }, { leaseOwner });
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('worker 用 lease owner 续租，跨设备 watchdog 不会误领活 attempt', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .send({ lease_owner: 'brain-1:123', lease_seconds: 180 });

    expect(response.status).toBe(200);
    expect(mocks.store.heartbeat).toHaveBeenCalledWith(attemptId, {
      leaseOwner: 'brain-1:123',
      leaseSeconds: 180,
    });
  });

  it('Fleet Worker 用 launch receipt 全绑定 HMAC 续租并拿签名 ACK', async () => {
    const heartbeatAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + 180_000).toISOString();
    mocks.store.persistFleetHeartbeat.mockResolvedValue({
      attempt: fleetAttempt(),
      receipt: {
        heartbeat_at: heartbeatAt,
        lease_expires_at: leaseExpiresAt,
      },
      deduped: false,
    });

    const response = await postFleetHeartbeat(app);

    expect(response.status).toBe(200);
    expect(mocks.store.persistFleetHeartbeat).toHaveBeenCalledWith({
      attemptId,
      runId,
      workerId: remoteMachineId,
      jobId: remoteJobId,
      leaseOwner,
      leaseGeneration: 2,
      heartbeatNonce: expect.any(String),
      requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      observedAt: expect.any(String),
      leaseSeconds: 180,
      providerSessionId: null,
    });
    expect(mocks.store.heartbeat).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      schema_version: 'fleet-attempt-heartbeat-ack/v1',
      attempt_id: attemptId,
      run_id: runId,
      worker_id: remoteMachineId,
      job_id: remoteJobId,
      lease_owner: leaseOwner,
      lease_generation: 2,
      provider_session_id: null,
      heartbeat_at: heartbeatAt,
      lease_expires_at: leaseExpiresAt,
    });
    expect(response.body.receipt_hmac).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Fleet heartbeat 首次观察 session 时以同一 generation 转 running', async () => {
    const response = await postFleetHeartbeat(app, {
      providerSessionId: 'thread-live',
    });

    expect(response.status).toBe(200);
    expect(mocks.store.persistFleetHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        runId,
        workerId: remoteMachineId,
        jobId: remoteJobId,
        leaseOwner,
        leaseGeneration: 2,
        providerSessionId: 'thread-live',
      }),
    );
    expect(mocks.store.markRunning).not.toHaveBeenCalled();
    expect(mocks.store.assertFreshRoleSession).not.toHaveBeenCalled();
  });

  it('Fleet heartbeat exact replay returns the same durable signed ACK', async () => {
    const heartbeatNonce = randomUUID();
    const observedAt = new Date().toISOString();
    const heartbeatAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + 180_000).toISOString();
    const durableReceipt = {
      heartbeat_at: heartbeatAt,
      lease_expires_at: leaseExpiresAt,
    };
    mocks.store.persistFleetHeartbeat
      .mockResolvedValueOnce({
        attempt: fleetAttempt(),
        receipt: durableReceipt,
        deduped: false,
      })
      .mockResolvedValueOnce({
        attempt: fleetAttempt({ status: 'completed' }),
        receipt: durableReceipt,
        deduped: true,
      });

    const first = await postFleetHeartbeat(app, { heartbeatNonce, observedAt });
    const retry = await postFleetHeartbeat(app, { heartbeatNonce, observedAt });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(mocks.store.persistFleetHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('Fleet heartbeat rejects altered reuse of a consumed nonce', async () => {
    const heartbeatNonce = randomUUID();
    const observedAt = new Date().toISOString();
    mocks.store.persistFleetHeartbeat.mockRejectedValueOnce(
      Object.assign(new Error('conflicting nonce payload'), {
        code: 'fleet_heartbeat_conflict',
      }),
    );

    const response = await postFleetHeartbeat(app, {
      heartbeatNonce,
      observedAt,
      leaseSeconds: 240,
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      error: 'fleet_heartbeat_conflict',
    });
  });

  it('Fleet heartbeat lets the durable store reject a new stale nonce', async () => {
    mocks.store.persistFleetHeartbeat.mockRejectedValueOnce(
      Object.assign(new Error('stale heartbeat'), {
        code: 'fleet_heartbeat_stale',
      }),
    );

    const response = await postFleetHeartbeat(app, {
      observedAt: '2026-07-27T01:00:00.000Z',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      error: 'fleet_heartbeat_stale',
    });
    expect(mocks.store.persistFleetHeartbeat).toHaveBeenCalledOnce();
  });

  it('Fleet attempt 的 heartbeat 不得降级为旧 Bearer token', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .send({ lease_owner: leaseOwner, lease_seconds: 180 });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('fleet_heartbeat_hmac_required');
    expect(mocks.store.heartbeat).not.toHaveBeenCalled();
  });

  it('heartbeat 同样拒绝无密钥请求', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .send({ lease_owner: leaseOwner, lease_seconds: 180 });
    expect(response.status).toBe(401);
    expect(mocks.store.heartbeat).not.toHaveBeenCalled();
  });

  it('worker 一拿到 provider session 就转 running 并持久化，崩溃后可原 session resume', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .send({
        lease_owner: 'brain-1:123',
        lease_seconds: 180,
        provider_session_id: 'thread-live',
      });

    expect(response.status).toBe(200);
    expect(mocks.store.markRunning).toHaveBeenCalledWith(attemptId, {
      leaseOwner: 'brain-1:123',
      providerSessionId: 'thread-live',
      leaseSeconds: 180,
    });
    expect(mocks.store.heartbeat).not.toHaveBeenCalled();
  });

  it('同一 attempt 的终态 callback 连续认证失败 10 次后返回 429，且不再访问 DB', async () => {
    const limitedAttemptId = '33333333-3333-4333-8333-333333333333';
    const responses = [];

    for (let requestNumber = 0; requestNumber < 11; requestNumber += 1) {
      responses.push(await request(app)
        .post(`/api/brain/harness/attempts/${limitedAttemptId}/callback`)
        .set('Authorization', 'Bearer wrong-secret')
        .set('X-Harness-Lease-Owner', leaseOwner)
        .send({}));
    }

    expect(responses.slice(0, 10).every(({ status }) => status === 401)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(mocks.store.getById).toHaveBeenCalledTimes(10);
  });

  it('同一 attempt 的 heartbeat 连续认证失败 30 次后返回 429，且不再访问 DB', async () => {
    const limitedAttemptId = '44444444-4444-4444-8444-444444444444';
    const responses = [];

    for (let requestNumber = 0; requestNumber < 31; requestNumber += 1) {
      responses.push(await request(app)
        .post(`/api/brain/harness/attempts/${limitedAttemptId}/heartbeat`)
        .send({ lease_owner: leaseOwner, lease_seconds: 180 }));
    }

    expect(responses.slice(0, 30).every(({ status }) => status === 401)).toBe(true);
    expect(responses[30].status).toBe(429);
    expect(mocks.store.getById).toHaveBeenCalledTimes(30);
  });
});
