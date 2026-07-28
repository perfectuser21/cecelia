'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createFileGithubReadAuditStore,
  createGithubReadBroker,
} = require('./github-read-broker.cjs');

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = 'task-github-read';
const HEAD_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const POLICY = Object.freeze({
  version: 'github-read/v1',
  repo: 'perfectuser21/cecelia',
  url: 'https://github.com/perfectuser21/cecelia/pull/4391',
  number: 4391,
  head_ref: 'cp-result-channel',
  head_sha: HEAD_SHA,
  allowed_states: Object.freeze(['OPEN']),
});
const GH_FACT = Object.freeze({
  url: POLICY.url,
  number: POLICY.number,
  headRefName: POLICY.head_ref,
  headRefOid: POLICY.head_sha,
  state: 'OPEN',
});

function memoryAudit(initial = []) {
  const records = [...initial];
  return {
    records,
    read: async () => records.map((record) => structuredClone(record)),
    append: async (_attemptId, record) => {
      records.push(structuredClone(record));
      return record;
    },
  };
}

function input(overrides = {}) {
  return {
    attemptId: ATTEMPT_ID,
    taskId: TASK_ID,
    runId: RUN_ID,
    role: 'evaluator',
    policy: POLICY,
    ...overrides,
  };
}

function harness(overrides = {}) {
  const auditStore = overrides.auditStore ?? memoryAudit();
  const calls = [];
  const gh = overrides.gh ?? (async (args) => {
    calls.push([...args]);
    return JSON.stringify(GH_FACT);
  });
  return {
    calls,
    auditStore,
    broker: createGithubReadBroker({
      gh,
      auditStore,
      now: () => '2026-07-28T05:00:00.000Z',
    }),
  };
}

test('observes only the exact frozen PR through argv and appends public authority', async () => {
  const h = harness();

  const authority = await h.broker.observe(input());

  assert.deepEqual(h.calls, [[
    'pr', 'view', '4391',
    '--repo', 'perfectuser21/cecelia',
    '--json', 'url,number,headRefName,headRefOid,state',
  ]]);
  assert.deepEqual(authority.pull_request, {
    type: 'pull_request',
    url: POLICY.url,
    number: POLICY.number,
    head_ref: POLICY.head_ref,
    head_sha: POLICY.head_sha,
    state: 'OPEN',
  });
  assert.equal(authority.schema_version, 'github-read-authority/v1');
  assert.match(authority.request_sha256, /^[a-f0-9]{64}$/);
  assert.match(authority.audit_record_sha256, /^[a-f0-9]{64}$/);
  assert.equal(h.auditStore.records.length, 1);
  assert.equal(h.auditStore.records[0].previous_sha256, null);
  assert.equal(h.auditStore.records[0].record_sha256, authority.audit_record_sha256);
  assert.doesNotMatch(JSON.stringify(h.auditStore.records), /token|credential|authorization/i);
});

test('returns the exact recorded authority on replay without another GitHub call', async () => {
  const h = harness();
  const first = await h.broker.observe(input());
  const second = await h.broker.observe(input());

  assert.deepEqual(second, first);
  assert.equal(h.calls.length, 1);
  assert.equal(h.auditStore.records.length, 1);
});

test('retries a read after a crash before durable append', async () => {
  const auditStore = memoryAudit();
  let appendCalls = 0;
  auditStore.append = async (_attemptId, record) => {
    appendCalls += 1;
    if (appendCalls === 1) throw new Error('simulated_crash_before_append');
    auditStore.records.push(structuredClone(record));
  };
  const h = harness({ auditStore });

  await assert.rejects(h.broker.observe(input()), /simulated_crash_before_append/);
  const recovered = await h.broker.observe(input());

  assert.equal(h.calls.length, 2);
  assert.equal(recovered.pull_request.head_sha, HEAD_SHA);
  assert.equal(auditStore.records.length, 1);
});

test('fails a conflicting replay closed before GitHub access', async () => {
  const h = harness();
  await h.broker.observe(input());

  await assert.rejects(
    h.broker.observe(input({
      policy: { ...POLICY, head_sha: 'f'.repeat(40) },
    })),
    /github_read_audit_conflict/,
  );
  assert.equal(h.calls.length, 1);
});

for (const [name, fact] of [
  ['URL', { ...GH_FACT, url: 'https://github.com/perfectuser21/cecelia/pull/4392' }],
  ['number', { ...GH_FACT, number: 4392 }],
  ['head ref', { ...GH_FACT, headRefName: 'cp-attacker' }],
  ['head SHA', { ...GH_FACT, headRefOid: 'f'.repeat(40) }],
  ['state', { ...GH_FACT, state: 'MERGED' }],
  ['unknown field', { ...GH_FACT, token: 'secret' }],
]) {
  test(`rejects a GitHub response with mismatched ${name}`, async () => {
    const h = harness({ gh: async () => JSON.stringify(fact) });
    await assert.rejects(
      h.broker.observe(input()),
      /github_read_(?:response|binding)_invalid/,
    );
    assert.equal(h.auditStore.records.length, 0);
  });
}

test('rejects oversized and malformed GitHub output', async () => {
  for (const output of ['{', 'x'.repeat(65_537)]) {
    const h = harness({ gh: async () => output });
    await assert.rejects(h.broker.observe(input()), /github_read_response_invalid/);
  }
});

test('accepts only evaluator and reporter exact axes', async () => {
  for (const role of ['generator', 'judge', 'reporter\n']) {
    const h = harness();
    await assert.rejects(h.broker.observe(input({ role })), /github_read_request_invalid/);
    assert.equal(h.calls.length, 0);
  }
  const reporter = harness();
  await assert.doesNotReject(reporter.broker.observe(input({ role: 'reporter' })));
});

test('persists one mode-0600 no-symlink audit root record', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-read-audit-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createFileGithubReadAuditStore({ auditRoot: root });
  const h = harness({ auditStore: store });

  await h.broker.observe(input());

  const journal = path.join(root, `${ATTEMPT_ID}.jsonl`);
  assert.equal(fs.lstatSync(journal).mode & 0o777, 0o600);
  assert.equal(fs.lstatSync(journal).isSymbolicLink(), false);
  assert.equal((await store.read(ATTEMPT_ID)).length, 1);
});

test('detects audit tampering and an unsafe audit root', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-read-audit-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createFileGithubReadAuditStore({ auditRoot: root });
  const h = harness({ auditStore: store });
  await h.broker.observe(input());
  const journal = path.join(root, `${ATTEMPT_ID}.jsonl`);
  const record = JSON.parse(fs.readFileSync(journal, 'utf8'));
  record.pull_request.head_sha = 'f'.repeat(40);
  fs.writeFileSync(journal, `${JSON.stringify(record)}\n`, { mode: 0o600 });

  await assert.rejects(
    harness({ auditStore: store }).broker.observe(input()),
    /github_read_audit_conflict/,
  );

  const unsafeRoot = path.join(root, 'unsafe');
  fs.mkdirSync(unsafeRoot, { mode: 0o755 });
  assert.throws(
    () => createFileGithubReadAuditStore({ auditRoot: unsafeRoot }),
    /github_read_audit_root_invalid/,
  );
});
