#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify, TextDecoder } = require('node:util');

const execFileAsync = promisify(execFile);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BRANCH = /^(?![./])(?!.*(?:\.\.|\/\/|@\{|[~^:?*\\\s]))(?!.*[./]$)[A-Za-z0-9._/-]+$/;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_AUDIT_BYTES = 131_072;
const GH_FIELDS = 'url,number,headRefName,headRefOid,state';

function fail(code) {
  throw new Error(code);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function digest(value) {
  return createHash('sha256').update(
    Buffer.isBuffer(value) ? value : canonicalJson(value),
  ).digest('hex');
}

function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) fail(code);
  return value;
}

function canonicalTimestamp(value, code) {
  if (typeof value !== 'string') fail(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail(code);
  return value;
}

function validatePolicy(value) {
  exact(value, [
    'version',
    'repo',
    'url',
    'number',
    'head_ref',
    'head_sha',
    'allowed_states',
  ], 'github_read_policy_invalid');
  if (
    value.version !== 'github-read/v1'
    || value.repo !== 'perfectuser21/cecelia'
    || !Number.isInteger(value.number)
    || value.number < 1
    || typeof value.head_ref !== 'string'
    || value.head_ref.length > 255
    || !BRANCH.test(value.head_ref)
    || !SHA.test(value.head_sha ?? '')
    || !Array.isArray(value.allowed_states)
    || value.allowed_states.length !== 1
    || !['OPEN', 'MERGED'].includes(value.allowed_states[0])
  ) fail('github_read_policy_invalid');
  let parsed;
  try {
    parsed = new URL(value.url);
  } catch {
    fail('github_read_policy_invalid');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'github.com'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== `/${value.repo}/pull/${value.number}`
  ) fail('github_read_policy_invalid');
  return Object.freeze({
    ...value,
    allowed_states: Object.freeze([...value.allowed_states]),
  });
}

function validateRequest(input) {
  exact(input, [
    'attemptId',
    'taskId',
    'runId',
    'role',
    'policy',
  ], 'github_read_request_invalid');
  if (
    !UUID.test(input.attemptId ?? '')
    || !UUID.test(input.runId ?? '')
    || typeof input.taskId !== 'string'
    || input.taskId.length < 1
    || input.taskId.length > 1024
    || /[\r\n\0]/.test(input.taskId)
    || !['evaluator', 'reporter'].includes(input.role)
  ) fail('github_read_request_invalid');
  const policy = validatePolicy(input.policy);
  const requestSha = digest({
    attempt_id: input.attemptId,
    task_id: input.taskId,
    run_id: input.runId,
    role: input.role,
    policy,
  });
  return { policy, requestSha };
}

function parseGithubResponse(output, policy) {
  const bytes = Buffer.isBuffer(output)
    ? output
    : Buffer.from(String(output ?? ''), 'utf8');
  if (bytes.length < 2 || bytes.length > MAX_RESPONSE_BYTES) {
    fail('github_read_response_invalid');
  }
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    fail('github_read_response_invalid');
  }
  exact(
    value,
    ['url', 'number', 'headRefName', 'headRefOid', 'state'],
    'github_read_response_invalid',
  );
  if (
    value.url !== policy.url
    || value.number !== policy.number
    || value.headRefName !== policy.head_ref
    || value.headRefOid !== policy.head_sha
    || value.state !== policy.allowed_states[0]
  ) fail('github_read_binding_invalid');
  return Object.freeze({
    type: 'pull_request',
    url: value.url,
    number: value.number,
    head_ref: value.headRefName,
    head_sha: value.headRefOid,
    state: value.state,
  });
}

function validatePullRequest(value, code) {
  exact(
    value,
    ['type', 'url', 'number', 'head_ref', 'head_sha', 'state'],
    code,
  );
  validatePolicy({
    version: 'github-read/v1',
    repo: 'perfectuser21/cecelia',
    url: value.url,
    number: value.number,
    head_ref: value.head_ref,
    head_sha: value.head_sha,
    allowed_states: [value.state],
  });
  if (value.type !== 'pull_request') fail(code);
  return Object.freeze({ ...value });
}

function recordDigest(record) {
  const { record_sha256: _discarded, ...body } = record;
  return digest(body);
}

function validateRecords(records, input, requestSha) {
  if (!Array.isArray(records) || records.length > 1) {
    fail('github_read_audit_conflict');
  }
  if (records.length === 0) return null;
  const [record] = records;
  exact(record, [
    'schema_version',
    'stage',
    'attempt_id',
    'task_id',
    'run_id',
    'role',
    'request_sha256',
    'observed_at',
    'pull_request',
    'previous_sha256',
    'record_sha256',
  ], 'github_read_audit_conflict');
  if (
    record.schema_version !== 'github-read-audit/v1'
    || record.stage !== 'observed'
    || record.attempt_id !== input.attemptId
    || record.task_id !== input.taskId
    || record.run_id !== input.runId
    || record.role !== input.role
    || record.request_sha256 !== requestSha
    || record.previous_sha256 !== null
    || !SHA256.test(record.record_sha256 ?? '')
    || record.record_sha256 !== recordDigest(record)
  ) fail('github_read_audit_conflict');
  canonicalTimestamp(record.observed_at, 'github_read_audit_conflict');
  validatePullRequest(record.pull_request, 'github_read_audit_conflict');
  return Object.freeze(record);
}

