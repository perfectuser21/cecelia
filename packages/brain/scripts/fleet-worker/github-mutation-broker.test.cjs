'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createGithubMutationBroker,
} = require('./github-mutation-broker.cjs');
const {
  finalizeRoleResult,
} = require('../../../../docker/cecelia-runner/result-channel-finalizer.cjs');

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const BASE = '0123456789abcdef0123456789abcdef01234567';
const HEAD = 'abcdef0123456789abcdef0123456789abcdef01';
const BRANCH = 'cp-07280905-github-broker';
const PATH = 'packages/brain/src/safe.js';

function policy(overrides = {}) {
  return {
    version: 'github-mutation/v1',
    repo: 'perfectuser21/cecelia',
    branch: BRANCH,
    base_sha: BASE,
    expected_remote_sha: null,
    operation: 'push-and-create-draft',
    pr_base: 'main',
    pr_title: 'feat(harness): task-1',
    pr_body: `Kernel task task-1\nRun ${RUN_ID}\n`,
    allowed_paths: ['packages/', 'sprints/'],
    ...overrides,
  };
}

function declaration(overrides = {}) {
  return Buffer.from(`${JSON.stringify({
    contract_version: 'github-mutation-declaration/v1',
    verdict: 'DONE',
    branch: BRANCH,
    head_sha: HEAD,
    ...overrides,
  })}\n`);
}

function providerResult() {
  return Buffer.from(`${JSON.stringify({
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'implementation committed',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: {
      provider: 'codex',
      session_id: 'thread-1',
      credential_ref: '33333333-3333-4333-8333-333333333333',
      credential_copy_mutated: false,
    },
  })}\n`);
}

function state() {
  return {
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    task_id: 'task-1',
    provider: 'codex',
    workspace: {
      repo: 'perfectuser21/cecelia',
      branch: BRANCH,
      base_sha: BASE,
      expected_head_sha: null,
      path: `/controlled/worktrees/${ATTEMPT_ID}`,
      mode: 'read-write',
    },
  };
}

function harness(options = {}) {
  const commands = [];
  const records = options.records ?? [];
  let remote = options.remote ?? '';
  let pullRequest = options.pullRequest ?? null;
  let pushed = 0;
  const git = async (args, commandOptions) => {
    commands.push({ tool: 'git', args: [...args], options: commandOptions });
    const joined = args.join(' ');
    if (joined === 'status --porcelain=v1 -z') return '';
    if (joined === 'branch --show-current') return `${BRANCH}\n`;
    if (joined === 'rev-parse HEAD') return `${HEAD}\n`;
    if (joined === `merge-base --is-ancestor ${BASE} ${HEAD}`) return '';
    if (joined === `diff --name-status -z ${BASE}..${HEAD}`)
      return options.mutation?.nameStatus ?? `M\0${PATH}\0`;
    if (joined === `diff --numstat -z ${BASE}..${HEAD}`)
      return options.mutation?.numstat ?? `1\t0\t${PATH}\0`;
    if (joined === `ls-tree -rz ${HEAD} -- ${PATH}`)
      return options.mutation?.tree ?? `100644 blob ${'a'.repeat(40)}\t${PATH}\0`;
    if (joined === `ls-tree -rz ${BASE} -- ${PATH}`)
      return `100644 blob ${'b'.repeat(40)}\t${PATH}\0`;
    if (joined === `diff --no-ext-diff --unified=0 ${BASE}..${HEAD} -- ${PATH}`)
      return options.mutation?.patch ?? `diff --git a/${PATH} b/${PATH}\n+safe value\n`;
    if (joined === 'remote get-url origin')
      return 'https://github.com/perfectuser21/cecelia.git\n';
    if (joined === `ls-remote --heads origin refs/heads/${BRANCH}`)
      return remote ? `${remote}\trefs/heads/${BRANCH}\n` : '';
    if (args[0] === 'push') {
      pushed += 1;
      if (options.crashAfterPush && pushed === 1) {
        remote = HEAD;
        throw new Error('simulated_crash');
      }
      remote = HEAD;
      return 'ok';
    }
    throw new Error(`unexpected git command: ${joined}`);
  };
  const gh = async (args, commandOptions) => {
    commands.push({ tool: 'gh', args: [...args], options: commandOptions });
    if (args[0] === 'pr' && args[1] === 'list') {
      return JSON.stringify(pullRequest ? [pullRequest] : []);
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      assert.ok(args.includes('--draft'));
      assert.ok(!args.includes('--ready'));
      pullRequest = {
        url: 'https://github.com/perfectuser21/cecelia/pull/4401',
        number: 4401,
        headRefName: BRANCH,
        headRefOid: HEAD,
        state: 'OPEN',
        isDraft: true,
      };
      if (options.crashAfterPrCreate) throw new Error('simulated_crash');
      return `${pullRequest.url}\n`;
    }
    throw new Error(`unexpected gh command: ${args.join(' ')}`);
  };
  const auditStore = {
    async read() {
      return records.map((entry) => ({ ...entry }));
    },
    async append(_attemptId, entry) {
      records.push({ ...entry });
      return entry;
    },
  };
  const broker = createGithubMutationBroker({
    git,
    gh,
    auditStore,
    finalizeRoleResult,
  });
  return {
    broker,
    commands,
    records,
    get remote() { return remote; },
    get pullRequest() { return pullRequest; },
  };
}

