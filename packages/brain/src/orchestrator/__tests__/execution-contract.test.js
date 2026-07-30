import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as executionContract from '../execution-contract.js';
import {
  parseTaskBundle,
  parseHarnessResult,
  computeRoleResultRawSha256,
  toKernelStatus,
  TASK_CONTRACT_VERSION,
  RESULT_CONTRACT_VERSION,
  ROLE_VALUES,
} from '../execution-contract.js';

const require = createRequire(import.meta.url);
const { finalizeRoleResult } = require(
  '../../../../../docker/cecelia-runner/result-channel-finalizer.cjs',
);

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const RESULT_CHANNEL_PATH = `/tmp/cecelia-prompts/${ATTEMPT_ID}.result.json`;

function validResultChannel(overrides = {}) {
  return {
    version: 'attempt-result-file/v1',
    path: RESULT_CHANNEL_PATH,
    max_bytes: 1024 * 1024,
    bindings: {
      task_id: TASK_ID,
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      role: 'planner',
    },
    ...overrides,
  };
}

function validWorkspaceSpec(overrides = {}) {
  return {
    repo: 'perfectuser21/cecelia',
    base_sha: BASE_SHA,
    branch: 'cp-07272050-fleet-worker-workspace-4b',
    expected_head_sha: null,
    mode: 'read-write',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    ...overrides,
  };
}

function validGithubMutationPolicy(overrides = {}) {
  return {
    version: 'github-mutation/v1',
    repo: 'perfectuser21/cecelia',
    branch: 'cp-07272050-fleet-worker-workspace-4b',
    base_sha: BASE_SHA,
    expected_remote_sha: null,
    operation: 'push-and-create-draft',
    pr_base: 'main',
    pr_title: `feat(harness): ${TASK_ID}`,
    pr_body: `Kernel task ${TASK_ID}\nRun ${RUN_ID}\n`,
    allowed_paths: ['packages/', 'sprints/'],
    ...overrides,
  };
}

function validGithubReadPolicy(overrides = {}) {
  return {
    version: 'github-read/v1',
    repo: 'perfectuser21/cecelia',
    url: 'https://github.com/perfectuser21/cecelia/pull/4391',
    number: 4391,
    head_ref: 'cp-07280905-result-channel',
    head_sha: BASE_SHA,
    allowed_states: ['OPEN'],
    ...overrides,
  };
}

function validBundle(overrides = {}) {
  return {
    contract_version: '1.0',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    hop: 1,
    phase: 'planning',
    role: 'planner',
    objective: 'Create the sprint requirements artifact.',
    skill: {
      name: 'harness-planner',
      version: '2.9.0',
      digest: `sha256:${'a'.repeat(64)}`,
      content: 'Provider-neutral planner instructions.',
    },
    inputs: {
      task_id: TASK_ID,
      sprint_dir: 'sprints/07210000-example',
      worktree_path: '/workspace',
      artifacts: [],
    },
    constraints: {
      read_only: false,
      fresh_session: true,
      timeout_seconds: 1800,
    },
    expected_output: 'harness-result/planner-v1',
    ...overrides,
  };
}

function validResult(overrides = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'Artifact created.',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: {
      provider: 'codex',
      session_id: 'thread-1',
    },
    ...overrides,
  };
}

function validCommanderBundle(overrides = {}) {
  return {
    schema: 'commander-bundle/v1',
    run_id: RUN_ID,
    commander_attempt_id: ATTEMPT_ID,
    event_cursor: 0,
    run_profile: { commander_mode: 'hybrid' },
    objective: { goal: 'Adjudicate the next Kernel boundary.' },
    observed: { phase: 'planning' },
    history_summary: {},
    new_events: [],
    actor_messages: [],
    active_risks: [],
    budgets: { remaining_attempts: 2 },
    allowed_actions: ['continue_default'],
    output_schema: 'commander-directive/v1',
    ...overrides,
  };
}

function validCommanderTask(overrides = {}) {
  return validBundle({
    role: 'commander',
    skill: null,
    inputs: {
      task_id: '33333333-3333-4333-8333-333333333333',
      sprint_dir: 'sprints/07280945-commander-phase2',
      worktree_path: '/workspace',
      commander_bundle: validCommanderBundle(),
      artifacts: [],
    },
    constraints: {
      read_only: true,
      fresh_session: true,
      timeout_seconds: 600,
    },
    expected_output: 'commander-directive/v1',
    ...overrides,
  });
}

function validCommanderDirective(overrides = {}) {
  return {
    schema: 'commander-directive/v1',
    run_id: RUN_ID,
    event_cursor: 0,
    action: 'continue_default',
    reason: 'The current Kernel decision remains within all fences.',
    evidence_refs: ['event:1'],
    ...overrides,
  };
}

function withRoleDigest(roleResult) {
  return {
    ...roleResult,
    raw_sha256: computeRoleResultRawSha256(roleResult.claimed),
  };
}

function verifiedPullRequest(overrides = {}) {
  return {
    type: 'pull_request',
    url: 'https://github.com/perfectuser21/cecelia/pull/4391',
    number: 4391,
    head_ref: 'cp-07280905-result-channel',
    head_sha: BASE_SHA,
    state: 'OPEN',
    ...overrides,
  };
}

