import { describe, it, expect } from 'vitest';
import {
  parseTaskBundle,
  parseHarnessResult,
  toKernelStatus,
  TASK_CONTRACT_VERSION,
  RESULT_CONTRACT_VERSION,
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

    expect(parseTaskBundle(bundle).inputs.workspace_spec).toEqual(validWorkspaceSpec());
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
});

describe('HarnessResult contract', () => {
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
});