async function execute(h, overrides = {}) {
  return h.broker.execute({
    state: state(),
    policy: policy(),
    declarationBytes: declaration(),
    providerResultBytes: providerResult(),
    ...overrides,
  });
}

test('pushes with an exact empty force-with-lease and creates only a draft PR', async () => {
  const h = harness();
  const result = await execute(h);
  assert.equal(h.remote, HEAD);
  assert.equal(result.receipt.stage, 'draft_pr_confirmed');
  assert.equal(result.result.role_result.verified.pull_request.head_sha, HEAD);
  const push = h.commands.find((entry) => entry.tool === 'git' && entry.args[0] === 'push');
  assert.deepEqual(push.args, [
    'push',
    '--porcelain',
    `--force-with-lease=refs/heads/${BRANCH}:`,
    'origin',
    `HEAD:refs/heads/${BRANCH}`,
  ]);
  const create = h.commands.find((entry) => entry.tool === 'gh' && entry.args[1] === 'create');
  assert.ok(create.args.includes('--draft'));
  assert.equal(h.records.map((entry) => entry.stage).join(','), (
    'prepared,push_confirmed,draft_pr_confirmed'
  ));
});

test('never serializes a credential into argv or audit records', async () => {
  const h = harness();
  await execute(h);
  const serialized = JSON.stringify({ commands: h.commands, records: h.records });
  assert.doesNotMatch(serialized, /ghp_|github_pat_|credential_ref|thread-1|secret/i);
  assert.ok(h.commands.every((entry) => Array.isArray(entry.args)));
});

for (const [name, output, code] of [
  ['path outside policy', `M\0docs/escape.md\0`, 'github_mutation_path_not_allowed'],
  ['path traversal', `M\0../escape\0`, 'github_mutation_path_invalid'],
]) {
  test(`rejects ${name} before push`, async () => {
    const h = harness({ mutation: { nameStatus: output } });
    await assert.rejects(execute(h), new RegExp(code));
    assert.equal(h.commands.some((entry) => entry.args[0] === 'push'), false);
  });
}

test('rejects added secrets, symlinks, submodules and binary changes', async () => {
  const cases = [
    ['secret', { patch: '+Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n' }],
    ['symlink', { tree: `120000 blob ${'a'.repeat(40)}\t${PATH}\0` }],
    ['submodule', { tree: `160000 commit ${'a'.repeat(40)}\t${PATH}\0` }],
    ['binary', { numstat: `-\t-\t${PATH}\0` }],
  ];
  for (const [name, mutation] of cases) {
    const h = harness({ mutation });
    await assert.rejects(execute(h), /github_mutation_(?:secret|object|binary)/, name);
  }
});

test('fails closed when remote exists but differs from frozen expected base', async () => {
  const h = harness({ remote: 'f'.repeat(40) });
  await assert.rejects(execute(h), /github_mutation_remote_lease_conflict/);
  assert.equal(h.commands.some((entry) => entry.args[0] === 'push'), false);
});

test('replays crash-before-push from prepared and dedupes crash-after-push', async () => {
  const before = harness();
  before.records.push(await before.broker.buildPrepared({
    state: state(),
    policy: policy(),
    declarationBytes: declaration(),
  }));
  await execute(before);
  assert.equal(before.commands.filter((entry) => entry.args[0] === 'push').length, 1);

  const after = harness({ crashAfterPush: true });
  await assert.rejects(execute(after), /simulated_crash/);
  assert.equal(after.remote, HEAD);
  await execute(after);
  assert.equal(after.commands.filter((entry) => entry.args[0] === 'push').length, 1);
});

test('finds the existing draft after a crash following PR creation', async () => {
  const h = harness({ crashAfterPrCreate: true });
  await assert.rejects(execute(h), /simulated_crash/);
  assert.ok(h.pullRequest);
  const result = await execute(h);
  assert.equal(result.receipt.pull_request.number, 4401);
  assert.equal(h.commands.filter((entry) => (
    entry.tool === 'gh' && entry.args[1] === 'create'
  )).length, 1);
});

test('returns the exact completed receipt without any repeated mutation', async () => {
  const h = harness();
  const first = await execute(h);
  const commandCount = h.commands.length;
  const recordCount = h.records.length;
  const second = await execute(h);
  assert.deepEqual(second, first);
  assert.equal(h.commands.length, commandCount);
  assert.equal(h.records.length, recordCount);
});
