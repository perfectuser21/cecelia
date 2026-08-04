import { describe, it, expect } from 'vitest';
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
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';

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
      task_id: '33333333-3333-4333-8333-333333333333',
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

  it('accepts only the bounded server-owned PostgreSQL runtime request', () => {
    const bundle = validBundle();
    bundle.inputs.runtime_resources = { postgres: true };
    expect(parseTaskBundle(bundle).inputs.runtime_resources).toEqual({ postgres: true });

    bundle.inputs.runtime_resources = { postgres: true, token: 'attacker' };
    expect(() => parseTaskBundle(bundle)).toThrow();
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

    expect(parseTaskBundle(bundle).inputs.workspace_spec).toEqual({
      ...validWorkspaceSpec(),
      frozen_baseline: false,
    });
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

  it('classifies needs_context separately from semantic refusal', () => {
    expect(parseHarnessResult(validResult({
      status: 'needs_context',
      summary: 'A contract answer is required.',
      error: null,
    }), 'planner').failure_class).toBe('needs_context');
  });

  it('only treats blocked as infrastructure when the worker declares that structured class', () => {
    expect(parseHarnessResult(validResult({
      status: 'blocked',
      failure_class: 'infrastructure_blocked',
      summary: 'OrbStack transport is unavailable.',
      error: null,
    }), 'planner').failure_class).toBe('infrastructure_blocked');
    expect(parseHarnessResult(validResult({
      status: 'blocked',
      summary: 'The contract forbids this action.',
      error: null,
    }), 'planner').failure_class).toBe('semantic_refusal');
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

  it('r17 教训：case_file 是顶层显式字段，不会被 zod 默认 strip 掉', () => {
    const parsed = parseHarnessResult(validResult({
      decision: { outcome: 'REVISION_REQUESTED', reason: 'blockers open' },
      case_file: {
        blockers: [{
          id: 'R2-1',
          dimension: 'correctness',
          title: 'missing edge case',
          detail: 'no coverage for empty input',
          status: 'open',
          why_not_found_earlier: 'round 1 skipped edge cases',
          prd_gap: 'PRD §3 未覆盖空输入',
        }],
        feedback_md: '# Round 2 review\n\nblocker R2-1 open.',
      },
    }), 'reviewer');

    expect(parsed.case_file).toMatchObject({
      blockers: [{ id: 'R2-1', status: 'open' }],
      feedback_md: '# Round 2 review\n\nblocker R2-1 open.',
    });
  });

  it('case_file 省略时结果不携带该字段（可选字段，不强加空案卷）', () => {
    const parsed = parseHarnessResult(validResult({
      decision: { outcome: 'APPROVED', reason: 'ok' },
    }), 'reviewer');
    expect(parsed.case_file).toBeUndefined();
  });

  it('case_file.blockers 默认 []，缺省字段不报错', () => {
    const parsed = parseHarnessResult(validResult({
      decision: { outcome: 'APPROVED', reason: 'ok' },
      case_file: {},
    }), 'reviewer');
    expect(parsed.case_file).toMatchObject({ blockers: [] });
  });

  it('decision.rubric_scores 结构化字段保留（不是塞进 reason 文本）', () => {
    const parsed = parseHarnessResult(validResult({
      decision: {
        outcome: 'REVISION_REQUESTED',
        reason: 'coverage gap',
        rubric_scores: { correctness: 8, coverage: 5, clarity: 9 },
      },
    }), 'reviewer');
    expect(parsed.decision.rubric_scores).toEqual({
      correctness: 8,
      coverage: 5,
      clarity: 9,
    });
  });

  it('decision.rubric_scores 非数值 record 时报错（zod record(number) 校验）', () => {
    expect(() => parseHarnessResult(validResult({
      decision: {
        outcome: 'APPROVED',
        reason: 'ok',
        rubric_scores: { correctness: 'high' },
      },
    }), 'reviewer')).toThrow();
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