function authorityFromRecord(record) {
  return Object.freeze({
    schema_version: 'github-read-authority/v1',
    attempt_id: record.attempt_id,
    task_id: record.task_id,
    run_id: record.run_id,
    role: record.role,
    request_sha256: record.request_sha256,
    observed_at: record.observed_at,
    pull_request: Object.freeze({ ...record.pull_request }),
    audit_record_sha256: record.record_sha256,
  });
}

async function defaultGh(args) {
  const result = await execFileAsync('gh', args, {
    encoding: 'utf8',
    maxBuffer: MAX_RESPONSE_BYTES,
    env: process.env,
  });
  return result.stdout;
}

function createOwnedAuditRoot(auditRoot) {
  if (
    typeof auditRoot !== 'string'
    || !path.isAbsolute(auditRoot)
    || auditRoot === path.parse(auditRoot).root
  ) fail('github_read_audit_root_invalid');
  const root = path.resolve(auditRoot);
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  } catch {
    fail('github_read_audit_root_invalid');
  }
  const inspect = () => {
    let stat;
    try {
      stat = fs.lstatSync(root);
    } catch {
      fail('github_read_audit_root_invalid');
    }
    const expectedUid = typeof process.getuid === 'function'
      ? process.getuid()
      : stat.uid;
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.uid !== expectedUid
      || (stat.mode & 0o777) !== 0o700
    ) fail('github_read_audit_root_invalid');
    return Object.freeze({ dev: stat.dev, ino: stat.ino });
  };
  const identity = inspect();
  return {
    root,
    assertOwned() {
      const current = inspect();
      if (current.dev !== identity.dev || current.ino !== identity.ino) {
        fail('github_read_audit_root_invalid');
      }
    },
  };
}

function createFileGithubReadAuditStore({ auditRoot } = {}) {
  const guard = createOwnedAuditRoot(auditRoot);
  const targetFor = (attemptId) => {
    if (!UUID.test(attemptId ?? '')) fail('github_read_audit_invalid');
    return path.join(guard.root, `${attemptId}.jsonl`);
  };
  return Object.freeze({
    async read(attemptId) {
      guard.assertOwned();
      const target = targetFor(attemptId);
      let stat;
      try {
        stat = fs.lstatSync(target);
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        fail('github_read_audit_invalid');
      }
      const expectedUid = typeof process.getuid === 'function'
        ? process.getuid()
        : stat.uid;
      if (
        stat.isSymbolicLink()
        || !stat.isFile()
        || stat.uid !== expectedUid
        || (stat.mode & 0o777) !== 0o600
        || stat.size < 2
        || stat.size > MAX_AUDIT_BYTES
      ) fail('github_read_audit_invalid');
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(
          fs.readFileSync(target),
        );
      } catch {
        fail('github_read_audit_invalid');
      }
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      if (lines.length !== 1) fail('github_read_audit_invalid');
      try {
        return [JSON.parse(lines[0])];
      } catch {
        fail('github_read_audit_invalid');
      }
    },
    async append(attemptId, record) {
      guard.assertOwned();
      const target = targetFor(attemptId);
      let descriptor;
      try {
        descriptor = fs.openSync(
          target,
          fs.constants.O_WRONLY
            | fs.constants.O_CREAT
            | fs.constants.O_EXCL
            | (fs.constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        fs.fchmodSync(descriptor, 0o600);
        fs.writeSync(descriptor, `${canonicalJson(record)}\n`);
        fs.fsyncSync(descriptor);
      } catch (error) {
        if (error?.code === 'EEXIST') fail('github_read_audit_exists');
        if (error?.message?.startsWith('github_read_')) throw error;
        fail('github_read_audit_invalid');
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
      return record;
    },
  });
}

function createGithubReadBroker({
  gh = defaultGh,
  auditStore,
  now = () => new Date().toISOString(),
} = {}) {
  if (
    typeof gh !== 'function'
    || typeof auditStore?.read !== 'function'
    || typeof auditStore?.append !== 'function'
    || typeof now !== 'function'
  ) fail('github_read_broker_dependency_invalid');

  return Object.freeze({
    async observe(input) {
      const { policy, requestSha } = validateRequest(input);
      const existing = validateRecords(
        await auditStore.read(input.attemptId),
        input,
        requestSha,
      );
      if (existing) return authorityFromRecord(existing);

      const response = await gh([
        'pr',
        'view',
        String(policy.number),
        '--repo',
        policy.repo,
        '--json',
        GH_FIELDS,
      ]);
      const pullRequest = parseGithubResponse(response, policy);
      const observedAt = canonicalTimestamp(
        now(),
        'github_read_clock_invalid',
      );
      const body = {
        schema_version: 'github-read-audit/v1',
        stage: 'observed',
        attempt_id: input.attemptId,
        task_id: input.taskId,
        run_id: input.runId,
        role: input.role,
        request_sha256: requestSha,
        observed_at: observedAt,
        pull_request: pullRequest,
        previous_sha256: null,
      };
      const record = Object.freeze({
        ...body,
        record_sha256: digest(body),
      });
      try {
        await auditStore.append(input.attemptId, record);
      } catch (error) {
        if (error?.message !== 'github_read_audit_exists') throw error;
        const raced = validateRecords(
          await auditStore.read(input.attemptId),
          input,
          requestSha,
        );
        if (!raced) fail('github_read_audit_conflict');
        return authorityFromRecord(raced);
      }
      return authorityFromRecord(record);
    },
  });
}

module.exports = {
  createFileGithubReadAuditStore,
  createGithubReadBroker,
};