describe('TaskBundle contract', () => {
  it('accepts the provider-neutral v1 bundle', () => {
    expect(parseTaskBundle(validBundle())).toMatchObject({
      contract_version: TASK_CONTRACT_VERSION,
      role: 'planner',
    });
  });

  it('requires a bounded exact verification_commands array for evaluator bundles', () => {
    const evaluator = validBundle({
      role: 'evaluator',
      expected_output: 'harness-result/evaluator-v1',
      inputs: {
        ...validBundle().inputs,
        verification_commands: ['npm test', 'bash scripts/smoke.sh'],
      },
    });
    expect(parseTaskBundle(evaluator).inputs.verification_commands)
      .toEqual(['npm test', 'bash scripts/smoke.sh']);

    for (const verificationCommands of [
      undefined,
      [],
      Array.from({ length: 17 }, (_, index) => `echo ${index}`),
      [''],
      [' npm test'],
      [`echo ${'x'.repeat(8192)}`],
    ]) {
      const invalid = structuredClone(evaluator);
      invalid.inputs.verification_commands = verificationCommands;
      expect(() => parseTaskBundle(invalid)).toThrow(/verification_commands/);
    }
  });

  it('accepts a skill-free read-only canary bundle', () => {
    expect(parseTaskBundle(validBundle({
      role: 'reporter',
      skill: null,
      constraints: { read_only: true, fresh_session: true, timeout_seconds: 600 },
      expected_output: 'harness-result/canary-v1',
    }))).toMatchObject({ role: 'reporter', skill: null });
  });

  it.each([
    '调用 Skill(foo)',
    'Use the Task tool to delegate',
    'Call spawn_agent for the reviewer',
  ])('rejects provider-native objective: %s', (objective) => {
    expect(() => parseTaskBundle(validBundle({ objective })))
      .toThrow(/provider_native_instruction/);
  });

  it('does not scan Skill content because legacy Skills are frozen verbatim', () => {
    const bundle = validBundle({
      skill: { ...validBundle().skill, content: 'Legacy text may mention Skill(foo).' },
    });
    expect(parseTaskBundle(bundle).skill.content).toContain('Skill(foo)');
  });

  it('accepts a path-free bundle carrying a canonical WorkspaceSpec', () => {
    const bundle = validBundle();
    delete bundle.inputs.worktree_path;
    bundle.inputs.execution_surface = 'fleet-worker';
    bundle.inputs.workspace_spec = validWorkspaceSpec();
    bundle.result_channel = validResultChannel();

    expect(parseTaskBundle(bundle).inputs.workspace_spec).toEqual(validWorkspaceSpec());
  });

  it('exports a builder that freezes the exact Attempt-owned result descriptor', () => {
    expect(executionContract.buildResultChannelDescriptor).toBeTypeOf('function');

    const descriptor = executionContract.buildResultChannelDescriptor({
      taskId: TASK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      role: 'planner',
    });

    expect(descriptor).toEqual(validResultChannel());
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.bindings)).toBe(true);
    expect(() => {
      descriptor.path = '/tmp/cecelia-prompts/caller-controlled.result.json';
    }).toThrow(TypeError);
    expect(() => {
      descriptor.bindings.role = 'reviewer';
    }).toThrow(TypeError);
  });

  it('strictly parses and freezes the server-owned Generator GitHub mutation policy', () => {
    expect(executionContract.parseGithubMutationPolicy).toBeTypeOf('function');
    expect(executionContract.buildGithubMutationPolicy).toBeTypeOf('function');
    const policy = executionContract.buildGithubMutationPolicy({
      taskId: TASK_ID,
      runId: RUN_ID,
      workspaceSpec: validWorkspaceSpec(),
      operation: 'push-and-create-draft',
      allowedPaths: ['packages/', 'sprints/'],
    });
    expect(policy).toEqual(validGithubMutationPolicy());
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.allowed_paths)).toBe(true);
    expect(executionContract.parseGithubMutationPolicy(policy, {
      workspaceSpec: validWorkspaceSpec(),
    })).toEqual(policy);
  });

  it.each([
    ['credential URL', { repo: 'https://user:secret@github.com/perfectuser21/cecelia.git' }],
    ['wrong branch', { branch: 'cp-attacker' }],
    ['wrong base', { base_sha: 'f'.repeat(40) }],
    ['path escape', { allowed_paths: ['../secrets'] }],
    ['unknown field', { callback_token: 'secret' }],
  ])('rejects Generator mutation policy with %s', (_name, patch) => {
    expect(() => executionContract.parseGithubMutationPolicy(
      { ...validGithubMutationPolicy(), ...patch },
      { workspaceSpec: validWorkspaceSpec() },
    )).toThrow();
  });

  it('strictly freezes an exact Workspace-bound GitHub read policy', () => {
    expect(executionContract.parseGithubReadPolicy).toBeTypeOf('function');
    expect(executionContract.buildGithubReadPolicy).toBeTypeOf('function');
    const workspaceSpec = validWorkspaceSpec({
      branch: 'cp-07280905-result-channel',
      expected_head_sha: BASE_SHA,
      mode: 'read-only',
    });
    const pullRequest = verifiedPullRequest();
    const policy = executionContract.buildGithubReadPolicy({
      pullRequest,
      workspaceSpec,
      allowedStates: ['OPEN'],
    });

    expect(policy).toEqual(validGithubReadPolicy());
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.allowed_states)).toBe(true);
    expect(executionContract.parseGithubReadPolicy(policy, {
      pullRequest,
      workspaceSpec,
    })).toEqual(policy);
  });

  it.each([
    ['wrong repo', { repo: 'attacker/repo' }],
    ['wrong URL', { url: 'https://github.com/perfectuser21/cecelia/pull/4392' }],
    ['wrong number', { number: 4392 }],
    ['wrong ref', { head_ref: 'cp-attacker' }],
    ['wrong SHA', { head_sha: 'f'.repeat(40) }],
    ['unknown state', { allowed_states: ['UNKNOWN'] }],
    ['unknown field', { token: 'secret' }],
  ])('rejects GitHub read policy with %s', (_name, patch) => {
    const workspaceSpec = validWorkspaceSpec({
      branch: 'cp-07280905-result-channel',
      expected_head_sha: BASE_SHA,
      mode: 'read-only',
    });
    expect(() => executionContract.parseGithubReadPolicy(
      { ...validGithubReadPolicy(), ...patch },
      { pullRequest: verifiedPullRequest(), workspaceSpec },
    )).toThrow();
  });

  it.each(['evaluator', 'reporter'])(
    'requires a GitHub read policy for Fleet %s but exempts canary',
    (role) => {
      const workspaceSpec = validWorkspaceSpec({
        branch: 'cp-07280905-result-channel',
        expected_head_sha: BASE_SHA,
        mode: role === 'evaluator' ? 'read-write' : 'read-only',
      });
      const bundle = validBundle({
        role,
        expected_output: `harness-result/${role}-v1`,
        constraints: {
          read_only: role === 'reporter',
          fresh_session: true,
          timeout_seconds: 600,
        },
        inputs: {
          ...validBundle().inputs,
          execution_surface: 'fleet-worker',
          workspace_spec: workspaceSpec,
          pull_request: verifiedPullRequest(),
          ...(role === 'evaluator'
            ? { verification_commands: ['npm test'] }
            : {}),
        },
        result_channel: validResultChannel({
          bindings: { ...validResultChannel().bindings, role },
        }),
      });
      delete bundle.inputs.worktree_path;

      expect(() => parseTaskBundle(bundle)).toThrow(/github_read_policy_required/);
      bundle.inputs.github_read_policy = validGithubReadPolicy();
      expect(parseTaskBundle(bundle).inputs.github_read_policy)
        .toEqual(validGithubReadPolicy());
    },
  );

  it('requires the v1 result channel for Fleet bundles but keeps legacy bundles compatible', () => {
    const fleetBundle = validBundle();
    delete fleetBundle.inputs.worktree_path;
    fleetBundle.inputs.execution_surface = 'fleet-worker';
    fleetBundle.inputs.workspace_spec = validWorkspaceSpec();

    expect(() => parseTaskBundle(fleetBundle)).toThrow(/result_channel_required/);
    expect(parseTaskBundle(validBundle())).not.toHaveProperty('result_channel');
  });

  it.each([
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
    ['explicit undefined', undefined],
  ])('rejects a legacy result_channel explicitly set to %s', (_name, resultChannel) => {
    const bundle = validBundle();
    bundle.result_channel = resultChannel;

    expect(() => parseTaskBundle(bundle)).toThrow();
  });

  it('accepts only the exact attempt-result-file/v1 protocol and a bounded positive max_bytes', () => {
    expect(executionContract.parseResultChannelDescriptor).toBeTypeOf('function');
    const expected = {
      taskId: TASK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      role: 'planner',
    };

    expect(executionContract.parseResultChannelDescriptor(
      validResultChannel(),
      expected,
    )).toEqual(validResultChannel());

    for (const value of ['attempt-result-file/v0', 'attempt-result-file/v1\r\n']) {
      expect(() => executionContract.parseResultChannelDescriptor(
        validResultChannel({ version: value }),
        expected,
      )).toThrow();
    }
    for (const value of [0, -1, 1024 * 1024 + 1]) {
      expect(() => executionContract.parseResultChannelDescriptor(
        validResultChannel({ max_bytes: value }),
        expected,
      )).toThrow();
    }
  });

  it('rejects unknown descriptor and binding fields', () => {
    expect(executionContract.parseResultChannelDescriptor).toBeTypeOf('function');
    const expected = {
      taskId: TASK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      role: 'planner',
    };

    expect(() => executionContract.parseResultChannelDescriptor({
      ...validResultChannel(),
      callback_url: 'https://attacker.invalid/callback',
    }, expected)).toThrow();
    expect(() => executionContract.parseResultChannelDescriptor({
      ...validResultChannel(),
      bindings: {
        ...validResultChannel().bindings,
        lease_owner: 'caller-controlled',
      },
    }, expected)).toThrow();
  });

  it.each([
    ['CR in path', `${RESULT_CHANNEL_PATH}\r`],
    ['LF in path', `${RESULT_CHANNEL_PATH}\n`],
    ['path traversal', `/tmp/cecelia-prompts/${ATTEMPT_ID}/../stolen.result.json`],
    ['another Attempt path', '/tmp/cecelia-prompts/44444444-4444-4444-8444-444444444444.result.json'],
    ['outside runtime mount', `/tmp/${ATTEMPT_ID}.result.json`],
  ])('rejects %s fail-closed', (_name, resultPath) => {
    expect(executionContract.parseResultChannelDescriptor).toBeTypeOf('function');
    expect(() => executionContract.parseResultChannelDescriptor(
      validResultChannel({ path: resultPath }),
      {
        taskId: TASK_ID,
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        role: 'planner',
      },
    )).toThrow();
  });

  it.each([
    ['task', 'task_id', '44444444-4444-4444-8444-444444444444'],
    ['run', 'run_id', '44444444-4444-4444-8444-444444444444'],
    ['attempt', 'attempt_id', '44444444-4444-4444-8444-444444444444'],
    ['role', 'role', 'reviewer'],
  ])('rejects a mismatched server-derived %s binding', (_name, field, value) => {
    const bundle = validBundle();
    delete bundle.inputs.worktree_path;
    bundle.inputs.execution_surface = 'fleet-worker';
    bundle.inputs.workspace_spec = validWorkspaceSpec();
    bundle.result_channel = validResultChannel({
      bindings: { ...validResultChannel().bindings, [field]: value },
    });

    expect(() => parseTaskBundle(bundle)).toThrow(/result_channel_.*_mismatch/);
  });

  it('rejects a Fleet bundle that only carries a caller-owned absolute worktree path', () => {
    const bundle = validBundle();
    bundle.inputs.execution_surface = 'fleet-worker';
    expect(() => parseTaskBundle(bundle)).toThrow(/workspace_spec/);
  });

  it('rejects a WorkspaceSpec whose mode disagrees with the read-only constraint', () => {
    const bundle = validBundle({
      inputs: {
        ...validBundle().inputs,
        execution_surface: 'fleet-worker',
        workspace_spec: validWorkspaceSpec({ mode: 'read-only' }),
      },
    });

    expect(() => parseTaskBundle(bundle)).toThrow(/workspace_mode_mismatch/);
  });

  it('formalizes commander as a provider-neutral Harness role', () => {
    expect(ROLE_VALUES).toContain('commander');
    expect(parseTaskBundle(validCommanderTask())).toMatchObject({
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      role: 'commander',
      expected_output: 'commander-directive/v1',
      inputs: {
        commander_bundle: {
          run_id: RUN_ID,
          commander_attempt_id: ATTEMPT_ID,
        },
      },
    });
  });

  it.each([
    [
      'missing CommanderBundle',
      () => {
        const task = validCommanderTask();
        delete task.inputs.commander_bundle;
        return task;
      },
    ],
    [
      'run id mismatch',
      () => validCommanderTask({
        inputs: {
          ...validCommanderTask().inputs,
          commander_bundle: validCommanderBundle({
            run_id: '44444444-4444-4444-8444-444444444444',
          }),
        },
      }),
    ],
    [
      'attempt id mismatch',
      () => validCommanderTask({
        inputs: {
          ...validCommanderTask().inputs,
          commander_bundle: validCommanderBundle({
            commander_attempt_id: '55555555-5555-4555-8555-555555555555',
          }),
        },
      }),
    ],
    [
      'wrong expected output',
      () => validCommanderTask({ expected_output: 'harness-result/commander-v1' }),
    ],
  ])('rejects a Commander TaskBundle with %s', (_name, buildTask) => {
    expect(() => parseTaskBundle(buildTask())).toThrow();
  });
});

