'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildVerifierEnvelope,
  finalizeManagedResult,
  isManagedResultChannel,
} = require('./result-channel-driver.cjs');

const TASK_ID = 'task-result-channel';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const RESULT_FILE = `/tmp/cecelia-prompts/${ATTEMPT_ID}.result.json`;
const SESSION_FILE = `/tmp/cecelia-prompts/${ATTEMPT_ID}.session.json`;
const SPRINT_DIR = 'sprints/07280905-result-channel';
const RUBRIC = Object.freeze({
  dod_machineability: 8,
  scope_match_prd: 8,
  test_is_red: 8,
  internal_consistency: 8,
  risk_registered: 8,
  verification_oracle_completeness: 8,
  ci_workflow_alignment: 8,
});

function providerResult(overrides = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'bounded provider summary',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: {
      provider: 'codex',
      session_id: 'thread-result-channel',
    },
    ...overrides,
  };
}

function pullRequest(overrides = {}) {
  return {
    type: 'pull_request',
    url: 'https://github.com/perfectuser21/cecelia/pull/4391',
    number: 4391,
    head_ref: 'cp-result-channel',
    head_sha: SHA,
    state: 'OPEN',
    ...overrides,
  };
}

function taskBundle(role, inputs = {}, overrides = {}) {
  return {
    contract_version: '1.0',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    hop: 1,
    phase: 'executing',
    role,
    objective: 'Execute exactly one bounded Harness role.',
    skill: `harness-${role}`,
    inputs: {
      task_id: TASK_ID,
      sprint_dir: SPRINT_DIR,
      execution_surface: 'fleet-worker',
      workspace_spec: {
        repo: 'perfectuser21/cecelia',
        base_sha: SHA,
        branch: 'cp-result-channel',
        expected_head_sha: SHA,
        mode: ['reviewer', 'evaluator', 'reporter'].includes(role)
          ? 'read-only'
          : 'read-write',
        run_id: RUN_ID,
        attempt_id: ATTEMPT_ID,
      },
      ...inputs,
    },
    constraints: {
      read_only: ['reviewer', 'evaluator', 'reporter'].includes(role),
      fresh_session: true,
      timeout_seconds: 5400,
    },
    expected_output: `harness-result/${role}-v1`,
    result_channel: {
      version: 'attempt-result-file/v1',
      path: RESULT_FILE,
      max_bytes: 1024 * 1024,
      bindings: {
        task_id: TASK_ID,
        run_id: RUN_ID,
        attempt_id: ATTEMPT_ID,
        role,
      },
    },
    ...overrides,
  };
}

function managedEnv(role, workspacePath, bundleFile, providerFile) {
  return {
    BRAIN_RESULT_CHANNEL_VERSION: 'attempt-result-file/v1',
    BRAIN_RESULT_FILE: RESULT_FILE,
    BRAIN_RESULT_MAX_BYTES: String(1024 * 1024),
    HARNESS_TASK_BUNDLE_FILE: bundleFile,
    HARNESS_ATTEMPT_ID: ATTEMPT_ID,
    HARNESS_RUN_ID: RUN_ID,
    HARNESS_NODE: role,
    HARNESS_TASK_ID: TASK_ID,
    CECELIA_TASK_ID: TASK_ID,
    CECELIA_PROVIDER_RESULT_FILE: providerFile,
    WORKTREE_PATH: workspacePath,
    BRAIN_URL: 'http://brain.internal:5221',
  };
}

function fixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'result-channel-driver-'));
  fs.mkdirSync(path.join(root, SPRINT_DIR, 'tests'), { recursive: true });
  for (const [relative, content] of Object.entries({
    [`${SPRINT_DIR}/sprint-prd.md`]: '# PRD\n',
    [`${SPRINT_DIR}/contract-draft.md`]: '# Contract\n',
    [`${SPRINT_DIR}/contract-dod.md`]: '# DoD\n',
    [`${SPRINT_DIR}/task-plan.json`]: '{"tasks":[]}\n',
    [`${SPRINT_DIR}/tests/contract.test.js`]: 'throw new Error("RED");\n',
    [`${SPRINT_DIR}/harness-report.md`]: '# Harness report\n',
    [`${SPRINT_DIR}/learning.md`]: '# Learning\n',
    [`${SPRINT_DIR}/screenshots/result.png`]: 'png fixture\n',
  })) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function dependencies(overrides = {}) {
  return {
    git: async (_workspace, args) => {
      if (args.join(' ') === 'rev-parse HEAD') return `${SHA}\n`;
      if (args.join(' ') === 'branch --show-current') return 'cp-result-channel\n';
      if (args[0] === 'ls-remote') return `${SHA}\trefs/heads/cp-result-channel\n`;
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    },
    inspectPullRequest: async () => pullRequest(),
    readJudgmentCount: async () => 2,
    readLearningCount: async () => 1,
    readEvaluatorExecution: async () => ({
      task_id: TASK_ID,
      attempt_id: ATTEMPT_ID,
      command: 'npm test',
      exit_code: 0,
      log_tail: '12 tests passed',
    }),
    ...overrides,
  };
}

