const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const test = require('node:test');

const REPO = resolve(__dirname, '../..');
const HELPER_SOURCE = join(REPO, 'docker/cecelia-runner/raw-result-writer.cjs');
const INSTALLED_HELPER = '/usr/local/bin/raw-result-writer.cjs';
const SKILLS = {
  planner: {
    path: 'packages/workflows/skills/harness-planner/SKILL.md',
    version: '8.17.0',
  },
  proposer: {
    path: 'packages/workflows/skills/harness-contract-proposer/SKILL.md',
    version: '9.17.0',
  },
  reviewer: {
    path: 'packages/workflows/skills/harness-contract-reviewer/SKILL.md',
    version: '9.7.1',
  },
  generator: {
    path: 'packages/workflows/skills/harness-generator/SKILL.md',
    version: '7.13.0',
  },
  evaluator: {
    path: 'packages/workflows/skills/harness-evaluator/SKILL.md',
    version: '1.32.4',
  },
  report: {
    path: 'packages/workflows/skills/harness-report/SKILL.md',
    version: '6.9.1',
  },
};

const RUBRIC = {
  dod_machineability: 8,
  scope_match_prd: 8,
  test_is_red: 8,
  internal_consistency: 8,
  risk_registered: 8,
  verification_oracle_completeness: 8,
  ci_workflow_alignment: 8,
};

function skillSource(role) {
  return readFileSync(join(REPO, SKILLS[role].path), 'utf8');
}

function writerSource(role) {
  const source = skillSource(role);
  const start = `# ${role}-result-writer:start`;
  const end = `# ${role}-result-writer:end`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  assert.notEqual(startIndex, -1, `${role} writer start marker missing`);
  assert.notEqual(endIndex, -1, `${role} writer end marker missing`);
  assert.ok(endIndex > startIndex, `${role} writer markers out of order`);
  const writer = source.slice(startIndex + start.length, endIndex);
  assert.match(writer, /\/usr\/local\/bin\/raw-result-writer\.cjs/);
  return writer.replaceAll(INSTALLED_HELPER, HELPER_SOURCE);
}

function evaluatorTerminalBodies() {
  return [...skillSource('evaluator').matchAll(
    /EVALUATOR_VERDICT=FAIL\n(?:(?!EVALUATOR_VERDICT=FAIL)[\s\S])*?exit [01]/g,
  )].map((match) => match[0]);
}

function baseEnv(workspace) {
  return {
    ...process.env,
    WORKSPACE_PATH: workspace,
    WORKSPACE: workspace,
    TASK_ID: '44444444-4444-4444-8444-444444444444',
    HARNESS_ATTEMPT_ID: '22222222-2222-4222-8222-222222222222',
    SPRINT_DIR: 'sprints/07280905-result-writer',
    BRANCH: 'cp-planner-result',
    PLANNER_BRANCH: 'cp-planner-result',
    REVIEW_REQUIRED: 'true',
    PLANNER_VERDICT: 'DONE',
    PLANNER_STATUS: 'DONE',
    PROPOSE_BRANCH: 'cp-harness-propose-r1-44444444-a2',
    REVIEWER_VERDICT: 'APPROVED',
    RUBRIC_SCORES_JSON: JSON.stringify(RUBRIC),
    JUDGMENTS_WRITTEN: '1',
    FEEDBACK: '',
    GENERATOR_VERDICT: 'DONE',
    PR_URL: 'https://github.com/perfectuser21/cecelia/pull/4391',
    HARNESS_GITHUB_MUTATION_BRANCH: 'cp-result-channel',
    HARNESS_GITHUB_MUTATION_HEAD_SHA: '0123456789abcdef0123456789abcdef01234567',
    FIXES_JSON: '["fixed callback binding"]',
    FAILURE_REASON: 'bounded repair budget exhausted',
    EVALUATOR_VERDICT: 'PASS',
    FAILED_STEP: '',
    LOG_EXCERPT: '',
    BEHAVIOR_TESTS_JSON: JSON.stringify([{
      command: 'npm test',
      exit_code: 0,
      log_tail: 'green',
    }]),
    SCREENSHOTS_JSON: '[]',
    CASCADE_ASSERTIONS: '[]',
    REPORT_VERDICT: 'DONE',
    CONCERNS: '',
  };
}

