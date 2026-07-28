'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  buildVerifierEnvelope,
  defaultExecuteEvaluatorCommand,
  finalizeManagedResult,
  isManagedResultChannel,
  writeManagedSession,
} = require('./result-channel-driver.cjs');

const TASK_ID = 'task-result-channel';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const RESULT_FILE = `/tmp/cecelia-prompts/${ATTEMPT_ID}.result.json`;
const SESSION_FILE = `/tmp/cecelia-prompts/${ATTEMPT_ID}.session.json`;
const PROVIDER_FILE = `/tmp/harness-result-${ATTEMPT_ID}.normalized.json`;
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

function githubReadAuthority(role = 'evaluator', overrides = {}) {
  return {
    schema_version: 'github-read-authority/v1',
    attempt_id: ATTEMPT_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    role,
    request_sha256: 'c'.repeat(64),
    observed_at: '2026-07-28T05:00:00.000Z',
    pull_request: pullRequest(),
    audit_record_sha256: 'd'.repeat(64),
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
        mode: ['reviewer', 'reporter'].includes(role)
          ? 'read-only'
          : 'read-write',
        run_id: RUN_ID,
        attempt_id: ATTEMPT_ID,
      },
      ...(role === 'evaluator' ? { verification_commands: ['npm test'] } : {}),
      ...inputs,
    },
    constraints: {
      read_only: ['reviewer', 'reporter'].includes(role),
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

function managedEnv(role, workspacePath, bundleFile) {
  const bundleSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(bundleFile))
    .digest('hex');
  return {
    BRAIN_RESULT_CHANNEL_VERSION: 'attempt-result-file/v1',
    BRAIN_TASK_BUNDLE_SHA256: bundleSha256,
    BRAIN_RESULT_FILE: RESULT_FILE,
    BRAIN_RESULT_MAX_BYTES: String(1024 * 1024),
    HARNESS_TASK_BUNDLE_FILE: bundleFile,
    HARNESS_ATTEMPT_ID: ATTEMPT_ID,
    HARNESS_RUN_ID: RUN_ID,
    HARNESS_NODE: role,
    HARNESS_READ_ONLY: String(['reviewer', 'reporter'].includes(role)),
    HARNESS_TASK_ID: TASK_ID,
    CECELIA_TASK_ID: TASK_ID,
    CECELIA_EXECUTOR: 'codex',
    BRAIN_PROVIDER_SESSION_ID: 'thread-result-channel',
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

function fixtureGitWorkspace({ symlinkPrd = false } = {}) {
  const root = fixtureWorkspace();
  execFileSync('git', ['init', '-q', '-b', 'cp-result-channel'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Result Channel Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'result-channel@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
  if (symlinkPrd) {
    fs.rmSync(path.join(root, SPRINT_DIR, 'sprint-prd.md'));
    fs.symlinkSync('contract-draft.md', path.join(root, SPRINT_DIR, 'sprint-prd.md'));
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
  });
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const git = async (_workspace, args, options = {}) => {
    if (args.join(' ') === 'remote get-url origin') {
      return 'https://github.com/perfectuser21/cecelia.git\n';
    }
    if (args[0] === 'ls-remote') {
      return `${headSha}\trefs/heads/cp-result-channel\n`;
    }
    return execFileSync('git', ['-C', root, ...args], {
      encoding: options.binary ? null : 'utf8',
      maxBuffer: 1024 * 1024,
    });
  };
  return { root, headSha, git };
}

function dependencies(overrides = {}) {
  return {
    git: async (_workspace, args) => {
      if (args.join(' ') === 'rev-parse HEAD') return `${SHA}\n`;
      if (args.join(' ') === 'branch --show-current') return 'cp-result-channel\n';
      if (args.join(' ') === 'status --porcelain=v1 --untracked-files=all') return '';
      if (args.join(' ') === 'remote get-url origin') {
        return 'https://github.com/perfectuser21/cecelia.git\n';
      }
      if (args[0] === 'ls-remote') return `${SHA}\trefs/heads/cp-result-channel\n`;
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    },
    readGitFile: async (workspace, _headSha, relative) => ({
      mode: '100644',
      bytes: fs.readFileSync(path.join(workspace, relative)),
    }),
    readGitDirectory: async (workspace, _headSha, relative) => {
      const root = path.join(workspace, relative);
      return fs.readdirSync(root).sort().map((name) => ({
        mode: '100644',
        path: `${relative}/${name}`,
        bytes: fs.readFileSync(path.join(root, name)),
      }));
    },
    inspectPullRequest: async () => pullRequest(),
    readJudgmentCount: async () => 2,
    readLearningCount: async () => 1,
    executeEvaluatorCommand: async () => ({
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
      bundle: taskBundle('reporter', {
        pull_request: pullRequest({ state: 'MERGED' }),
      }),
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
  fs.writeFileSync(PROVIDER_FILE, JSON.stringify(providerResult()), { mode: 0o600 });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(raw), { mode: 0o600 });

  const result = await finalizeManagedResult({
    env: managedEnv('planner', workspace, bundleFile),
    providerResultPath: PROVIDER_FILE,
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

test('writes a live provider session handoff without provider result or callback authority', () => {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.rmSync(SESSION_FILE, { force: true });
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({ instruction: 'bounded', task_bundle: taskBundle('planner') }),
    { mode: 0o600 },
  );
  const env = managedEnv('planner', workspace, bundleFile);
  env.CECELIA_EXECUTOR = 'claude';

  writeManagedSession({
    env,
    provider: 'claude',
    sessionId: 'live-session-before-exit',
  });

  assert.deepEqual(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')), {
    contract_version: 'provider-session/v1',
    attempt_id: ATTEMPT_ID,
    provider: 'claude',
    session_id: 'live-session-before-exit',
  });
  assert.equal(fs.statSync(SESSION_FILE).mode & 0o777, 0o600);
});

test('empty, unknown, missing, oversized and authority-mismatched managed inputs fail closed', async () => {
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
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
  fs.writeFileSync(PROVIDER_FILE, JSON.stringify(providerResult()), { mode: 0o600 });

  const cases = [
    ['empty version', { BRAIN_RESULT_CHANNEL_VERSION: '' }],
    ['unknown version', { BRAIN_RESULT_CHANNEL_VERSION: 'attempt-result-file/v2' }],
    ['empty result path', { BRAIN_RESULT_FILE: '' }],
    ['wrong result path', { BRAIN_RESULT_FILE: `${RESULT_FILE}.attacker` }],
    ['oversized raw', {}, 'x'.repeat(1024 * 1024 + 1)],
    ['task authority mismatch', { CECELIA_TASK_ID: 'attacker-task' }],
    ['workspace mode mismatch', { HARNESS_READ_ONLY: 'true' }],
  ];

  for (const [_name, envPatch, rawContents = JSON.stringify(raw)] of cases) {
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, rawContents, { mode: 0o600 });
    const env = { ...managedEnv('planner', workspace, bundleFile), ...envPatch };
    await assert.rejects(
      finalizeManagedResult({
        env,
        providerResultPath: PROVIDER_FILE,
        deps: dependencies(),
      }),
      /result_channel_driver:/,
    );
    assert.equal(fs.existsSync(path.join(workspace, '.brain-result.json')), false);
  }
});

test('successful canary uses the frozen canary contract and does not require a raw role result', async () => {
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, '', { mode: 0o600 });
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
  const canaryBundle = taskBundle('reporter', {}, {
    skill: null,
    expected_output: 'harness-result/canary-v1',
  });
  const canaryProviderResult = providerResult({
    decision: { outcome: 'CANARY_OK', reason: 'transport probe completed' },
  });
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({ instruction: 'bounded', task_bundle: canaryBundle }),
    { mode: 0o600 },
  );
  fs.writeFileSync(PROVIDER_FILE, JSON.stringify(canaryProviderResult), { mode: 0o600 });

  const result = await finalizeManagedResult({
    env: managedEnv('reporter', workspace, bundleFile),
    providerResultPath: PROVIDER_FILE,
    deps: dependencies({
      inspectPullRequest: async () => {
        throw new Error('canary must not inspect a pull request');
      },
    }),
  });

  assert.deepEqual(result, canaryProviderResult);
  assert.equal(Object.hasOwn(result, 'role_result'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')), canaryProviderResult);
});

test('non-success generic terminal result is persisted without raw evidence or role_result', async () => {
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, '', { mode: 0o600 });
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
  const failed = providerResult({
    status: 'failed',
    summary: 'provider process failed',
    error: {
      code: 'provider_exit',
      message: 'bounded stderr',
      exit_code: 1,
    },
  });
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({ instruction: 'bounded', task_bundle: taskBundle('generator') }),
    { mode: 0o600 },
  );
  fs.writeFileSync(PROVIDER_FILE, JSON.stringify(failed), { mode: 0o600 });

  const result = await finalizeManagedResult({
    env: managedEnv('generator', workspace, bundleFile),
    providerResultPath: PROVIDER_FILE,
    deps: dependencies({
      inspectPullRequest: async () => {
        throw new Error('terminal failure must not inspect a pull request');
      },
    }),
  });

  assert.deepEqual(result, failed);
  assert.equal(Object.hasOwn(result, 'role_result'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')), failed);
});

test('canary and non-success pass-through reject unverified side-effect claims', async () => {
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
  const canaryBundle = taskBundle('reporter', {}, {
    skill: null,
    expected_output: 'harness-result/canary-v1',
  });
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({ instruction: 'bounded', task_bundle: canaryBundle }),
    { mode: 0o600 },
  );

  for (const dirty of [
    providerResult({
      decision: { outcome: 'CANARY_OK', reason: '' },
      artifacts: ['unexpected'],
    }),
    providerResult({
      status: 'blocked',
      decision: null,
      artifacts: ['unverified'],
    }),
    providerResult({
      status: 'blocked',
      provider_metadata: {
        provider: 'codex',
        session_id: null,
        credential_copy_mutated: 'false',
      },
    }),
    providerResult({
      status: 'blocked',
      provider_metadata: {
        provider: 'claude',
        session_id: 'forged-session',
      },
    }),
    providerResult({
      status: 'completed_with_concerns',
      decision: { outcome: 'CANARY_OK', reason: '' },
    }),
  ]) {
    fs.writeFileSync(RESULT_FILE, '', { mode: 0o600 });
    fs.writeFileSync(PROVIDER_FILE, JSON.stringify(dirty), { mode: 0o600 });
    await assert.rejects(
      finalizeManagedResult({
        env: managedEnv('reporter', workspace, bundleFile),
        providerResultPath: PROVIDER_FILE,
        deps: dependencies(),
      }),
      /result_channel_driver:/,
    );
  }
});

test('frozen TaskBundle digest rejects provider-time mutation', async () => {
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, '', { mode: 0o600 });
  const workspace = fixtureWorkspace();
  const bundleFile = path.join(workspace, 'task-bundle.json');
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({ instruction: 'bounded', task_bundle: taskBundle('generator') }),
    { mode: 0o600 },
  );
  const env = managedEnv('generator', workspace, bundleFile);
  fs.appendFileSync(bundleFile, ' ');
  fs.writeFileSync(
    PROVIDER_FILE,
    JSON.stringify(providerResult({ status: 'failed', error: { code: 'x', message: 'x' } })),
    { mode: 0o600 },
  );
  await assert.rejects(
    finalizeManagedResult({
      env,
      providerResultPath: PROVIDER_FILE,
      deps: dependencies(),
    }),
    /TaskBundle digest mismatch/,
  );
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
      bundle: taskBundle('reporter', {
        pull_request: pullRequest(),
      }),
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

test('mechanical artifact hashing rejects unbounded workspace evidence', async () => {
  const workspace = fixtureWorkspace();
  fs.truncateSync(path.join(workspace, SPRINT_DIR, 'contract-draft.md'), 16 * 1024 * 1024 + 1);

  await assert.rejects(
    buildVerifierEnvelope({
      bundle: taskBundle('proposer', {
        propose_branch: 'cp-result-channel',
      }),
      rawEnvelope: {
        propose_branch: 'cp-result-channel',
        workstream_count: 1,
        task_plan_path: `${SPRINT_DIR}/task-plan.json`,
      },
      workspacePath: workspace,
      deps: dependencies(),
    }),
    /result_channel_driver:.*evidence byte limit/,
  );
});

test('planner artifacts are hashed from the verified Git object, never the working tree', async () => {
  const fixture = fixtureGitWorkspace();
  const workspace = fixture.root;
  const relative = `${SPRINT_DIR}/sprint-prd.md`;
  const committed = fs.readFileSync(path.join(workspace, relative));
  execFileSync('git', ['update-index', '--assume-unchanged', relative], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, relative), '# provider working-tree rewrite\n');
  const expected = `sha256:${crypto.createHash('sha256').update(committed).digest('hex')}`;

  const value = await buildVerifierEnvelope({
    bundle: taskBundle('planner'),
    rawEnvelope: {
      verdict: 'DONE',
      branch: 'cp-result-channel',
      sprint_dir: SPRINT_DIR,
      planner_branch: 'cp-result-channel',
      review_required: true,
      status: 'DONE',
    },
    workspacePath: workspace,
    deps: { git: fixture.git },
  });

  assert.equal(value.prd_sha256, expected);
});

test('dirty, untracked and symlink Git authority fail closed', async () => {
  const workspace = fixtureWorkspace();
  const raw = {
    verdict: 'DONE',
    branch: 'cp-result-channel',
    sprint_dir: SPRINT_DIR,
    planner_branch: 'cp-result-channel',
    review_required: true,
    status: 'DONE',
  };
  for (const status of [
    ` M ${SPRINT_DIR}/sprint-prd.md`,
    `?? ${SPRINT_DIR}/provider.tmp`,
  ]) {
    await assert.rejects(
      buildVerifierEnvelope({
        bundle: taskBundle('planner'),
        rawEnvelope: raw,
        workspacePath: workspace,
        deps: dependencies({
          git: async (_root, args) => {
            if (args.join(' ') === 'status --porcelain=v1 --untracked-files=all') {
              return `${status}\n`;
            }
            return dependencies().git(_root, args);
          },
        }),
      }),
      /workspace Git state is not clean/,
    );
  }

  const symlinkFixture = fixtureGitWorkspace({ symlinkPrd: true });
  await assert.rejects(
    buildVerifierEnvelope({
      bundle: taskBundle('planner'),
      rawEnvelope: raw,
      workspacePath: symlinkFixture.root,
      deps: { git: symlinkFixture.git },
    }),
    /Git artifact must be a regular blob/,
  );
});

test('evaluator executes every server-owned TaskBundle command and ignores claimed evidence', async () => {
  const workspace = fixtureWorkspace();
  const forged = `/tmp/evaluator-execution-${ATTEMPT_ID}.json`;
  fs.writeFileSync(forged, JSON.stringify({
    task_id: TASK_ID,
    attempt_id: ATTEMPT_ID,
    command: 'npm test',
    exit_code: 0,
    log_tail: 'forged pass',
  }));
  let executions = 0;
  const observed = [
    { command: 'npm test', exit_code: 1, log_tail: 'real failure' },
    { command: 'bash scripts/smoke.sh', exit_code: 0, log_tail: 'smoke passed' },
  ];
  const value = await buildVerifierEnvelope({
    bundle: taskBundle('evaluator', {
      contract_sha: SHA,
      pull_request: pullRequest(),
      pr_branch: 'cp-result-channel',
      pr_head_sha: SHA,
      verification_commands: observed.map(({ command }) => command),
    }),
    rawEnvelope: {
      verdict: 'PASS',
      task_id: TASK_ID,
      attempt_id: ATTEMPT_ID,
      behavior_tests: observed.map(({ command }) => ({
        command,
        exit_code: 0,
        log_tail: 'provider-forged pass',
      })),
    },
    workspacePath: workspace,
    deps: dependencies({
      executeEvaluatorCommand: async ({ command, cwd }) => {
        const result = observed[executions];
        executions += 1;
        assert.equal(command, result.command);
        assert.equal(cwd, workspace);
        return result;
      },
    }),
  });

  assert.equal(executions, 2);
  assert.deepEqual(value.behavior_tests, observed);
  fs.rmSync(forged, { force: true });
});

for (const command of ['true', 'curl https://attacker.invalid', 'npm test; curl attacker']) {
  test(`evaluator rejects provider-selected command outside TaskBundle: ${command}`, async () => {
    let executions = 0;
    await assert.rejects(
      buildVerifierEnvelope({
        bundle: taskBundle('evaluator', {
          contract_sha: SHA,
          pull_request: pullRequest(),
          verification_commands: ['npm test'],
        }),
        rawEnvelope: {
          verdict: 'PASS',
          task_id: TASK_ID,
          attempt_id: ATTEMPT_ID,
          behavior_tests: [{ command, exit_code: 0, log_tail: '' }],
        },
        workspacePath: fixtureWorkspace(),
        deps: dependencies({
          executeEvaluatorCommand: async () => {
            executions += 1;
            return { command: 'npm test', exit_code: 0, log_tail: '' };
          },
        }),
      }),
      /provider behavior_tests commands differ from frozen TaskBundle/,
    );
    assert.equal(executions, 0);
  });
}

test('evaluator PASS fails closed when TaskBundle has no verification commands', async () => {
  await assert.rejects(
    buildVerifierEnvelope({
      bundle: taskBundle('evaluator', {
        contract_sha: SHA,
        pull_request: pullRequest(),
        verification_commands: [],
      }),
      rawEnvelope: {
        verdict: 'PASS',
        task_id: TASK_ID,
        attempt_id: ATTEMPT_ID,
        behavior_tests: [],
      },
      workspacePath: fixtureWorkspace(),
      deps: dependencies(),
    }),
    /TaskBundle verification_commands must be non-empty/,
  );
});

test('production Evaluator consumes the Worker authority file and never invokes gh', async (t) => {
  const workspace = fixtureWorkspace();
  const authorityFile = path.join(workspace, 'github-read-authority.json');
  const ghMarker = path.join(workspace, 'gh-invoked');
  const fakeBin = path.join(workspace, 'fake-bin');
  fs.mkdirSync(fakeBin);
  const fakeGh = path.join(fakeBin, 'gh');
  fs.writeFileSync(fakeGh, `#!/bin/sh\nprintf invoked > ${JSON.stringify(ghMarker)}\nexit 97\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(authorityFile, JSON.stringify(githubReadAuthority()), {
    mode: 0o600,
  });
  const injected = dependencies();
  delete injected.inspectPullRequest;

  const value = await buildVerifierEnvelope({
    bundle: taskBundle('evaluator', {
      contract_sha: SHA,
      pull_request: pullRequest(),
      pr_branch: 'cp-result-channel',
      pr_head_sha: SHA,
    }),
    rawEnvelope: {
      verdict: 'PASS',
      task_id: TASK_ID,
      attempt_id: ATTEMPT_ID,
      behavior_tests: [],
    },
    workspacePath: workspace,
    deps: injected,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      HARNESS_GITHUB_READ_AUTHORITY_FILE: authorityFile,
      HARNESS_ATTEMPT_ID: ATTEMPT_ID,
      HARNESS_RUN_ID: RUN_ID,
      HARNESS_TASK_ID: TASK_ID,
      HARNESS_NODE: 'evaluator',
    },
  });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  assert.deepEqual(value.pull_request, pullRequest());
  assert.equal(fs.existsSync(ghMarker), false);
});

test('production Evaluator fails closed on missing or conflicting Worker authority', async () => {
  const workspace = fixtureWorkspace();
  const injected = dependencies();
  delete injected.inspectPullRequest;
  const base = {
    bundle: taskBundle('evaluator', {
      contract_sha: SHA,
      pull_request: pullRequest(),
      pr_branch: 'cp-result-channel',
      pr_head_sha: SHA,
    }),
    rawEnvelope: {
      verdict: 'PASS',
      task_id: TASK_ID,
      attempt_id: ATTEMPT_ID,
      behavior_tests: [],
    },
    workspacePath: workspace,
    deps: injected,
    env: {
      HARNESS_ATTEMPT_ID: ATTEMPT_ID,
      HARNESS_RUN_ID: RUN_ID,
      HARNESS_TASK_ID: TASK_ID,
      HARNESS_NODE: 'evaluator',
    },
  };

  await assert.rejects(buildVerifierEnvelope(base), /GitHub read authority/);
  const authorityFile = path.join(workspace, 'github-read-authority.json');
  fs.writeFileSync(authorityFile, JSON.stringify(githubReadAuthority('evaluator', {
    pull_request: pullRequest({ head_sha: 'f'.repeat(40) }),
  })));
  await assert.rejects(
    buildVerifierEnvelope({
      ...base,
      env: {
        ...base.env,
        HARNESS_GITHUB_READ_AUTHORITY_FILE: authorityFile,
      },
    }),
    /pull request differs from frozen TaskBundle authority/,
  );
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('Runner-owned evaluator execution kills its own background process group', async () => {
  const workspace = fixtureWorkspace();
  const pidFile = path.join(os.tmpdir(), `runner-evaluator-child-${process.pid}.pid`);
  fs.rmSync(pidFile, { force: true });
  const command = `sleep 30 >/dev/null 2>&1 & echo $! > ${JSON.stringify(pidFile)}`;
  const injected = dependencies();
  delete injected.executeEvaluatorCommand;

  await buildVerifierEnvelope({
    bundle: taskBundle('evaluator', {
      contract_sha: SHA,
      pull_request: pullRequest(),
      pr_branch: 'cp-result-channel',
      pr_head_sha: SHA,
      verification_commands: [command],
    }),
    rawEnvelope: {
      verdict: 'PASS',
      task_id: TASK_ID,
      attempt_id: ATTEMPT_ID,
      behavior_tests: [{ command, exit_code: 0, log_tail: '' }],
    },
    workspacePath: workspace,
    deps: injected,
  });

  const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.ok(Number.isInteger(childPid) && childPid > 1);
  let alive = true;
  for (let attempt = 0; attempt < 200 && alive; attempt += 1) {
    try {
      const state = execFileSync(
        'ps',
        ['-o', 'state=', '-p', String(childPid)],
        { encoding: 'utf8' },
      ).trim();
      alive = state !== '' && !['Z', 'X'].includes(state[0]);
    } catch (error) {
      if (error?.status !== 1) throw error;
      alive = false;
    }
    if (alive) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(alive, false);
  fs.rmSync(pidFile, { force: true });
});

test('Runner-owned evaluator command has a bounded timeout', async () => {
  assert.equal(typeof defaultExecuteEvaluatorCommand, 'function');
  await assert.rejects(
    defaultExecuteEvaluatorCommand({
      command: 'sleep 30',
      cwd: fixtureWorkspace(),
      timeoutMs: 25,
    }),
    /timed out or exceeded output bounds/,
  );
});