describe('HarnessResult contract', () => {
  const reviewerRoleResult = withRoleDigest({
    kind: 'reviewer',
    claimed: {
      verdict: 'REVISION',
      rubric_scores: {
        dod_machineability: 10,
        scope_match_prd: 9,
        test_is_red: 8,
        internal_consistency: 10,
        risk_registered: 9,
        verification_oracle_completeness: 8,
        ci_workflow_alignment: 10,
      },
      judgments_written: 0,
      feedback: '补充真实重启回放断言。',
    },
    verified: {
      contract_sha: BASE_SHA,
      verdict: 'REVISION',
      rubric_scores: {
        dod_machineability: 10,
        scope_match_prd: 9,
        test_is_red: 8,
        internal_consistency: 10,
        risk_registered: 9,
        verification_oracle_completeness: 8,
        ci_workflow_alignment: 10,
      },
      judgments_written: 0,
    },
  });

  it('preserves an exact role_result instead of stripping it from the callback', () => {
    const parsed = parseHarnessResult(validResult({
      decision: {
        outcome: 'REVISION',
        reason: reviewerRoleResult.claimed.feedback,
        contract_sha: BASE_SHA,
        judgments_written: 0,
      },
      checks: Object.entries(reviewerRoleResult.verified.rubric_scores)
        .map(([name, score]) => ({ name, score })),
      role_result: reviewerRoleResult,
    }), 'reviewer', 'harness-result/reviewer-v1', {
      contractSha: BASE_SHA,
    });

    expect(parsed.role_result).toEqual(reviewerRoleResult);
  });

  it('rejects role_result unknown fields and role/expected-output mismatches', () => {
    expect(() => parseHarnessResult(validResult({
      decision: { outcome: 'REVISION', reason: reviewerRoleResult.claimed.feedback },
      role_result: {
        ...reviewerRoleResult,
        injected: true,
      },
    }), 'reviewer', 'harness-result/reviewer-v1')).toThrow();

    expect(() => parseHarnessResult(validResult({
      decision: { outcome: 'REVISION', reason: reviewerRoleResult.claimed.feedback },
      role_result: reviewerRoleResult,
    }), 'evaluator', 'harness-result/evaluator-v1')).toThrow(/role_result/);
  });

  it('accepts an APPROVED reviewer role_result with zero judgments when parity holds', () => {
    const approved = withRoleDigest({
      ...reviewerRoleResult,
      claimed: {
        ...reviewerRoleResult.claimed,
        verdict: 'APPROVED',
      },
      verified: {
        ...reviewerRoleResult.verified,
        verdict: 'APPROVED',
      },
    });
    expect(executionContract.__test__.roleResultSchema.parse(approved)).toMatchObject({
      claimed: { verdict: 'APPROVED', judgments_written: 0 },
      verified: { verdict: 'APPROVED', judgments_written: 0 },
    });
  });

  it('keeps the reviewer judgments upper bound for APPROVED role_result', () => {
    const oversized = withRoleDigest({
      ...reviewerRoleResult,
      claimed: {
        ...reviewerRoleResult.claimed,
        verdict: 'APPROVED',
        judgments_written: 10001,
      },
      verified: {
        ...reviewerRoleResult.verified,
        verdict: 'APPROVED',
        judgments_written: 10001,
      },
    });
    expect(() => executionContract.__test__.roleResultSchema.parse(oversized)).toThrow();
  });

  it('recomputes claimed canonical raw_sha256 instead of trusting the callback digest', () => {
    expect(() => parseHarnessResult(validResult({
      decision: {
        outcome: 'REVISION',
        reason: reviewerRoleResult.claimed.feedback,
        contract_sha: BASE_SHA,
        judgments_written: 0,
      },
      checks: Object.entries(reviewerRoleResult.verified.rubric_scores)
        .map(([name, score]) => ({ name, score })),
      role_result: {
        ...reviewerRoleResult,
        raw_sha256: '0'.repeat(64),
      },
    }), 'reviewer', 'harness-result/reviewer-v1', {
      contractSha: BASE_SHA,
    })).toThrow(/raw_sha256/);
  });

  it('keeps legacy callback envelopes valid when role_result is absent', () => {
    expect(parseHarnessResult(
      validResult({ decision: { verdict: 'REVISION', feedback: 'legacy' } }),
      'reviewer',
      'harness-result/reviewer-v1',
    ).role_result).toBeUndefined();
  });

  it('accepts the evaluator Skill cascade assertion object without a permissive passthrough', () => {
    const evaluatorRoleResult = withRoleDigest({
      kind: 'evaluator',
      claimed: {
        verdict: 'PASS',
        task_id: TASK_ID,
        attempt_id: ATTEMPT_ID,
        behavior_tests: [{
          command: 'npm test',
          exit_code: 0,
          log_tail: 'green',
        }],
        cascade_assertions: [{
          link_id: '44444444-4444-4444-8444-444444444444',
          assertion_ref: 'tests/receipt-replay.test.js',
          ran: true,
          result: 'pass',
        }],
      },
      verified: {
        contract_sha: BASE_SHA,
        pull_request: verifiedPullRequest(),
        behavior_tests: [{
          command: 'npm test',
          exit_code: 0,
          log_tail: 'green',
        }],
      },
    });

    expect(parseHarnessResult(validResult({
      decision: {
        outcome: 'PASS',
        reason: '',
        pr_head_sha: BASE_SHA,
        contract_sha: BASE_SHA,
        unverifiable: [],
      },
      artifacts: [{
        type: 'evaluation_target',
        url: verifiedPullRequest().url,
        number: verifiedPullRequest().number,
        head_ref: verifiedPullRequest().head_ref,
        head_sha: BASE_SHA,
        contract_sha: BASE_SHA,
      }],
      checks: evaluatorRoleResult.verified.behavior_tests,
      role_result: evaluatorRoleResult,
    }), 'evaluator', 'harness-result/evaluator-v1', {
      taskId: TASK_ID,
      contractSha: BASE_SHA,
      pullRequest: verifiedPullRequest(),
    }).role_result)
      .toEqual(evaluatorRoleResult);
  });

  it('accepts exact evaluator Skill feedback-only, segmented and relative screenshot fields', () => {
    const evaluatorRoleResult = withRoleDigest({
      kind: 'evaluator',
      claimed: {
        verdict: 'FAIL',
        task_id: TASK_ID,
        attempt_id: ATTEMPT_ID,
        feedback: 'DoD 缺 [BEHAVIOR] 条目',
        segment_eval: 'ws2',
        screenshots: [
          'sprints/07280905-kernel-result-channel-bootstrap/screenshots/result.png',
        ],
      },
      verified: {
        contract_sha: BASE_SHA,
        pull_request: verifiedPullRequest(),
        behavior_tests: [],
      },
    });

    expect(parseHarnessResult(validResult({
      decision: {
        outcome: 'FAIL',
        reason: evaluatorRoleResult.claimed.feedback,
        pr_head_sha: BASE_SHA,
        contract_sha: BASE_SHA,
        unverifiable: [],
      },
      artifacts: [{
        type: 'evaluation_target',
        url: verifiedPullRequest().url,
        number: verifiedPullRequest().number,
        head_ref: verifiedPullRequest().head_ref,
        head_sha: BASE_SHA,
        contract_sha: BASE_SHA,
      }],
      checks: [],
      role_result: evaluatorRoleResult,
    }), 'evaluator', 'harness-result/evaluator-v1', {
      taskId: TASK_ID,
      contractSha: BASE_SHA,
      pullRequest: verifiedPullRequest(),
    }).role_result).toEqual(evaluatorRoleResult);
  });

  it.each([
    [
      'planner claimed/verified branch mismatch',
      {
        kind: 'planner',
        raw_sha256: 'c'.repeat(64),
        claimed: {
          verdict: 'DONE',
          branch: 'cp-claimed',
          sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
          planner_branch: 'cp-claimed',
          review_required: true,
          status: 'DONE_WITH_CONCERNS',
        },
        verified: {
          branch: 'cp-verified',
          sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
          planner_branch: 'cp-verified',
          prd_sha256: `sha256:${'d'.repeat(64)}`,
          effective_review_required: false,
        },
      },
    ],
    [
      'reviewer rubric and verdict mismatch',
      {
        ...reviewerRoleResult,
        claimed: {
          ...reviewerRoleResult.claimed,
          verdict: 'APPROVED',
          judgments_written: 1,
        },
        verified: {
          ...reviewerRoleResult.verified,
          verdict: 'REVISION',
          judgments_written: 1,
          rubric_scores: {
            ...reviewerRoleResult.verified.rubric_scores,
            dod_machineability: 0,
          },
        },
      },
    ],
    [
      'evaluator PASS without verified tests and invalid cascade state',
      {
        kind: 'evaluator',
        raw_sha256: 'e'.repeat(64),
        claimed: {
          verdict: 'PASS',
          task_id: TASK_ID,
          attempt_id: ATTEMPT_ID,
          behavior_tests: [],
          cascade_assertions: [{
            link_id: 'link-1',
            assertion_ref: 'tests/e2e.test.js',
            ran: false,
            result: 'pass',
          }],
        },
        verified: {
          contract_sha: BASE_SHA,
          pull_request: verifiedPullRequest(),
          behavior_tests: [],
        },
      },
    ],
    [
      'generator claimed and verified PR mismatch',
      {
        kind: 'generator',
        raw_sha256: 'f'.repeat(64),
        claimed: {
          verdict: 'DONE',
          pr_url: 'https://github.com/perfectuser21/cecelia/pull/4391',
        },
        verified: {
          pull_request: {
            type: 'pull_request',
            url: 'https://github.com/perfectuser21/cecelia/pull/9999',
            number: 9999,
            head_ref: 'cp-other',
            head_sha: BASE_SHA,
            state: 'OPEN',
          },
        },
      },
    ],
  ])('rejects cross-field role_result parity violation: %s', (_name, roleResult) => {
    expect(() => executionContract.__test__.roleResultSchema.parse(
      withRoleDigest(roleResult),
    )).toThrow();
  });

  it('requires evaluator role_result task authority and rejects a mismatched task binding', () => {
    const evaluatorRoleResult = withRoleDigest({
      kind: 'evaluator',
      claimed: {
        verdict: 'FAIL',
        task_id: TASK_ID,
        attempt_id: ATTEMPT_ID,
        feedback: 'failed safely',
      },
      verified: {
        contract_sha: BASE_SHA,
        pull_request: verifiedPullRequest(),
        behavior_tests: [],
      },
    });
    const envelope = validResult({
      decision: {
        outcome: 'FAIL',
        reason: 'failed safely',
        pr_head_sha: BASE_SHA,
        contract_sha: BASE_SHA,
        unverifiable: [],
      },
      artifacts: [{
        type: 'evaluation_target',
        url: verifiedPullRequest().url,
        number: verifiedPullRequest().number,
        head_ref: verifiedPullRequest().head_ref,
        head_sha: BASE_SHA,
        contract_sha: BASE_SHA,
      }],
      role_result: evaluatorRoleResult,
    });

    expect(() => parseHarnessResult(
      envelope,
      'evaluator',
      'harness-result/evaluator-v1',
    )).toThrow(/authority/);
    expect(() => parseHarnessResult(
      envelope,
      'evaluator',
      'harness-result/evaluator-v1',
      { taskId: RUN_ID },
    )).toThrow(/task_id/);
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
  ])(
    'rejects %s role_result when required server PR authority contains only %s',
    (role, onlyField) => {
      const pr = verifiedPullRequest();
      const rawByRole = {
        generator: {
          verdict: 'DONE',
          pr_url: pr.url,
        },
        evaluator: {
          verdict: 'FAIL',
          task_id: TASK_ID,
          attempt_id: ATTEMPT_ID,
          feedback: 'failed safely',
        },
        reporter: {
          verdict: 'DONE',
          task_id: TASK_ID,
          report_path: 'sprints/07280905-kernel-result-channel-bootstrap/harness-report.md',
          pr_url: pr.url,
          screenshots: [],
          concerns: '',
        },
      };
      const verifiedByRole = {
        generator: { pull_request: pr },
        evaluator: {
          contract_sha: BASE_SHA,
          pull_request: pr,
          behavior_tests: [],
        },
        reporter: {
          pull_request: pr,
          report: {
            path: rawByRole.reporter.report_path,
            sha256: `sha256:${'d'.repeat(64)}`,
          },
          learning: {
            path: 'sprints/07280905-kernel-result-channel-bootstrap/learning.md',
            sha256: `sha256:${'e'.repeat(64)}`,
          },
          screenshots: [],
          learnings_inserted: 1,
        },
      };
      const finalized = finalizeRoleResult({
        expectedOutput: `harness-result/${role}-v1`,
        binding: {
          task_id: TASK_ID,
          run_id: RUN_ID,
          attempt_id: ATTEMPT_ID,
          role,
        },
        providerResult: validResult(),
        rawEnvelope: rawByRole[role],
        verifierEnvelope: verifiedByRole[role],
      });
      const authority = {
        taskId: TASK_ID,
        sprintDir: 'sprints/07280905-kernel-result-channel-bootstrap',
        contractSha: BASE_SHA,
        attemptKind: role === 'generator' ? 'fix' : 'initial',
        pullRequest: { [onlyField]: pr[onlyField] },
      };

      expect(() => parseHarnessResult(
        finalized,
        role,
        `harness-result/${role}-v1`,
        authority,
      )).toThrow(/PR authority is required/);
    },
  );

  it('derives PR number and fixed type from complete server-owned authority, then rejects callback number forgery', () => {
    const pr = verifiedPullRequest();
    const roleResult = withRoleDigest({
      kind: 'generator',
      claimed: { verdict: 'DONE', pr_url: pr.url },
      verified: { pull_request: pr },
    });
    const envelope = validResult({
      artifacts: [pr],
      decision: { outcome: 'DONE', reason: '', pr_head_sha: pr.head_sha },
      role_result: roleResult,
    });
    const authority = {
      attemptKind: 'fix',
      pullRequest: {
        url: pr.url,
        head_ref: pr.head_ref,
        head_sha: pr.head_sha,
        state: pr.state,
      },
    };

    expect(parseHarnessResult(
      envelope,
      'generator',
      'harness-result/generator-v1',
      authority,
    ).role_result).toEqual(roleResult);

    const forgedPr = { ...pr, number: pr.number + 1 };
    expect(() => parseHarnessResult(validResult({
      artifacts: [forgedPr],
      decision: { outcome: 'DONE', reason: '', pr_head_sha: pr.head_sha },
      role_result: withRoleDigest({
        ...roleResult,
        verified: { pull_request: forgedPr },
      }),
    }), 'generator', 'harness-result/generator-v1', authority)).toThrow(
      /PR number authority mismatch/,
    );

    expect(() => parseHarnessResult(
      envelope,
      'generator',
      'harness-result/generator-v1',
      {
        ...authority,
        pullRequest: { ...authority.pullRequest, state: 'open' },
      },
    )).toThrow(/PR state authority mismatch/);
  });

  it('accepts MERGED PR evidence only for reporter role_result', () => {
    const pr = verifiedPullRequest({ state: 'MERGED' });
    const reportPath = 'sprints/07280905-kernel-result-channel-bootstrap/harness-report.md';
    const roleResult = withRoleDigest({
      kind: 'reporter',
      claimed: {
        verdict: 'DONE',
        task_id: TASK_ID,
        report_path: reportPath,
        pr_url: pr.url,
        screenshots: [],
        concerns: '',
      },
      verified: {
        pull_request: pr,
        report: { path: reportPath, sha256: `sha256:${'d'.repeat(64)}` },
        learning: {
          path: 'sprints/07280905-kernel-result-channel-bootstrap/learning.md',
          sha256: `sha256:${'e'.repeat(64)}`,
        },
        screenshots: [],
        learnings_inserted: 1,
      },
    });
    const envelope = validResult({
      artifacts: [
        pr,
        { type: 'harness_report', ...roleResult.verified.report },
        { type: 'learning', ...roleResult.verified.learning },
      ],
      checks: [{ type: 'learnings_inserted', count: 1 }],
      decision: { outcome: 'DONE', reason: '' },
      role_result: roleResult,
    });

    expect(parseHarnessResult(
      envelope,
      'reporter',
      'harness-result/reporter-v1',
      {
        taskId: TASK_ID,
        sprintDir: 'sprints/07280905-kernel-result-channel-bootstrap',
        pullRequest: {
          url: pr.url,
          head_ref: pr.head_ref,
          head_sha: pr.head_sha,
          state: pr.state,
        },
      },
    ).role_result).toEqual(roleResult);
    for (const role of ['generator', 'evaluator']) {
      const incompatible = withRoleDigest({
        kind: role,
        claimed: role === 'generator'
          ? { verdict: 'DONE', pr_url: pr.url }
          : {
            verdict: 'FAIL',
            task_id: TASK_ID,
            attempt_id: ATTEMPT_ID,
            feedback: 'not applicable',
          },
        verified: role === 'generator'
          ? { pull_request: pr }
          : { contract_sha: BASE_SHA, pull_request: pr, behavior_tests: [] },
      });
      expect(() => executionContract.__test__.roleResultSchema.parse(incompatible))
        .toThrow();
    }
  });

  it.each([
    ['planner lifecycle', {
      role: 'planner',
      expectedOutput: 'harness-result/planner-v1',
      authority: {
        sprintDir: 'sprints/07280905-kernel-result-channel-bootstrap',
      },
      roleResult: withRoleDigest({
        kind: 'planner',
        claimed: {
          verdict: 'DONE',
          branch: 'cp-planner',
          sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
          planner_branch: 'cp-planner',
          review_required: false,
          status: 'DONE',
        },
        verified: {
          branch: 'cp-planner',
          sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
          planner_branch: 'cp-planner',
          prd_sha256: `sha256:${'d'.repeat(64)}`,
          effective_review_required: false,
        },
      }),
      patch: {
        status: 'failed',
        decision: { outcome: 'DONE', reason: '', review_required: false },
        artifacts: [{
          type: 'planner_prd',
          path: 'sprints/07280905-kernel-result-channel-bootstrap',
          sha256: `sha256:${'d'.repeat(64)}`,
          branch: 'cp-planner',
        }],
      },
    }],
    ['reviewer decision/checks', {
      role: 'reviewer',
      expectedOutput: 'harness-result/reviewer-v1',
      authority: { contractSha: BASE_SHA },
      roleResult: reviewerRoleResult,
      patch: {
        decision: { outcome: 'APPROVED', reason: 'forged' },
        checks: [],
      },
    }],
    ['evaluator observed checks', {
      role: 'evaluator',
      expectedOutput: 'harness-result/evaluator-v1',
      authority: {
        taskId: TASK_ID,
        contractSha: BASE_SHA,
        pullRequest: verifiedPullRequest(),
      },
      roleResult: withRoleDigest({
        kind: 'evaluator',
        claimed: {
          verdict: 'PASS',
          task_id: TASK_ID,
          attempt_id: ATTEMPT_ID,
          behavior_tests: [{
            command: 'npm test',
            exit_code: 0,
            log_tail: 'green',
          }],
        },
        verified: {
          contract_sha: BASE_SHA,
          pull_request: verifiedPullRequest(),
          behavior_tests: [{
            command: 'npm test',
            exit_code: 0,
            log_tail: 'green',
          }],
        },
      }),
      patch: {
        decision: {
          outcome: 'PASS',
          reason: '',
          pr_head_sha: BASE_SHA,
          contract_sha: BASE_SHA,
          unverifiable: [],
        },
        artifacts: [{
          type: 'evaluation_target',
          url: verifiedPullRequest().url,
          number: verifiedPullRequest().number,
          head_ref: verifiedPullRequest().head_ref,
          head_sha: BASE_SHA,
          contract_sha: BASE_SHA,
        }],
        checks: [{ command: 'forged', exit_code: 0, log_tail: 'green' }],
      },
    }],
    ['generator callback artifact SHA', {
      role: 'generator',
      expectedOutput: 'harness-result/generator-v1',
      authority: undefined,
      roleResult: withRoleDigest({
        kind: 'generator',
        claimed: {
          verdict: 'DONE',
          pr_url: 'https://github.com/perfectuser21/cecelia/pull/4391',
        },
        verified: {
          pull_request: {
            type: 'pull_request',
            url: 'https://github.com/perfectuser21/cecelia/pull/4391',
            number: 4391,
            head_ref: 'cp-result',
            head_sha: BASE_SHA,
            state: 'OPEN',
          },
        },
      }),
      patch: {
        decision: { outcome: 'DONE', reason: '', pr_head_sha: BASE_SHA },
        artifacts: [{
          type: 'pull_request',
          url: 'https://github.com/perfectuser21/cecelia/pull/4391',
          number: 4391,
          head_ref: 'cp-result',
          head_sha: 'f'.repeat(40),
          state: 'OPEN',
        }],
      },
    }],
  ])('rejects outer envelope parity violation: %s', (_name, fixture) => {
    expect(() => parseHarnessResult(validResult({
      ...fixture.patch,
      role_result: fixture.roleResult,
    }), fixture.role, fixture.expectedOutput, fixture.authority)).toThrow(/parity|lifecycle/);
  });

  it.each([
    {
      kind: 'planner',
      raw_sha256: 'c'.repeat(64),
      claimed: {
        verdict: 'DONE',
        branch: 'cp-07280905-harness-prd',
        sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
        planner_branch: 'cp-07280905-harness-prd',
        review_required: true,
        status: 'DONE',
      },
      verified: {
        branch: 'cp-07280905-harness-prd',
        sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
        planner_branch: 'cp-07280905-harness-prd',
        prd_sha256: `sha256:${'d'.repeat(64)}`,
        effective_review_required: true,
      },
    },
    {
      kind: 'proposer',
      raw_sha256: 'c'.repeat(64),
      claimed: {
        propose_branch: 'cp-harness-propose-r1-33333333-a2',
        workstream_count: 1,
        task_plan_path: 'sprints/07280905-kernel-result-channel-bootstrap/task-plan.json',
      },
      verified: {
        propose_branch: 'cp-harness-propose-r1-33333333-a2',
        head_sha: BASE_SHA,
        artifacts: Object.fromEntries([
          ['contract_draft', 'contract-draft.md'],
          ['contract_dod', 'contract-dod.md'],
          ['task_plan', 'task-plan.json'],
          ['contract_tests', 'tests'],
        ].map(([kind, name]) => [kind, {
          path: `sprints/07280905-kernel-result-channel-bootstrap/${name}`,
          sha256: `sha256:${'d'.repeat(64)}`,
        }])),
      },
    },
    {
      kind: 'generator',
      raw_sha256: 'c'.repeat(64),
      claimed: {
        verdict: 'FAILED',
        pr_url: 'https://github.com/perfectuser21/cecelia/pull/4391',
        reason: 'bounded repair budget exhausted',
      },
      verified: {
        pull_request: {
          type: 'pull_request',
          url: 'https://github.com/perfectuser21/cecelia/pull/4391',
          number: 4391,
          head_ref: 'cp-07280905-result-channel',
          head_sha: BASE_SHA,
          state: 'OPEN',
        },
      },
    },
    {
      kind: 'reporter',
      raw_sha256: 'c'.repeat(64),
      claimed: {
        verdict: 'DONE',
        task_id: TASK_ID,
        report_path: 'sprints/07280905-kernel-result-channel-bootstrap/harness-report.md',
        pr_url: 'https://github.com/perfectuser21/cecelia/pull/4391',
        screenshots: [],
        concerns: '',
      },
      verified: {
        pull_request: verifiedPullRequest(),
        report: {
          path: 'sprints/07280905-kernel-result-channel-bootstrap/harness-report.md',
          sha256: `sha256:${'d'.repeat(64)}`,
        },
        learning: {
          path: 'sprints/07280905-kernel-result-channel-bootstrap/learning.md',
          sha256: `sha256:${'d'.repeat(64)}`,
        },
        screenshots: [],
        learnings_inserted: 1,
      },
    },
  ])('accepts the exact $kind role_result branch of the discriminated union', (roleResult) => {
    const bound = withRoleDigest(roleResult);
    expect(executionContract.__test__.roleResultSchema.parse(bound))
      .toEqual(bound);
  });

  it('accepts the exact deterministic proposer envelope emitted by the Runner finalizer', () => {
    const taskPlanPath = 'sprints/07280905-kernel-result-channel-bootstrap/task-plan.json';
    const proposeBranch = 'cp-harness-propose-r1-33333333-a2';
    const artifact = (path) => ({
      path,
      sha256: `sha256:${'d'.repeat(64)}`,
    });
    const finalized = finalizeRoleResult({
      expectedOutput: 'harness-result/proposer-v1',
      binding: {
        task_id: TASK_ID,
        run_id: RUN_ID,
        attempt_id: ATTEMPT_ID,
        role: 'proposer',
      },
      providerResult: validResult({
        artifacts: [],
        checks: [],
        decision: null,
      }),
      rawEnvelope: {
        propose_branch: proposeBranch,
        workstream_count: 1,
        task_plan_path: taskPlanPath,
      },
      verifierEnvelope: {
        propose_branch: proposeBranch,
        head_sha: BASE_SHA,
        artifacts: {
          task_plan: artifact(taskPlanPath),
          contract_tests: artifact(
            'sprints/07280905-kernel-result-channel-bootstrap/tests',
          ),
          contract_dod: artifact(
            'sprints/07280905-kernel-result-channel-bootstrap/contract-dod.md',
          ),
          contract_draft: artifact(
            'sprints/07280905-kernel-result-channel-bootstrap/contract-draft.md',
          ),
        },
      },
    });

    expect(parseHarnessResult(
      finalized,
      'proposer',
      'harness-result/proposer-v1',
      {
        proposerBranch: proposeBranch,
        sprintDir: 'sprints/07280905-kernel-result-channel-bootstrap',
      },
    ).role_result.kind).toBe('proposer');
  });

  it.each([
    [
      'provider 503',
      {
        status: 'failed',
        summary: 'provider unavailable',
        error: { code: 'http_503', message: 'bounded diagnostic' },
      },
      'infrastructure_blocked',
    ],
    [
      'provider timeout',
      {
        status: 'failed',
        summary: 'provider process timed out',
        error: {
          code: 'provider_timeout',
          message: 'provider exceeded the TaskBundle timeout',
        },
      },
      'infrastructure_blocked',
    ],
    [
      'runner failure',
      {
        status: 'failed',
        summary: 'runner exited',
        error: { code: 'runner_exit', message: 'bounded diagnostic' },
      },
      'runner_failure',
    ],
    [
      'semantic refusal',
      {
        status: 'blocked',
        summary: 'cannot proceed under the supplied contract',
        error: null,
      },
      'semantic_refusal',
    ],
  ])('classifies %s without reading free-form messages', (_name, patch, failureClass) => {
    expect(parseHarnessResult(validResult(patch), 'planner').failure_class)
      .toBe(failureClass);
  });

  it('accepts a planner result without a verdict decision', () => {
    expect(parseHarnessResult(validResult(), 'planner')).toMatchObject({
      contract_version: RESULT_CONTRACT_VERSION,
      status: 'completed',
    });
  });

  it('accepts the real planner metadata decision emitted by the runner schema', () => {
    const parsed = parseHarnessResult(validResult({
      decision: {
        verdict: 'DONE',
        branch: 'cp-07221848-ws-f5bf5b50',
        sprint_dir: 'sprints/07221848-kernel-fire-drill-quickcheck',
      },
    }), 'planner');

    expect(parsed.decision).toMatchObject({
      verdict: 'DONE',
      branch: 'cp-07221848-ws-f5bf5b50',
    });
  });

  it.each(['reviewer', 'evaluator', 'judge'])('requires a decision for %s', (role) => {
    expect(() => parseHarnessResult(validResult(), role)).toThrow(/decision/);
  });

  it('accepts a structured reviewer decision', () => {
    const parsed = parseHarnessResult(validResult({
      decision: { outcome: 'changes_requested', reason: 'Missing recovery check.' },
    }), 'reviewer');
    expect(parsed.decision.outcome).toBe('changes_requested');
  });

  it('normalizes a skill-native reviewer verdict into the canonical decision fields', () => {
    const parsed = parseHarnessResult(validResult({
      decision: { verdict: 'APPROVED', feedback: 'Contract covers the PRD.' },
    }), 'reviewer');

    expect(parsed.decision).toMatchObject({
      outcome: 'APPROVED',
      reason: 'Contract covers the PRD.',
    });
  });

  it('rejects an adversarial decision with no outcome or verdict', () => {
    expect(() => parseHarnessResult(validResult({
      decision: { branch: 'cp-no-verdict' },
    }), 'reviewer')).toThrow(/outcome/);
  });

  it('requires CANARY_OK for the dedicated canary output contract', () => {
    expect(() => parseHarnessResult(
      validResult({ decision: null }),
      'reporter',
      'harness-result/canary-v1',
    )).toThrow(/CANARY_OK/);

    expect(() => parseHarnessResult(
      validResult({ decision: { outcome: 'NOT_OK' } }),
      'reporter',
      'harness-result/canary-v1',
    )).toThrow(/CANARY_OK/);

    expect(parseHarnessResult(
      validResult({ decision: { outcome: 'CANARY_OK' } }),
      'reporter',
      'harness-result/canary-v1',
    ).decision.outcome).toBe('CANARY_OK');
  });

  it('requires an empty side-effect envelope for a successful canary', () => {
    for (const dirty of [
      { artifacts: ['unexpected'] },
      { checks: ['unexpected'] },
      { error: { code: 'unexpected' } },
    ]) {
      expect(() => parseHarnessResult(
        validResult({ decision: { outcome: 'CANARY_OK' }, ...dirty }),
        'reporter',
        'harness-result/canary-v1',
      )).toThrow(/empty artifacts, empty checks, and null error/);
    }
  });

  it.each([
    'completed_with_concerns',
    'needs_context',
    'blocked',
    'failed',
    'cancelled',
  ])(
    'lets a non-success %s canary reach terminal persistence',
    (status) => {
      expect(parseHarnessResult(
        validResult({
          status,
          decision: null,
          error: { code: 'provider_exit', message: 'failed safely' },
        }),
        'reporter',
        'harness-result/canary-v1',
      ).status).toBe(status);
    },
  );

  it.each([
    ['completed', 'DONE'],
    ['completed_with_concerns', 'DONE_WITH_CONCERNS'],
    ['needs_context', 'NEEDS_CONTEXT'],
    ['blocked', 'BLOCKED'],
  ])('maps %s to %s', (status, expected) => {
    expect(toKernelStatus(status)).toBe(expected);
  });

  it.each(['failed', 'cancelled'])('rejects terminal executor status %s as a Kernel success state', (status) => {
    expect(() => toKernelStatus(status)).toThrow(/executor_terminal/);
  });

  it('accepts one strict Commander Directive in the transport decision', () => {
    const parsed = parseHarnessResult(
      validResult({
        summary: 'Continue with the current Kernel decision.',
        decision: validCommanderDirective(),
      }),
      'commander',
      'commander-directive/v1',
      { runId: RUN_ID, attemptId: ATTEMPT_ID },
    );

    expect(parsed.decision).toEqual(validCommanderDirective());
  });

  it.each([
    [
      'unknown Directive field',
      validResult({
        decision: validCommanderDirective({ provider_prompt: 'must not persist' }),
      }),
      { runId: RUN_ID, attemptId: ATTEMPT_ID },
    ],
    [
      'Directive run id mismatch',
      validResult({
        decision: validCommanderDirective({
          run_id: '44444444-4444-4444-8444-444444444444',
        }),
      }),
      { runId: RUN_ID, attemptId: ATTEMPT_ID },
    ],
    [
      'transport attempt id mismatch',
      validResult({
        attempt_id: '55555555-5555-4555-8555-555555555555',
        decision: validCommanderDirective(),
      }),
      { runId: RUN_ID, attemptId: ATTEMPT_ID },
    ],
  ])('rejects Commander result with %s', (_name, result, expectedIdentity) => {
    expect(() => parseHarnessResult(
      result,
      'commander',
      'commander-directive/v1',
      expectedIdentity,
    )).toThrow();
  });

  it.each(['completed_with_concerns', 'needs_context', 'blocked', 'failed', 'cancelled'])(
    'persists non-success Commander transport state %s only without a Directive',
    (status) => {
      expect(parseHarnessResult(
        validResult({
          status,
          decision: null,
          error: status === 'failed' ? { code: 'provider_unavailable' } : null,
        }),
        'commander',
        'commander-directive/v1',
        { runId: RUN_ID, attemptId: ATTEMPT_ID },
      ).status).toBe(status);
      expect(() => parseHarnessResult(
        validResult({ status, decision: validCommanderDirective() }),
        'commander',
        'commander-directive/v1',
        { runId: RUN_ID, attemptId: ATTEMPT_ID },
      )).toThrow();
    },
  );
});