function runWriter(role, overrides = {}, { runtime = true, symlink = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), `skill-writer-${role}-`));
  const workspace = join(root, 'workspace');
  const runtimeDir = join(root, 'runtime');
  mkdirSync(workspace);
  mkdirSync(runtimeDir);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'kernel-test@example.invalid'], {
    cwd: workspace,
  });
  execFileSync('git', ['config', 'user.name', 'Kernel Test'], { cwd: workspace });
  execFileSync('git', [
    '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture',
  ], {
    cwd: workspace,
  });
  execFileSync('git', ['checkout', '-qb', 'cp-result-channel'], {
    cwd: workspace,
  });
  const script = join(root, `${role}-writer.sh`);
  writeFileSync(script, writerSource(role), { mode: 0o700 });
  const attemptId = randomUUID();
  const resultFile = runtime
    ? `/tmp/cecelia-prompts/${attemptId}.result.json`
    : join(workspace, '.brain-result.json');
  const env = { ...baseEnv(workspace), ...overrides };
  env.HARNESS_ATTEMPT_ID = attemptId;
  if (runtime) {
    mkdirSync('/tmp/cecelia-prompts', { recursive: true });
    env.BRAIN_RESULT_CHANNEL_VERSION = 'attempt-result-file/v1';
    env.BRAIN_RESULT_MAX_BYTES = '1048576';
    env.BRAIN_RESULT_FILE = resultFile;
    if (!symlink) writeFileSync(resultFile, '', { mode: 0o600 });
  }
  else delete env.BRAIN_RESULT_FILE;
  let victim = null;
  if (symlink) {
    victim = join(root, 'victim.json');
    writeFileSync(victim, '{"safe":true}\n');
    symlinkSync(victim, resultFile);
  }
  chmodSync(workspace, runtime ? 0o555 : 0o755);
  const execution = spawnSync('bash', [script], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  chmodSync(workspace, 0o755);
  return { attemptId, execution, resultFile, victim };
}

