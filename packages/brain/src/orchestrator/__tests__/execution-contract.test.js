import { describe, it, expect } from 'vitest';
import * as executionContract from '../execution-contract.js';
import {
  parseTaskBundle,
  parseHarnessResult,
  toKernelStatus,
  TASK_CONTRACT_VERSION,
  RESULT_CONTRACT_VERSION,
  ROLE_VALUES,
} from '../execution-contract.js';

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

describe('TaskBundle contract', () => {
  it('accepts the provider-neutral v1 bundle', () => {
    expect(parseTaskBundle(validBundle())).toMatchObject({
      contract_version: TASK_CONTRACT_VERSION,
      role: 'planner',
    });
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
  const reviewerRoleResult = {
    kind: 'reviewer',
    raw_sha256: 'a'.repeat(64),
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
  };

  it('preserves an exact role_result instead of stripping it from the callback', () => {
    const parsed = parseHarnessResult(validResult({
      decision: { outcome: 'REVISION', reason: reviewerRoleResult.claimed.feedback },
      role_result: reviewerRoleResult,
    }), 'reviewer', 'harness-result/reviewer-v1');

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

  it('rejects an APPROVED reviewer role_result with no observed judgment write', () => {
    expect(() => executionContract.__test__.roleResultSchema.parse({
      ...reviewerRoleResult,
      claimed: {
        ...reviewerRoleResult.claimed,
        verdict: 'APPROVED',
      },
      verified: {
        ...reviewerRoleResult.verified,
        verdict: 'APPROVED',
      },
    })).toThrow(/judgment/i);
  });

  it('keeps legacy callback envelopes valid when role_result is absent', () => {
    expect(parseHarnessResult(
      validResult({ decision: { verdict: 'REVISION', feedback: 'legacy' } }),
      'reviewer',
      'harness-result/reviewer-v1',
    ).role_result).toBeUndefined();
  });

  it('accepts the evaluator Skill cascade assertion object without a permissive passthrough', () => {
    const evaluatorRoleResult = {
      kind: 'evaluator',
      raw_sha256: 'b'.repeat(64),
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
        pr_head_sha: BASE_SHA,
        behavior_tests: [{
          command: 'npm test',
          exit_code: 0,
          log_tail: 'green',
        }],
      },
    };

    expect(parseHarnessResult(validResult({
      decision: { outcome: 'PASS', reason: '' },
      role_result: evaluatorRoleResult,
    }), 'evaluator', 'harness-result/evaluator-v1').role_result)
      .toEqual(evaluatorRoleResult);
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
        pull_request_url: 'https://github.com/perfectuser21/cecelia/pull/4391',
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
    expect(executionContract.__test__.roleResultSchema.parse(roleResult))
      .toEqual(roleResult);
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