test('managed mode is selected only by channel-version presence', () => {
  assert.equal(isManagedResultChannel({}), false);
  assert.equal(isManagedResultChannel({ BRAIN_RESULT_FILE: RESULT_FILE }), false);
  assert.equal(isManagedResultChannel({ BRAIN_RESULT_CHANNEL_VERSION: '' }), true);
  assert.equal(
    isManagedResultChannel({ BRAIN_RESULT_CHANNEL_VERSION: 'unknown-version' }),
    true,
  );
});

test('builds mechanically bound verifier envelopes for all six roles', async () => {
  const workspace = fixtureWorkspace();
  const deps = dependencies();
  const cases = [
    {
      role: 'planner',
      bundle: taskBundle('planner'),
      raw: {
        verdict: 'DONE',
        branch: 'cp-result-channel',
        sprint_dir: SPRINT_DIR,
        planner_branch: 'cp-result-channel',
        review_required: true,
        status: 'DONE',
      },
      check: (value) => {
        assert.equal(value.branch, 'cp-result-channel');
        assert.match(value.prd_sha256, /^sha256:[a-f0-9]{64}$/);
        assert.equal(value.effective_review_required, true);
      },
    },
    {
      role: 'proposer',
      bundle: taskBundle('proposer', {
        propose_branch: 'cp-result-channel',
      }),
      raw: {
        propose_branch: 'cp-result-channel',
        workstream_count: 1,
        task_plan_path: `${SPRINT_DIR}/task-plan.json`,
      },
      check: (value) => {
        assert.equal(value.head_sha, SHA);
        assert.deepEqual(
          Object.keys(value.artifacts),
          ['contract_draft', 'contract_dod', 'task_plan', 'contract_tests'],
        );
        assert.match(value.artifacts.contract_tests.sha256, /^sha256:[a-f0-9]{64}$/);
      },
    },
    {
      role: 'reviewer',
      bundle: taskBundle('reviewer', {
        contract_branch: 'cp-result-channel',
        contract_sha: SHA,
      }),
      raw: {
        verdict: 'APPROVED',
        rubric_scores: RUBRIC,
        judgments_written: 2,
        feedback: '',
      },
      check: (value) => {
        assert.equal(value.contract_sha, SHA);
        assert.equal(value.verdict, 'APPROVED');
        assert.equal(value.judgments_written, 2);
      },
    },
    {
      role: 'generator',
      bundle: taskBundle('generator'),
      raw: {
        verdict: 'DONE',
        pr_url: pullRequest().url,
      },
      check: (value) => assert.deepEqual(value.pull_request, pullRequest()),
    },
    {
      role: 'evaluator',
      bundle: taskBundle('evaluator', {
        contract_sha: SHA,
        pull_request: pullRequest(),
      }),
      raw: {
        verdict: 'PASS',
        task_id: TASK_ID,
        attempt_id: ATTEMPT_ID,
        behavior_tests: [{
          command: 'npm test',
          exit_code: 0,
          log_tail: '12 tests passed',
        }],
      },
      check: (value) => {
        assert.equal(value.contract_sha, SHA);
        assert.deepEqual(value.pull_request, pullRequest());
        assert.deepEqual(value.behavior_tests, [{
          command: 'npm test',
          exit_code: 0,
          log_tail: '12 tests passed',
        }]);
      },
    },
    {
      role: 'reporter',
      bundle: taskBundle('reporter'),
      raw: {
        verdict: 'DONE',
        task_id: TASK_ID,
        report_path: `${SPRINT_DIR}/harness-report.md`,
        pr_url: pullRequest({ state: 'MERGED' }).url,
        screenshots: [`${SPRINT_DIR}/screenshots/result.png`],
        concerns: '',
      },
      deps: dependencies({
        inspectPullRequest: async () => pullRequest({ state: 'MERGED' }),
      }),
      check: (value) => {
        assert.equal(value.pull_request.state, 'MERGED');
        assert.match(value.report.sha256, /^sha256:[a-f0-9]{64}$/);
        assert.match(value.learning.sha256, /^sha256:[a-f0-9]{64}$/);
        assert.equal(value.learnings_inserted, 1);
      },
    },
  ];

  for (const entry of cases) {
    const value = await buildVerifierEnvelope({
      bundle: entry.bundle,
      rawEnvelope: entry.raw,
      workspacePath: workspace,
      deps: entry.deps ?? deps,
    });
    entry.check(value);
  }
});