function readResult(run) {
  assert.equal(run.execution.status, 0, run.execution.stderr);
  assert.doesNotMatch(run.execution.stdout, /\{\s*"verdict"/);
  if (run.resultFile.startsWith('/tmp/cecelia-prompts/')) {
    assert.equal(statSync(run.resultFile).mode & 0o777, 0o600);
  }
  return JSON.parse(readFileSync(run.resultFile, 'utf8'));
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

test('all six production Skills expose exactly one executable writer marker and patch version', () => {
  for (const [role, definition] of Object.entries(SKILLS)) {
    const source = skillSource(role);
    assert.equal(source.split(`# ${role}-result-writer:start`).length - 1, 1);
    assert.equal(source.split(`# ${role}-result-writer:end`).length - 1, 1);
    assert.match(source, new RegExp(`version: ${definition.version.replaceAll('.', '\\.')}`));
    assert.match(source, new RegExp(`- ${definition.version.replaceAll('.', '\\.')}:`));
    const writer = writerSource(role);
    assert.equal(
      source.split('/usr/local/bin/raw-result-writer.cjs').length - 1,
      1,
      `${role} has a second managed writer path`,
    );
    assert.match(
      writer,
      /if \[ "\$\{BRAIN_RESULT_CHANNEL_VERSION\+x\}" = x \] \|\| \[ "\$\{BRAIN_RESULT_FILE\+x\}" = x \]/,
    );
    assert.match(writer, /printf '%s' "\$RAW_RESULT_JSON" \| node/);
    assert.ok(writer.trim().length > 0);
  }
});

test('Fleet evaluator and reporter prohibit provider-owned GitHub reads', () => {
  for (const role of ['evaluator', 'report']) {
    const source = skillSource(role);
    assert.match(source, /Worker-owned GitHub read authority/);
    assert.match(source, /execution_surface=fleet-worker/);
    assert.match(source, /禁止(?:直接)?执行 `gh`/);
    assert.match(source, /GH_TOKEN/);
    assert.match(source, /GITHUB_TOKEN/);
    assert.match(source, /HARNESS_GITHUB_READ_AUTHORITY_FILE/);
    assert.match(source, /fail-closed/);
  }
});

test('channel-version presence cannot fall back when BRAIN_RESULT_FILE is absent', () => {
  for (const role of Object.keys(SKILLS)) {
    for (const channelVersion of ['', 'attempt-result-file/v1', 'unknown']) {
      const run = runWriter(role, {
        BRAIN_RESULT_CHANNEL_VERSION: channelVersion,
        BRAIN_RESULT_MAX_BYTES: '1048576',
      }, { runtime: false });
      assert.notEqual(
        run.execution.status,
        0,
        `${role} fell back with explicit channel version ${JSON.stringify(channelVersion)}`,
      );
      assert.match(run.execution.stderr, /BRAIN_RESULT_(?:CHANNEL_VERSION|FILE)/);
    }
  }
});

test('generator setup failures never emit legacy ABORTED JSON in an explicit channel', () => {
  const source = skillSource('generator');
  const guardedAborts = source.match(
    /if \[ "\$\{BRAIN_RESULT_CHANNEL_VERSION\+x\}" != x \] && \[ "\$\{BRAIN_RESULT_FILE\+x\}" != x \]; then\n\s+echo "\{\\"verdict\\": \\"ABORTED\\"/g,
  ) ?? [];
  assert.equal(guardedAborts.length, 2);
});

test('evaluator terminal branches cannot directly bypass its unique writer', () => {
  const source = skillSource('evaluator');
  const start = source.indexOf('# evaluator-result-writer:start');
  const end = source.indexOf('# evaluator-result-writer:end');
  const withoutWriter = `${source.slice(0, start)}${source.slice(
    end + '# evaluator-result-writer:end'.length,
  )}`;
  assert.doesNotMatch(
    withoutWriter,
    /(?:cat\s*>|>\s*)\s*["']?\$WORKSPACE\/\.brain-result\.json/,
  );
});

test('every executable evaluator early terminal writes through the shared writer before exit', () => {
  const bodies = evaluatorTerminalBodies();
  assert.ok(bodies.length >= 14, `only found ${bodies.length} evaluator terminals`);
  for (const body of bodies) {
    assert.match(body, /write_evaluator_result\n[\s\S]*exit [01]/);
  }
});

test('real evaluator early terminal bodies execute the managed writer before exit', () => {
  const writer = writerSource('evaluator');
  for (const [index, body] of evaluatorTerminalBodies().entries()) {
    const root = mkdtempSync(join(tmpdir(), `evaluator-terminal-${index}-`));
    const script = join(root, 'terminal.sh');
    writeFileSync(
      script,
      `EVALUATOR_RESULT_WRITER_DEFER=1\n${writer}\n${body}\n`,
      { mode: 0o700 },
    );
    const attemptId = randomUUID();
    const resultFile = `/tmp/cecelia-prompts/${attemptId}.result.json`;
    mkdirSync('/tmp/cecelia-prompts', { recursive: true });
    writeFileSync(resultFile, '', { mode: 0o600 });
    const execution = spawnSync('bash', [script], {
      env: {
        ...baseEnv(root),
        BRAIN_RESULT_CHANNEL_VERSION: 'attempt-result-file/v1',
        BRAIN_RESULT_MAX_BYTES: '1048576',
        BRAIN_RESULT_FILE: resultFile,
        HARNESS_ATTEMPT_ID: attemptId,
      },
      encoding: 'utf8',
    });
    assert.ok(
      execution.status === 0 || execution.status === 1,
      `terminal ${index}: ${execution.stderr}`,
    );
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    assert.equal(result.verdict, 'FAIL', `terminal ${index}`);
    unlinkSync(resultFile);
  }
});

test('BRAIN_RESULT_FILE lets every writer finalize outside a read-only workspace with mode 0600', () => {
  for (const role of Object.keys(SKILLS)) {
    const result = readResult(runWriter(role));
    assert.equal(typeof result, 'object', role);
  }
});

test('legacy planner and generator remain stdout-only when BRAIN_RESULT_FILE is unset', () => {
  for (const role of ['planner', 'generator']) {
    const run = runWriter(role, {}, { runtime: false });
    assert.equal(run.execution.status, 0, run.execution.stderr);
    assert.deepEqual(typeof JSON.parse(run.execution.stdout), 'object');
    assert.equal(lstatSafe(run.resultFile), null);
  }
});

test('legacy file writers preserve their original role-specific fallback', () => {
  const expectedFallback = {
    proposer: '${WORKSPACE_PATH:-/workspace}/.brain-result.json',
    reviewer: '/workspace/.brain-result.json',
    evaluator: '$WORKSPACE/.brain-result.json',
    report: 'git rev-parse --show-toplevel',
  };
  for (const [role, fallback] of Object.entries(expectedFallback)) {
    assert.ok(writerSource(role).includes(fallback), `${role} legacy fallback drifted`);
  }
  for (const role of ['proposer', 'evaluator', 'report']) {
    const run = runWriter(role, {}, { runtime: false });
    const result = JSON.parse(readFileSync(run.resultFile, 'utf8'));
    assert.equal(run.execution.status, 0, run.execution.stderr);
    assert.equal(typeof result, 'object', role);
  }
});

test('every writer rejects a symlink result target without following or replacing it', () => {
  for (const role of Object.keys(SKILLS)) {
    const run = runWriter(role, {}, { symlink: true });
    assert.notEqual(run.execution.status, 0, `${role} accepted a symlink result target`);
    assert.equal(lstatSync(run.resultFile).isSymbolicLink(), true);
    assert.equal(readFileSync(run.victim, 'utf8'), '{"safe":true}\n');
    unlinkSync(run.resultFile);
  }
});

test('planner raw result includes status and review_required with exact keys', () => {
  const result = readResult(runWriter('planner'));
  assert.deepEqual(Object.keys(result).sort(), [
    'branch',
    'planner_branch',
    'review_required',
    'sprint_dir',
    'status',
    'verdict',
  ]);
  assert.deepEqual(result, {
    verdict: 'DONE',
    branch: 'cp-planner-result',
    sprint_dir: 'sprints/07280905-result-writer',
    planner_branch: 'cp-planner-result',
    review_required: true,
    status: 'DONE',
  });
});

test('proposer raw result keeps its exact three-field contract', () => {
  const result = readResult(runWriter('proposer'));
  assert.deepEqual(result, {
    propose_branch: 'cp-harness-propose-r1-44444444-a2',
    workstream_count: 1,
    task_plan_path: 'sprints/07280905-result-writer/task-plan.json',
  });
});

test('reviewer writes exact APPROVED and REVISION raw shapes', () => {
  for (const [verdict, judgments, feedback] of [
    ['APPROVED', '1', ''],
    ['REVISION', '0', '补齐接缝断言'],
  ]) {
    const result = readResult(runWriter('reviewer', {
      REVIEWER_VERDICT: verdict,
      JUDGMENTS_WRITTEN: judgments,
      FEEDBACK: feedback,
    }));
    assert.deepEqual(Object.keys(result).sort(), [
      'feedback',
      'judgments_written',
      'rubric_scores',
      'verdict',
    ]);
    assert.equal(result.verdict, verdict);
    assert.equal(result.judgments_written, Number(judgments));
    assert.deepEqual(result.rubric_scores, RUBRIC);
  }
});

test('generator writes exact managed mutation declarations and legacy PR shapes', () => {
  const cases = [
    ['DONE', ['branch', 'contract_version', 'head_sha', 'verdict']],
    ['FIXED', ['branch', 'contract_version', 'fixes', 'head_sha', 'verdict']],
  ];
  for (const [verdict, keys] of cases) {
    const result = readResult(runWriter('generator', {
      GENERATOR_VERDICT: verdict,
    }));
    assert.deepEqual(Object.keys(result).sort(), keys);
    assert.equal(result.verdict, verdict);
    assert.equal(result.branch, 'cp-result-channel');
    assert.match(result.head_sha, /^[a-f0-9]{40}$/);
    assert.equal(result.pr_url, undefined);
    if (verdict === 'FIXED') assert.deepEqual(result.fixes, ['fixed callback binding']);
  }

  for (const verdict of ['DONE', 'FIXED', 'FAILED']) {
    const legacy = runWriter('generator', { GENERATOR_VERDICT: verdict }, {
      runtime: false,
    });
    const result = JSON.parse(legacy.execution.stdout);
    assert.equal(result.verdict, verdict);
    assert.equal(result.pr_url, 'https://github.com/perfectuser21/cecelia/pull/4391');
  }

  const failed = runWriter('generator', { GENERATOR_VERDICT: 'FAILED' });
  assert.notEqual(failed.execution.status, 0);
  assert.match(failed.execution.stderr, /requires DONE or FIXED/);

  const wrongBranch = runWriter('generator', {
    HARNESS_GITHUB_MUTATION_BRANCH: 'cp-other-branch',
  });
  assert.notEqual(wrongBranch.execution.status, 0);
  assert.match(wrongBranch.execution.stderr, /frozen mutation branch mismatch/);
});

test('managed generator instructions prohibit provider-owned GitHub mutation before legacy push', () => {
  const source = skillSource('generator');
  const override = source.indexOf('## Managed Kernel GitHub mutation override');
  const legacyPush = source.indexOf('git push origin HEAD');
  assert.ok(override > 0 && override < legacyPush);
  assert.match(source.slice(override, legacyPush), /禁止执行 `git push`、`gh pr create`/);
});

test('evaluator writes file-owned PASS and FAIL evidence instead of stdout JSON', () => {
  const passRun = runWriter('evaluator');
  const pass = readResult(passRun);
  assert.equal(pass.verdict, 'PASS');
  assert.equal(pass.task_id, '44444444-4444-4444-8444-444444444444');
  assert.equal(pass.attempt_id, passRun.attemptId);
  assert.deepEqual(pass.behavior_tests, [{
    command: 'npm test',
    exit_code: 0,
    log_tail: 'green',
  }]);

  const fail = readResult(runWriter('evaluator', {
    EVALUATOR_VERDICT: 'FAIL',
    FAILED_STEP: 'Step 4',
    LOG_EXCERPT: 'expected receipt, got none',
    BEHAVIOR_TESTS_JSON: '[]',
  }));
  assert.equal(fail.verdict, 'FAIL');
  assert.equal(fail.failed_step, 'Step 4');
  assert.equal(fail.log_excerpt, 'expected receipt, got none');
});

test('report writer preserves the exact reporter raw result shape', () => {
  const result = readResult(runWriter('report'));
  assert.deepEqual(Object.keys(result).sort(), [
    'concerns',
    'pr_url',
    'report_path',
    'screenshots',
    'task_id',
    'verdict',
  ]);
  assert.equal(result.verdict, 'DONE');
  assert.equal(result.report_path, 'sprints/07280905-result-writer/harness-report.md');
});
