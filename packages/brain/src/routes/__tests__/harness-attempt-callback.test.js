import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { signMachineAttestation } from '../../orchestrator/machine-attestation.js';

const mocks = vi.hoisted(() => ({
  store: {
    getById: vi.fn(),
    assertFreshRoleSession: vi.fn(),
    recordCallbackTerminal: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    heartbeat: vi.fn(),
    markRunning: vi.fn(),
  },
  pool: { query: vi.fn() },
  terminalize: vi.fn(),
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
  lease_generation: 0,
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

function postCallback(
  app,
  body = validResult,
  token = callbackToken,
  owner = leaseOwner,
  generation = 0,
) {
  let call = request(app)
    .post(`/api/brain/harness/attempts/${attemptId}/callback`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Harness-Lease-Owner', owner)
    .set('X-Harness-Lease-Generation', String(generation));
  return call.send(body);
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
    let callbackCount = 0;
    mocks.store.recordCallbackTerminal.mockImplementation(async ({ result }) => {
      callbackCount += 1;
      return {
        attempt: { ...attempt, status: result.status, result },
        deduped: callbackCount > 1,
      };
    });
    mocks.store.fail.mockResolvedValue({ attempt: { ...attempt, status: 'failed' }, deduped: false });
    mocks.store.heartbeat.mockResolvedValue({ ...attempt, heartbeat_at: new Date().toISOString() });
    mocks.store.markRunning.mockResolvedValue({ ...attempt, provider_session_id: 'thread-live' });
    mocks.terminalize.mockResolvedValue({
      status: 'cleaned',
      attempt_id: attemptId,
      actual_machine_id: remoteMachineId,
      attestation_status: 'verified',
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM initiative_runs r')) {
        return {
          rows: [{
            pr_url: null,
            task_id: attemptId,
            payload: { base_repo: 'https://github.com/acme/repo.git' },
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const { default: router } = await import('../harness-callback.js');
    app = express();
    app.set('kernelFleetBridgeToken', fleetSecret);
    app.set('kernelFleetTerminalizer', mocks.terminalize);
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('接受 machine attestation 与 launch receipt 一致的 xian callback', async () => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app, remoteResult());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, deduped: false });
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledOnce();
  });

  it('Fleet callback 在持久化终态前完成 Worker 清理并封存回执', async () => {
    const ownedAttempt = fleetAttempt({
      task_bundle: { inputs: { runtime_resources: { postgres: true } } },
    });
    mocks.store.getById.mockResolvedValue(ownedAttempt);
    mocks.terminalize.mockImplementationOnce(async () => {
      expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
      return {
        status: 'cleaned',
        attempt_id: attemptId,
        actual_machine_id: remoteMachineId,
        attestation_status: 'verified',
      };
    });

    const response = await postCallback(app, fleetResult());

    expect(response.status).toBe(200);
    expect(mocks.terminalize).toHaveBeenCalledWith(ownedAttempt);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          provider_metadata: expect.objectContaining({
            server_resource_cleanup_receipt: {
              status: 'cleaned',
              attempt_id: attemptId,
              actual_machine_id: remoteMachineId,
              attestation_status: 'verified',
            },
          }),
        }),
      }),
    );
  });

  it('Fleet 清理未完成时 callback 返回可重试错误且不写终态', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt({
      task_bundle: { inputs: { runtime_resources: { postgres: true } } },
    }));
    mocks.terminalize.mockResolvedValueOnce({
      status: 'quarantined',
      attempt_id: attemptId,
      actual_machine_id: remoteMachineId,
      attestation_status: 'verified',
    });

    const response = await postCallback(app, fleetResult());

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('fleet_resource_cleanup_incomplete');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it.each(['completed', 'completed_with_concerns'])(
    '只把服务端 Git 校验通过的 planner PRD artifact 写入 %s 终态 receipt',
    async (callbackStatus) => {
      const plannerBranch = `cp-harness-prd-${attemptId.slice(0, 8)}-a4`;
      const headSha = 'a'.repeat(40);
      mocks.store.getById.mockResolvedValue(fleetAttempt({
        role: 'planner',
        task_bundle: {
          expected_output: 'harness-result/planner-v1',
          inputs: {
            sprint_dir: 'sprints/kernel-real',
            planner_branch: plannerBranch,
            workspace_spec: {
              repo: 'perfectuser21/zenithjoy-workspace',
            },
          },
        },
      }));
      const resolveHead = vi.fn(async () => ({
        head_sha: headSha,
        path_exists: true,
      }));
      app.set('kernelGitBranchHeadResolver', resolveHead);

      const response = await postCallback(app, {
        ...fleetResult(),
        status: callbackStatus,
        artifacts: [{
          type: 'git_artifact',
          kind: 'planner_prd',
          path: 'sprints/kernel-real/sprint-prd.md',
          repo: 'perfectuser21/zenithjoy-workspace',
          branch: plannerBranch,
          head_sha: headSha,
          verification_status: 'verified',
        }],
      });

      expect(response.status).toBe(200);
      expect(resolveHead).toHaveBeenCalledWith({
        repo: 'perfectuser21/zenithjoy-workspace',
        branch: plannerBranch,
        path: 'sprints/kernel-real/sprint-prd.md',
      });
      expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            status: callbackStatus,
            artifacts: [{
              type: 'git_artifact',
              kind: 'planner_prd',
              path: 'sprints/kernel-real/sprint-prd.md',
              repo: 'perfectuser21/zenithjoy-workspace',
              branch: plannerBranch,
              head_sha: headSha,
              verification_status: 'verified',
            }],
            server_verification: {
              planner_git_artifact: {
                method: 'git_branch_head',
                artifact: {
                  path: 'sprints/kernel-real/sprint-prd.md',
                  repo: 'perfectuser21/zenithjoy-workspace',
                  branch: plannerBranch,
                  head_sha: headSha,
                },
              },
            },
          }),
        }),
      );
    },
  );

  it.each(['completed', 'completed_with_concerns'])(
    '拒绝 %s planner 自报 verified 但服务端分支 SHA 不匹配的假 artifact',
    async (callbackStatus) => {
      const plannerBranch = `cp-harness-prd-${attemptId.slice(0, 8)}-a4`;
      mocks.store.getById.mockResolvedValue(fleetAttempt({
        role: 'planner',
        task_bundle: {
          expected_output: 'harness-result/planner-v1',
          inputs: {
            sprint_dir: 'sprints/kernel-real',
            planner_branch: plannerBranch,
            workspace_spec: {
              repo: 'perfectuser21/zenithjoy-workspace',
            },
          },
        },
      }));
      app.set('kernelGitBranchHeadResolver', vi.fn(async () => ({
        head_sha: 'b'.repeat(40),
        path_exists: true,
      })));

      const response = await postCallback(app, {
        ...fleetResult(),
        status: callbackStatus,
        artifacts: [{
          type: 'git_artifact',
          kind: 'planner_prd',
          path: 'sprints/kernel-real/sprint-prd.md',
          repo: 'perfectuser21/zenithjoy-workspace',
          branch: plannerBranch,
          head_sha: 'a'.repeat(40),
          verification_status: 'verified',
        }],
      });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('planner_git_artifact_mismatch');
      expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
    },
  );

  it.each(['completed', 'completed_with_concerns'])(
    '拒绝 %s 分支存在但 PRD 路径不在该 commit 的 planner artifact',
    async (callbackStatus) => {
      const plannerBranch = `cp-harness-prd-${attemptId.slice(0, 8)}-a4`;
      const headSha = 'a'.repeat(40);
      mocks.store.getById.mockResolvedValue(fleetAttempt({
        role: 'planner',
        task_bundle: {
          expected_output: 'harness-result/planner-v1',
          inputs: {
            sprint_dir: 'sprints/kernel-real',
            planner_branch: plannerBranch,
            workspace_spec: {
              repo: 'perfectuser21/zenithjoy-workspace',
            },
          },
        },
      }));
      app.set('kernelGitBranchHeadResolver', vi.fn(async () => ({
        head_sha: headSha,
        path_exists: false,
      })));

      const response = await postCallback(app, {
        ...fleetResult(),
        status: callbackStatus,
        artifacts: [{
          type: 'git_artifact',
          kind: 'planner_prd',
          path: 'sprints/kernel-real/sprint-prd.md',
          repo: 'perfectuser21/zenithjoy-workspace',
          branch: plannerBranch,
          head_sha: headSha,
        }],
      });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('planner_git_artifact_path_missing');
      expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
    },
  );

  it('persists a valid Commander Directive as the terminal Attempt result', async () => {
    mocks.store.getById.mockResolvedValue(commanderAttempt());

    const response = await postCallback(app, commanderResult());

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        runId,
        leaseOwner,
        leaseGeneration: 0,
        result: expect.objectContaining({
        status: 'completed',
        decision: expect.objectContaining({
          schema: 'commander-directive/v1',
          run_id: runId,
          event_cursor: 5,
        }),
        }),
      }),
    );
    expect(mocks.pool.query.mock.calls.some(([sql]) => (
      sql.includes('commander.directive_proposed')
    ))).toBe(false);
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
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('接受已确认 Fleet Worker receipt 的 bounded credential callback', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult({
      credential_copy_mutated: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        runId,
        leaseOwner,
        leaseGeneration: 0,
        result: expect.objectContaining({
        provider_metadata: expect.objectContaining({
          credential_ref: credentialRef,
          credential_copy_mutated: true,
        }),
        }),
      }),
    );
  });

  it('接受严格成对的 Codex turn.completed 恢复收据', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult({
      cli_exit_code: 1,
      terminal_receipt: 'turn.completed',
    }));

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          provider_metadata: expect.objectContaining({
            cli_exit_code: 1,
            terminal_receipt: 'turn.completed',
          }),
        }),
      }),
    );
  });

  it.each([
    ['zero CLI exit', { cli_exit_code: 0, terminal_receipt: 'turn.completed' }],
    ['unknown receipt', { cli_exit_code: 1, terminal_receipt: 'agent_message' }],
    ['missing receipt pair', { cli_exit_code: 1 }],
  ])('拒绝 Fleet Codex 的无效终态恢复证据：%s', async (_case, metadata) => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult(metadata));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('credential_callback_invalid');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('拒绝 local Codex callback 缺半边的终态恢复证据', async () => {
    mocks.store.getById.mockResolvedValue(attempt);
    const response = await postCallback(app, {
      ...validResult,
      provider_metadata: { ...validResult.provider_metadata, cli_exit_code: 1 },
    });

    expect(response.status).toBe(409);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('拒绝非 Codex Provider 冒充 turn.completed 恢复收据', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, provider: 'claude' });
    const response = await postCallback(app, {
      ...validResult,
      provider_metadata: {
        provider: 'claude',
        session_id: 'claude-session',
        cli_exit_code: 1,
        terminal_receipt: 'turn.completed',
      },
    });

    expect(response.status).toBe(409);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it.each([
    ['missing credential ref', { credential_ref: undefined }],
    ['invalid credential ref', { credential_ref: 'not-a-uuid' }],
    ['non-boolean mutation evidence', { credential_copy_mutated: 'false' }],
    ['provider credential field', { access_token: 'must-not-persist' }],
  ])('拒绝 Fleet Codex callback 的 %s', async (_case, metadata) => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult(metadata));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('credential_callback_invalid');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('接受 Fleet Codex 在 Provider 启动前的结构化失败回调', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());
    const body = fleetResult({
      credential_ref: undefined,
      credential_copy_mutated: undefined,
    });
    body.status = 'failed';
    body.decision = null;
    body.error = {
      code: 'invalid_attempt_timeout',
      message: 'runner rejected the bounded attempt timeout',
    };

    const response = await postCallback(app, body);

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        result: expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: 'invalid_attempt_timeout',
          }),
        }),
      }),
    );
  });

  it('启动前失败豁免仍拒绝 Fleet Codex 未知 metadata 字段', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());
    const body = fleetResult({
      credential_ref: undefined,
      credential_copy_mutated: undefined,
      access_token: 'must-not-persist',
    });
    body.status = 'failed';
    body.decision = null;
    body.error = {
      code: 'invalid_attempt_timeout',
      message: 'runner rejected the bounded attempt timeout',
    };

    const response = await postCallback(app, body);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('credential_callback_invalid');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('仍拒绝缺少凭据证明的任意 Fleet Codex 失败回调', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());
    const body = fleetResult({
      credential_ref: undefined,
      credential_copy_mutated: undefined,
    });
    body.status = 'failed';
    body.decision = null;
    body.error = { code: 'provider_exit', message: 'untrusted failure' };

    const response = await postCallback(app, body);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('credential_callback_invalid');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
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
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
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
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
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
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('local receipt 无 remote attestation 时仍可完成 callback', async () => {
    mocks.store.getById.mockResolvedValue(attempt);

    const response = await postCallback(app);

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledOnce();
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
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('remote receipt 无 machine attestation 时拒绝 callback', async () => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('machine_attestation_mismatch');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('重复的 verified xian callback 保持幂等', async () => {
    const claimDigest = 'sha256:verified-xian-claim';
    app.set('kernelCallbackClaimDigest', () => claimDigest);
    const runningAttempt = remoteAttempt();
    const completedAttempt = {
      ...runningAttempt,
      status: 'completed',
      result: {
        ...remoteResult(),
        provider_metadata: {
          ...remoteResult().provider_metadata,
          server_callback_claim_digest: claimDigest,
        },
      },
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
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ ok: true, deduped: true });
  });

  it('校验、完成 attempt，并让重复 callback 幂等返回 deduped', async () => {
    const claimDigest = 'sha256:evaluator-claim';
    app.set('kernelCallbackClaimDigest', () => claimDigest);
    const completedAttempt = {
      ...attempt,
      status: 'completed',
      result: {
        ...validResult,
        provider_metadata: {
          ...validResult.provider_metadata,
          server_callback_claim_digest: claimDigest,
        },
      },
    };
    mocks.store.getById
      .mockReset()
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce(completedAttempt)
      .mockResolvedValueOnce(completedAttempt);
    const first = await postCallback(app);
    const second = await postCallback(app);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, deduped: false });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
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
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:reviewer/.test(sql))).toBe(false);
  });

  it('终态 callback 的 lease_owner 不匹配时返回 409', async () => {
    const response = await postCallback(app, validResult, callbackToken, 'other-owner');
    expect(response.status).toBe(409);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('R11: 缺失或非法 lease generation 时拒绝 callback', async () => {
    const missing = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .set('X-Harness-Lease-Owner', leaseOwner)
      .send(validResult);
    const malformed = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .set('X-Harness-Lease-Owner', leaseOwner)
      .set('X-Harness-Lease-Generation', 'generation-zero')
      .send(validResult);

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('R11: 旧 lease generation callback 返回 409 且不写终态', async () => {
    const response = await postCallback(app, validResult, callbackToken, leaseOwner, 1);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/generation/i);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('认证后发生换租时拒绝旧 worker，且不得追加 evaluator verdict', async () => {
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
      attempt: null,
      deduped: false,
      conflict: 'lease_owner_mismatch',
    });
    mocks.store.getById
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce({ ...attempt, status: 'starting', lease_owner: 'brain-2:456' });

    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/lease/i);
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:evaluate/.test(sql))).toBe(false);
  });

  it('evaluator decision 交给 Attempt Store 与 callback 原子写入', async () => {
    const response = await postCallback(app);

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          decision: expect.objectContaining({ outcome: 'PASS' }),
        }),
      }),
    );
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:evaluate/.test(sql))).toBe(false);
  });

  it('reviewer verdict 只把 worker outcome 交给 Store，锚点由锁行后的 TaskBundle 生成', async () => {
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
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          decision: expect.objectContaining({
            outcome: 'APPROVED',
            contract_sha: 'b'.repeat(40),
          }),
        }),
      }),
    );
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:reviewer/.test(sql))).toBe(false);
  });

  it('generator-fix 未声明 SHA 时把服务端验证后的 PR 证据交给原子 Store', async () => {
    const triggerSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'completed' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM initiative_runs r')) {
        return {
          rows: [{
            pr_url: 'https://github.com/acme/repo/pull/42',
            task_id: attemptId,
            payload: { base_repo: 'https://github.com/acme/repo.git' },
          }],
        };
      }
      if (sql.includes("action='spawn:generator-fix'")) {
        return { rows: [{ trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrIdentityResolver', vi.fn(async () => ({
      head_sha: triggerSha,
      head_ref: `cp-fix-${attemptId.slice(0, 8)}`,
    })));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: ['Codex completed the requested fix.'],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: 'pull_request',
              head_sha: triggerSha,
              verification_status: 'verified',
              source: 'server_observed',
            }),
          ]),
        }),
      }),
    );
    expect(mocks.pool.query.mock.calls.some(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ))).toBe(false);
  });

  it('generator-fix 未声明 SHA 且 resolver 失败时保持 callback 可重试', async () => {
    const triggerSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'completed' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM initiative_runs r')) {
        return {
          rows: [{
            pr_url: 'https://github.com/acme/repo/pull/42',
            task_id: attemptId,
            payload: { base_repo: 'https://github.com/acme/repo.git' },
          }],
        };
      }
      if (sql.includes("action='spawn:generator-fix'")) {
        return { rows: [{ trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrIdentityResolver', vi.fn(async () => {
      throw new Error('GitHub unavailable');
    }));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: ['Codex completed the requested fix.'],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('pull_request_verification_unavailable');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('generator-fix blocked 只由标准 callback 供收敛回放，不得伪造成功 SHA verdict', async () => {
    const triggerSha = 'a'.repeat(40);
    const advancedSha = 'b'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
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
    expect(callbackCalls).toHaveLength(0);
    expect(app.get('kernelPrHeadResolver')).not.toHaveBeenCalled();
  });

  it('generator-fix needs_context 不得写 no-progress callback verdict', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'needs_context' },
      deduped: false,
    });

    const response = await postCallback(app, {
      ...validResult,
      status: 'needs_context',
      summary: 'Owner answer required.',
      artifacts: [],
      checks: [],
      decision: { outcome: 'needs_context', reason: 'Choose the release policy.' },
    });

    expect(response.status).toBe(200);
    expect(mocks.pool.query.mock.calls.some(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ))).toBe(false);
  });

  it('未验证的 generator PR claim 不得污染 authoritative pr_url', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    const resolveHead = vi.fn(async () => null);
    app.set('kernelPrIdentityResolver', vi.fn(async () => ({
      head_sha: await resolveHead(),
      head_ref: `cp-fix-${attemptId.slice(0, 8)}`,
    })));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/acme/repo/pull/404',
      }],
      decision: null,
    });

    expect(response.status).toBe(200);
    expect(resolveHead).toHaveBeenCalledOnce();
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          artifacts: [
            expect.objectContaining({
              type: 'unverified_pull_request_claim',
              url: 'https://github.com/acme/repo/pull/404',
            }),
          ],
        }),
      }),
    );
    expect(mocks.pool.query.mock.calls.some(([sql]) => (
      /UPDATE initiative_runs SET pr_url/i.test(sql)
    ))).toBe(false);
  });

  it('另一个仓库里的真实 PR 也不能成为本 task 的权威 PR', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.pool.query.mockResolvedValueOnce({
      rows: [{
        pr_url: null,
        task_id: attemptId,
        payload: { base_repo: 'perfectuser21/cecelia' },
      }],
    });
    const resolveIdentity = vi.fn(async () => ({
      head_sha: 'a'.repeat(40),
      head_ref: `cp-fix-${attemptId.slice(0, 8)}`,
    }));
    app.set('kernelPrIdentityResolver', resolveIdentity);

    const response = await postCallback(app, {
      ...validResult,
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/attacker/other-repo/pull/42',
      }],
      decision: null,
    });

    expect(response.status).toBe(200);
    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          artifacts: [
            expect.objectContaining({
              type: 'unverified_pull_request_claim',
              verification_status: 'repository_mismatch',
            }),
          ],
        }),
      }),
    );
  });

  it('同仓库但不属于 task short-id 的分支不能成为权威 PR', async () => {
    const authoritativeBranch = `cp-fleet-generator-${attemptId.slice(0, 8)}`;
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role: 'generator',
      task_bundle: {
        inputs: {
          workspace_spec: {
            repo: 'perfectuser21/cecelia',
            branch: authoritativeBranch,
          },
        },
      },
    });
    mocks.pool.query.mockResolvedValueOnce({
      rows: [{
        pr_url: null,
        task_id: '33333333-3333-4333-8333-333333333333',
        payload: { base_repo: 'perfectuser21/cecelia' },
      }],
    });
    app.set('kernelPrIdentityResolver', vi.fn(async () => ({
      head_sha: 'a'.repeat(40),
      head_ref: 'cp-unrelated-task',
    })));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/perfectuser21/cecelia/pull/42',
      }],
      decision: null,
    });

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          artifacts: [
            expect.objectContaining({
              type: 'unverified_pull_request_claim',
              verification_status: 'branch_mismatch',
            }),
          ],
        }),
      }),
    );
  });

  it('Fleet 默认分支以签发的 workspace_spec 为准，不要求包含 task short-id', async () => {
    const authoritativeBranch = `cp-fleet-generator-${attemptId.slice(0, 8)}`;
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role: 'generator',
      task_bundle: {
        inputs: {
          workspace_spec: {
            repo: 'perfectuser21/cecelia',
            branch: authoritativeBranch,
          },
        },
      },
    });
    mocks.pool.query.mockResolvedValueOnce({
      rows: [{
        pr_url: null,
        task_id: '33333333-3333-4333-8333-333333333333',
        payload: {},
      }],
    });
    app.set('kernelPrIdentityResolver', vi.fn(async () => ({
      head_sha: 'a'.repeat(40),
      head_ref: authoritativeBranch,
    })));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/perfectuser21/cecelia/pull/42',
      }],
      decision: null,
    });

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          artifacts: [
            expect.objectContaining({
              type: 'pull_request',
              head_ref: authoritativeBranch,
              verification_status: 'verified',
            }),
          ],
        }),
      }),
    );
  });

  describe('Generator 字符串 artifact 里的 PR URL', () => {
    const generatorBranch = `cp-fleet-generator-${attemptId.slice(0, 8)}`;
    const prUrl = 'https://github.com/perfectuser21/zenithjoy-workspace/pull/1578';

    function stubGeneratorAttempt() {
      mocks.store.getById.mockResolvedValue({
        ...attempt,
        role: 'generator',
        task_bundle: {
          inputs: {
            workspace_spec: {
              repo: 'perfectuser21/zenithjoy-workspace',
              branch: generatorBranch,
            },
          },
        },
      });
      mocks.pool.query.mockImplementation(async (sql) => {
        if (String(sql).includes('FROM initiative_runs r')) {
          return {
            rows: [{
              pr_url: null,
              task_id: attemptId,
              payload: { base_repo: 'perfectuser21/zenithjoy-workspace' },
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      });
    }

    function generatorCallback(artifacts) {
      return postCallback(app, { ...validResult, artifacts, decision: null });
    }

    // 生产 run a75ccbbf：Generator 用字符串数组回报了真实 PR #1578，Brain 只认结构化
    // artifact，pr_url 没被投影，状态机误判 no_pr。字符串必须被候选化并走同一条服务端校验。
    it('合法字符串 PR URL 经服务端校验后规范化为结构化 verified artifact', async () => {
      const headSha = 'c'.repeat(40);
      stubGeneratorAttempt();
      const resolveIdentity = vi.fn(async () => ({
        head_sha: headSha,
        head_ref: generatorBranch,
      }));
      app.set('kernelPrIdentityResolver', resolveIdentity);

      const response = await generatorCallback([
        prUrl,
        'Red commit: 5c7a7740',
        'Green commit: 7629efe6',
      ]);

      expect(response.status).toBe(200);
      expect(resolveIdentity).toHaveBeenCalledWith(prUrl);
      expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            artifacts: [
              {
                type: 'pull_request',
                url: prUrl,
                head_sha: headSha,
                head_ref: generatorBranch,
                verification_status: 'verified',
                normalized_from: 'string_artifact',
              },
              'Red commit: 5c7a7740',
              'Green commit: 7629efe6',
            ],
          }),
        }),
      );
    });

    it('别的仓库的字符串 PR URL 不能成为本 run 的权威 PR', async () => {
      stubGeneratorAttempt();
      const resolveIdentity = vi.fn(async () => ({
        head_sha: 'c'.repeat(40),
        head_ref: generatorBranch,
      }));
      app.set('kernelPrIdentityResolver', resolveIdentity);

      const response = await generatorCallback([
        'https://github.com/attacker/other-repo/pull/1578',
      ]);

      expect(response.status).toBe(200);
      expect(resolveIdentity).not.toHaveBeenCalled();
      expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            artifacts: [{
              type: 'unverified_pull_request_claim',
              url: 'https://github.com/attacker/other-repo/pull/1578',
              verification_status: 'repository_mismatch',
              normalized_from: 'string_artifact',
            }],
          }),
        }),
      );
    });

    it('同仓库但分支对不上的字符串 PR URL fail closed', async () => {
      stubGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: 'c'.repeat(40),
        head_ref: 'cp-unrelated-task',
      })));

      const response = await generatorCallback([prUrl]);

      expect(response.status).toBe(200);
      expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            artifacts: [{
              type: 'unverified_pull_request_claim',
              url: prUrl,
              verification_status: 'branch_mismatch',
              normalized_from: 'string_artifact',
            }],
          }),
        }),
      );
    });

    it('形状不合法的字符串 PR URL 不做任何猜测式改写', async () => {
      stubGeneratorAttempt();
      const resolveIdentity = vi.fn();
      app.set('kernelPrIdentityResolver', resolveIdentity);

      const response = await generatorCallback([
        `${prUrl}?diff=split`,
        'Red commit: 5c7a7740',
      ]);

      expect(response.status).toBe(200);
      expect(resolveIdentity).not.toHaveBeenCalled();
      expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            artifacts: [
              {
                type: 'unverified_pull_request_claim',
                url: `${prUrl}?diff=split`,
                verification_status: 'invalid_url',
                normalized_from: 'string_artifact',
              },
              'Red commit: 5c7a7740',
            ],
          }),
        }),
      );
    });

    it('字符串 PR URL 的校验不可用时整条 callback 保持可重试', async () => {
      stubGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => {
        throw new Error('GitHub unavailable');
      }));

      const response = await generatorCallback([prUrl]);

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('pull_request_verification_unavailable');
      expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
    });
  });

  // 生产 run d9785137 / Attempt 3aa00156：任务 payload.base_sha=0dc4e3c0 是盲测冻结
  // 基线，Generator 却把工作区 rebase 到已含对照候选 #1577 的 main。服务端当时只校验
  // repo/branch/head 存在，于是被污染的 PR 仍被投影成 verified。
  describe('冻结基线 lineage 服务端校验', () => {
    const generatorBranch = `cp-fleet-generator-${attemptId.slice(0, 8)}`;
    const prUrl = 'https://github.com/perfectuser21/zenithjoy-workspace/pull/1578';
    const frozenStartSha = '0dc4e3c07ff19a0ac95440723986bf3cb78580b2';
    // main after One-session #1577 merged — a descendant of the frozen baseline.
    const movedMainSha = '676fed7de12023d355deac7849af8a525ae53f8d';
    const contaminatedHeadSha = 'b'.repeat(40);
    const cleanHeadSha = '7629efe6cef4817a3498b8c10a8b2f8cfd9f31f8';

    function stubFrozenGeneratorAttempt(frozen = true) {
      mocks.store.getById.mockResolvedValue({
        ...attempt,
        role: 'generator',
        task_bundle: {
          inputs: {
            workspace_spec: {
              repo: 'perfectuser21/zenithjoy-workspace',
              branch: generatorBranch,
              base_sha: frozenStartSha,
              expected_head_sha: null,
              frozen_baseline: frozen,
            },
          },
        },
      });
      mocks.pool.query.mockImplementation(async (sql) => {
        if (String(sql).includes('FROM initiative_runs r')) {
          return {
            rows: [{
              pr_url: null,
              task_id: attemptId,
              payload: { base_repo: 'perfectuser21/zenithjoy-workspace' },
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      });
    }

    function generatorCallback() {
      return postCallback(app, {
        ...validResult,
        artifacts: [{ type: 'pull_request', url: prUrl }],
        decision: null,
      });
    }

    // 关键：rebase 到 676fed7d 之后 0dc4e3c0 依然是 HEAD 的祖先——单看祖先关系
    // 一个字都拦不住。真正变的是 head 相对 main 的分叉点从 0dc4e3c0 前进到了
    // 676fed7d，也就是对照候选的内容被整体搬了进来。
    it('冻结任务 rebase 到已含对照候选的 main 时 fail closed，不投影 PR', async () => {
      stubFrozenGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: contaminatedHeadSha,
        head_ref: generatorBranch,
      })));
      const resolveLineage = vi.fn(async ({ base }) => (
        base === 'main'
          // 分叉点已越过冻结基线
          ? { is_ancestor: true, merge_base_sha: movedMainSha }
          : base === movedMainSha
            // movedMainSha 不是 start SHA 的祖先（它是后代）
            ? { is_ancestor: false, merge_base_sha: frozenStartSha }
            : { is_ancestor: true, merge_base_sha: frozenStartSha }
      ));
      app.set('kernelCommitLineageResolver', resolveLineage);

      const response = await generatorCallback();

      expect(response.status).toBe(200);
      expect(resolveLineage).toHaveBeenCalledWith({
        repo: 'perfectuser21/zenithjoy-workspace',
        base: frozenStartSha,
        head: contaminatedHeadSha,
      });
      expect(resolveLineage).toHaveBeenCalledWith({
        repo: 'perfectuser21/zenithjoy-workspace',
        base: 'main',
        head: contaminatedHeadSha,
      });
      const [[recorded]] = mocks.store.recordCallbackTerminal.mock.calls;
      expect(recorded.result.artifacts).toEqual([
        expect.objectContaining({
          type: 'unverified_pull_request_claim',
          verification_status: 'frozen_baseline_violation',
        }),
      ]);
      expect(recorded.result.artifacts).not.toContainEqual(
        expect.objectContaining({ type: 'pull_request' }),
      );
    });

    it('冻结任务 HEAD 完全脱离 start SHA 血统时同样 fail closed', async () => {
      stubFrozenGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: contaminatedHeadSha,
        head_ref: generatorBranch,
      })));
      app.set('kernelCommitLineageResolver', vi.fn(async () => ({
        is_ancestor: false,
        merge_base_sha: frozenStartSha,
      })));

      const response = await generatorCallback();

      expect(response.status).toBe(200);
      const [[recorded]] = mocks.store.recordCallbackTerminal.mock.calls;
      expect(recorded.result.artifacts).toEqual([
        expect.objectContaining({
          type: 'unverified_pull_request_claim',
          verification_status: 'frozen_baseline_violation',
        }),
      ]);
    });

    it('合法地在 start SHA 之上追加提交的冻结 PR 仍被投影为 verified', async () => {
      stubFrozenGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: cleanHeadSha,
        head_ref: generatorBranch,
      })));
      // main 已经前进，但本 Attempt 没同步：分叉点仍是冻结基线本身。
      app.set('kernelCommitLineageResolver', vi.fn(async () => ({
        is_ancestor: true,
        merge_base_sha: frozenStartSha,
      })));

      const response = await generatorCallback();

      expect(response.status).toBe(200);
      const [[recorded]] = mocks.store.recordCallbackTerminal.mock.calls;
      expect(recorded.result.artifacts).toEqual([
        expect.objectContaining({
          type: 'pull_request',
          head_sha: cleanHeadSha,
          verification_status: 'verified',
        }),
      ]);
    });

    // generator-fix 从 PR head 续跑时，冻结基线本身不在 main 上，分叉点合法地
    // 早于 start SHA —— 这不是污染，不能误杀。
    it('分叉点早于冻结基线（generator-fix 续跑 PR head）不算违规', async () => {
      const earlierForkSha = 'a'.repeat(40);
      stubFrozenGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: cleanHeadSha,
        head_ref: generatorBranch,
      })));
      app.set('kernelCommitLineageResolver', vi.fn(async ({ base }) => (
        base === 'main'
          ? { is_ancestor: true, merge_base_sha: earlierForkSha }
          : { is_ancestor: true, merge_base_sha: earlierForkSha }
      )));

      const response = await generatorCallback();

      expect(response.status).toBe(200);
      const [[recorded]] = mocks.store.recordCallbackTerminal.mock.calls;
      expect(recorded.result.artifacts).toEqual([
        expect.objectContaining({
          type: 'pull_request',
          verification_status: 'verified',
        }),
      ]);
    });

    it('普通 dev（未冻结）不查血统，行为零回归', async () => {
      stubFrozenGeneratorAttempt(false);
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: contaminatedHeadSha,
        head_ref: generatorBranch,
      })));
      const resolveLineage = vi.fn(async () => ({
        is_ancestor: false,
        merge_base_sha: null,
      }));
      app.set('kernelCommitLineageResolver', resolveLineage);

      const response = await generatorCallback();

      expect(response.status).toBe(200);
      expect(resolveLineage).not.toHaveBeenCalled();
      const [[recorded]] = mocks.store.recordCallbackTerminal.mock.calls;
      expect(recorded.result.artifacts).toEqual([
        expect.objectContaining({
          type: 'pull_request',
          verification_status: 'verified',
        }),
      ]);
    });

    it('血统校验不可用时整条 callback 保持可重试，绝不放行', async () => {
      stubFrozenGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: cleanHeadSha,
        head_ref: generatorBranch,
      })));
      app.set('kernelCommitLineageResolver', vi.fn(async () => {
        throw new Error('GitHub compare unavailable');
      }));

      const response = await generatorCallback();

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('pull_request_verification_unavailable');
      expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
    });

    it('分叉点不可解析时不得投影 PR', async () => {
      stubFrozenGeneratorAttempt();
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: cleanHeadSha,
        head_ref: generatorBranch,
      })));
      app.set('kernelCommitLineageResolver', vi.fn(async () => ({
        is_ancestor: true,
        merge_base_sha: null,
      })));

      const response = await generatorCallback();

      expect(response.status).toBe(200);
      const [[recorded]] = mocks.store.recordCallbackTerminal.mock.calls;
      expect(recorded.result.artifacts).toEqual([
        expect.objectContaining({
          type: 'unverified_pull_request_claim',
          verification_status: 'frozen_baseline_unverifiable',
        }),
      ]);
    });

    it('冻结任务缺少可观测 start SHA 时不得投影 PR', async () => {
      mocks.store.getById.mockResolvedValue({
        ...attempt,
        role: 'generator',
        task_bundle: {
          inputs: {
            workspace_spec: {
              repo: 'perfectuser21/zenithjoy-workspace',
              branch: generatorBranch,
              base_sha: null,
              expected_head_sha: null,
              frozen_baseline: true,
            },
          },
        },
      });
      mocks.pool.query.mockImplementation(async (sql) => {
        if (String(sql).includes('FROM initiative_runs r')) {
          return {
            rows: [{
              pr_url: null,
              task_id: attemptId,
              payload: { base_repo: 'perfectuser21/zenithjoy-workspace' },
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      });
      app.set('kernelPrIdentityResolver', vi.fn(async () => ({
        head_sha: cleanHeadSha,
        head_ref: generatorBranch,
      })));
      app.set('kernelCommitLineageResolver', vi.fn(async () => ({ is_ancestor: true })));

      const response = await generatorCallback();

      expect(response.status).toBe(200);
      const [[recorded]] = mocks.store.recordCallbackTerminal.mock.calls;
      expect(recorded.result.artifacts).toEqual([
        expect.objectContaining({
          type: 'unverified_pull_request_claim',
          verification_status: 'frozen_baseline_unverifiable',
        }),
      ]);
    });
  });

  it('相同原始 callback 重放不再查询变化中的 GitHub head', async () => {
    const claimDigest = 'sha256:terminal-claim';
    const terminalAttempt = {
      ...attempt,
      role: 'generator',
      status: 'completed',
      result: {
        ...validResult,
        decision: null,
        provider_metadata: {
          ...validResult.provider_metadata,
          server_callback_claim_digest: claimDigest,
        },
      },
    };
    mocks.store.getById.mockResolvedValue(terminalAttempt);
    const resolver = vi.fn(async () => {
      throw new Error('GitHub unavailable after first commit');
    });
    app.set('kernelPrIdentityResolver', resolver);
    app.set('kernelCallbackClaimDigest', () => claimDigest);

    const response = await postCallback(app, {
      ...validResult,
      decision: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.deduped).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('终态 Attempt 的不同原始 callback 仍 fail closed', async () => {
    const terminalAttempt = {
      ...attempt,
      status: 'completed',
      result: {
        ...validResult,
        provider_metadata: {
          ...validResult.provider_metadata,
          server_callback_claim_digest: 'sha256:original',
        },
      },
    };
    mocks.store.getById.mockResolvedValue(terminalAttempt);
    app.set('kernelCallbackClaimDigest', () => 'sha256:changed');
    const resolver = vi.fn();
    app.set('kernelPrIdentityResolver', resolver);

    const response = await postCallback(app, {
      ...validResult,
      summary: 'conflicting retry payload',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('terminal_payload_conflict');
    expect(resolver).not.toHaveBeenCalled();
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('PR verification infrastructure failure keeps callback retryable', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    app.set('kernelPrIdentityResolver', vi.fn(async () => {
      throw new Error('GitHub unavailable');
    }));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/acme/repo/pull/42',
      }],
      decision: null,
    });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('pull_request_verification_unavailable');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('跨角色/attempt session 复用冲突返回 409，且不完成 attempt', async () => {
    mocks.store.assertFreshRoleSession.mockRejectedValueOnce(new Error('role_session_reuse'));
    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/role_session_reuse/);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('拒绝 callback 冒充另一个 provider', async () => {
    const response = await postCallback(app, {
        ...validResult,
        provider_metadata: { provider: 'claude', session_id: 'session-x' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/provider_mismatch/);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
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

  it('failed result 走统一 callback 终态事务，不伪装为 completed', async () => {
    const response = await postCallback(app, {
        ...validResult,
        status: 'failed',
        summary: 'provider process failed',
        decision: null,
        error: { code: 'provider_exit', message: 'exit 1' },
      });

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith({
      attemptId,
      runId,
      leaseOwner,
      leaseGeneration: 0,
      result: expect.objectContaining({
        status: 'failed',
        failure_class: 'runner_failure',
        error: { code: 'provider_exit', message: 'exit 1' },
      }),
    });
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