test('reviewer verdict is recomputed from the frozen seven-dimension threshold', async () => {
  const workspace = fixtureWorkspace();
  const lowRubric = { ...RUBRIC, risk_registered: 6 };
  const value = await buildVerifierEnvelope({
    bundle: taskBundle('reviewer', {
      contract_branch: 'cp-result-channel',
      contract_sha: SHA,
    }),
    rawEnvelope: {
      verdict: 'APPROVED',
      rubric_scores: lowRubric,
      judgments_written: 0,
      feedback: '',
    },
    workspacePath: workspace,
    deps: dependencies({ readJudgmentCount: async () => 0 }),
  });

  assert.equal(value.verdict, 'REVISION');
  assert.deepEqual(value.rubric_scores, lowRubric);
});

test('atomically replaces raw result with canonical HarnessResult and writes session separately', async () => {
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.rmSync(RESULT_FILE, { force: true });
  fs.rmSync(SESSION_FILE, { force: true });
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
  const providerFile = path.join(workspace, 'provider-result.json');
  const raw = {
    verdict: 'DONE',
    branch: 'cp-result-channel',
    sprint_dir: SPRINT_DIR,
    planner_branch: 'cp-result-channel',
    review_required: true,
    status: 'DONE',
  };
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({ instruction: 'bounded', task_bundle: taskBundle('planner') }),
    { mode: 0o600 },
  );
  fs.writeFileSync(providerFile, JSON.stringify(providerResult()), { mode: 0o600 });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(raw), { mode: 0o600 });

  const result = await finalizeManagedResult({
    env: managedEnv('planner', workspace, bundleFile, providerFile),
    deps: dependencies(),
  });

  assert.equal(result.role_result.kind, 'planner');
  assert.deepEqual(JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')), result);
  assert.equal(fs.statSync(RESULT_FILE).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')), {
    contract_version: 'provider-session/v1',
    attempt_id: ATTEMPT_ID,
    provider: 'codex',
    session_id: 'thread-result-channel',
  });
  assert.equal(fs.statSync(SESSION_FILE).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(workspace, '.brain-result.json')), false);
});

test('empty, unknown, missing, oversized and authority-mismatched managed inputs fail closed', async () => {
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
  const providerFile = path.join(workspace, 'provider-result.json');
  const raw = {
    verdict: 'DONE',
    branch: 'cp-result-channel',
    sprint_dir: SPRINT_DIR,
    planner_branch: 'cp-result-channel',
    review_required: true,
    status: 'DONE',
  };
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({ instruction: 'bounded', task_bundle: taskBundle('planner') }),
    { mode: 0o600 },
  );
  fs.writeFileSync(providerFile, JSON.stringify(providerResult()), { mode: 0o600 });

  const cases = [
    ['empty version', { BRAIN_RESULT_CHANNEL_VERSION: '' }],
    ['unknown version', { BRAIN_RESULT_CHANNEL_VERSION: 'attempt-result-file/v2' }],
    ['empty result path', { BRAIN_RESULT_FILE: '' }],
    ['wrong result path', { BRAIN_RESULT_FILE: `${RESULT_FILE}.attacker` }],
    ['oversized raw', {}, 'x'.repeat(1024 * 1024 + 1)],
    ['task authority mismatch', { CECELIA_TASK_ID: 'attacker-task' }],
  ];

  for (const [_name, envPatch, rawContents = JSON.stringify(raw)] of cases) {
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, rawContents, { mode: 0o600 });
    const env = { ...managedEnv('planner', workspace, bundleFile, providerFile), ...envPatch };
    await assert.rejects(
      finalizeManagedResult({ env, deps: dependencies() }),
      /result_channel_driver:/,
    );
    assert.equal(fs.existsSync(path.join(workspace, '.brain-result.json')), false);
  }
});

test('unknown authority response shapes fail closed', async () => {
  const workspace = fixtureWorkspace();
  await assert.rejects(
    buildVerifierEnvelope({
      bundle: taskBundle('reviewer', {
        contract_branch: 'cp-result-channel',
        contract_sha: SHA,
      }),
      rawEnvelope: {
        verdict: 'APPROVED',
        rubric_scores: RUBRIC,
        judgments_written: 2,
        feedback: '',
      },
      workspacePath: workspace,
      deps: dependencies({ readJudgmentCount: async () => ({ count: 2 }) }),
    }),
    /result_channel_driver:/,
  );
  await assert.rejects(
    buildVerifierEnvelope({
      bundle: taskBundle('reporter'),
      rawEnvelope: {
        verdict: 'DONE',
        task_id: TASK_ID,
        report_path: `${SPRINT_DIR}/harness-report.md`,
        pr_url: pullRequest().url,
        screenshots: [],
        concerns: '',
      },
      workspacePath: workspace,
      deps: dependencies({ readLearningCount: async () => [] }),
    }),
    /result_channel_driver:/,
  );
});
