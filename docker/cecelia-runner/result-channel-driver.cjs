#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { TextDecoder } = require('node:util');

const {
  canonicalJson,
  finalizeRoleResult,
} = require('./result-channel-finalizer.cjs');

const execFileAsync = promisify(execFile);
const CHANNEL_VERSION = 'attempt-result-file/v1';
const RUNTIME_ROOT = '/tmp/cecelia-prompts';
const MAX_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const MAX_EVIDENCE_FILES = 4096;
const MAX_VERIFICATION_COMMANDS = 16;
const MAX_VERIFICATION_COMMAND_BYTES = 8192;
const EVALUATOR_COMMAND_TIMEOUT_MS = 120_000;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const ROLE_VALUES = new Set([
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'evaluator',
  'reporter',
]);
const SUCCESS_STATUSES = new Set(['completed', 'completed_with_concerns']);
const TERMINAL_STATUSES = new Set([
  ...SUCCESS_STATUSES,
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);
const RUBRIC_KEYS = Object.freeze([
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
  'verification_oracle_completeness',
  'ci_workflow_alignment',
]);

function invalid(message) {
  throw new Error(`result_channel_driver: ${message}`);
}

function isPlainObject(value) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function object(value, label) {
  if (!isPlainObject(value)) invalid(`${label} must be a plain object`);
  return value;
}

function exact(value, required, optional, label) {
  object(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${label} unknown field: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) invalid(`${label} missing field: ${key}`);
  }
  return value;
}

function boundedString(value, label, { min = 1, max = 4096, pattern = null } = {}) {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
  const bytes = Buffer.byteLength(value);
  if (bytes < min || bytes > max) invalid(`${label} length is outside bounds`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    invalid(`${label} contains control characters`);
  }
  if (pattern && !pattern.test(value)) invalid(`${label} is invalid`);
  return value;
}

function uuid(value, label) {
  return boundedString(value, label, { max: 36, pattern: UUID_PATTERN });
}

function gitSha(value, label) {
  return boundedString(value, label, { max: 40, pattern: GIT_SHA_PATTERN });
}

function relativePath(value, label) {
  const parsed = boundedString(value, label, { max: 1024 });
  if (
    parsed.startsWith('/')
    || /[\r\n\\]/.test(parsed)
    || parsed.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    invalid(`${label} must be a normalized relative path`);
  }
  return parsed;
}

function webUrl(value, label) {
  const parsed = boundedString(value, label, { max: 2048 });
  let url;
  try {
    url = new URL(parsed);
  } catch {
    invalid(`${label} must be a URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    invalid(`${label} must be an http(s) URL without credentials`);
  }
  return parsed;
}

function assertExactKeys(value, keys, label) {
  exact(value, keys, [], label);
  return value;
}

function readBoundedJson(file, maxBytes, label, { allowEmpty = false } = {}) {
  let fd;
  let bytes;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const descriptor = fs.fstatSync(fd);
    if (!descriptor.isFile()) invalid(`${label} must be a regular file`);
    if (descriptor.size > maxBytes) invalid(`${label} exceeds byte limit`);
    bytes = fs.readFileSync(fd);
  } catch (error) {
    if (String(error?.message ?? '').startsWith('result_channel_driver:')) throw error;
    invalid(`${label} cannot be read safely: ${error.code ?? error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (bytes.length === 0 && allowEmpty) return null;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid(`${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    invalid(`${label} is not valid JSON`);
  }
}

function readPinnedBundle(binding) {
  let fd;
  try {
    fd = fs.openSync(
      binding.bundleFile,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    const descriptor = fs.fstatSync(fd);
    if (
      !descriptor.isFile()
      || (descriptor.mode & 0o777) !== 0o600
      || descriptor.size > MAX_BYTES
    ) {
      invalid('TaskBundle file must be a bounded 0600 regular file');
    }
    const bytes = fs.readFileSync(fd);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== binding.bundleSha256) invalid('TaskBundle digest mismatch');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      invalid('TaskBundle file is not valid UTF-8');
    }
    try {
      return JSON.parse(text);
    } catch {
      invalid('TaskBundle file is not valid JSON');
    }
  } catch (error) {
    if (String(error?.message ?? '').startsWith('result_channel_driver:')) throw error;
    invalid(`TaskBundle file cannot be read safely: ${error.code ?? error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function atomicWrite(file, contents) {
  const directory = path.dirname(file);
  const name = path.basename(file);
  const temporary = path.join(
    directory,
    `.${name}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let handle;
  try {
    handle = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    fs.writeFileSync(handle, contents, { encoding: 'utf8' });
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
    const directoryHandle = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryHandle);
    } finally {
      fs.closeSync(directoryHandle);
    }
  } catch (error) {
    if (handle !== null && handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        // Preserve the original failure.
      }
    }
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The temp file may never have been created or may already be renamed.
    }
    throw error;
  }
}

function isManagedResultChannel(env = process.env) {
  return Object.hasOwn(env, 'BRAIN_RESULT_CHANNEL_VERSION');
}

function validateManagedContext(
  env,
  providerResultPath = null,
  { requireProviderResult = true } = {},
) {
  if (!isManagedResultChannel(env)) invalid('managed channel version is absent');
  if (env.BRAIN_RESULT_CHANNEL_VERSION !== CHANNEL_VERSION) {
    invalid('managed channel version is invalid');
  }
  const attemptId = uuid(env.HARNESS_ATTEMPT_ID, 'HARNESS_ATTEMPT_ID');
  const runId = uuid(env.HARNESS_RUN_ID, 'HARNESS_RUN_ID');
  const taskId = boundedString(
    env.HARNESS_TASK_ID ?? env.CECELIA_TASK_ID,
    'HARNESS_TASK_ID',
    { max: 128 },
  );
  if (
    env.HARNESS_TASK_ID !== undefined
    && env.CECELIA_TASK_ID !== undefined
    && env.HARNESS_TASK_ID !== env.CECELIA_TASK_ID
  ) {
    invalid('task environment binding mismatch');
  }
  const role = boundedString(env.HARNESS_NODE, 'HARNESS_NODE', { max: 32 });
  if (!ROLE_VALUES.has(role)) invalid('HARNESS_NODE is invalid');
  const expectedResultFile = `${RUNTIME_ROOT}/${attemptId}.result.json`;
  if (env.BRAIN_RESULT_FILE !== expectedResultFile) {
    invalid('managed result path mismatch');
  }
  const maxBytes = Number(env.BRAIN_RESULT_MAX_BYTES);
  if (
    !/^[1-9][0-9]*$/.test(String(env.BRAIN_RESULT_MAX_BYTES ?? ''))
    || !Number.isSafeInteger(maxBytes)
    || maxBytes > MAX_BYTES
  ) {
    invalid('managed max bytes is invalid');
  }
  const expectedProviderPath = `/tmp/harness-result-${attemptId}.normalized.json`;
  if (requireProviderResult && providerResultPath !== expectedProviderPath) {
    invalid('provider result path is not attempt-owned');
  }
  const bundleFile = boundedString(
    env.HARNESS_TASK_BUNDLE_FILE,
    'HARNESS_TASK_BUNDLE_FILE',
    { max: 4096 },
  );
  if (!path.isAbsolute(bundleFile)) invalid('HARNESS_TASK_BUNDLE_FILE must be absolute');
  let bundleDescriptor;
  try {
    bundleDescriptor = fs.lstatSync(bundleFile);
  } catch (error) {
    invalid(`TaskBundle file is unavailable: ${error.code ?? error.message}`);
  }
  if (
    !bundleDescriptor.isFile()
    || bundleDescriptor.isSymbolicLink()
    || (bundleDescriptor.mode & 0o777) !== 0o600
    || bundleDescriptor.size > MAX_BYTES
  ) {
    invalid('TaskBundle file must be a bounded 0600 regular file');
  }
  const workspacePath = boundedString(env.WORKTREE_PATH, 'WORKTREE_PATH', { max: 4096 });
  if (!path.isAbsolute(workspacePath)) invalid('WORKTREE_PATH must be absolute');
  const readOnly = env.HARNESS_READ_ONLY;
  if (!['true', 'false'].includes(readOnly)) invalid('HARNESS_READ_ONLY is invalid');
  const bundleSha256 = boundedString(
    env.BRAIN_TASK_BUNDLE_SHA256,
    'BRAIN_TASK_BUNDLE_SHA256',
    { max: 64 },
  );
  if (!/^[a-f0-9]{64}$/.test(bundleSha256)) invalid('TaskBundle digest is invalid');
  let resultDescriptor;
  try {
    resultDescriptor = fs.lstatSync(expectedResultFile);
  } catch (error) {
    invalid(`managed result target is unavailable: ${error.code ?? error.message}`);
  }
  if (
    !resultDescriptor.isFile()
    || resultDescriptor.isSymbolicLink()
    || (resultDescriptor.mode & 0o777) !== 0o600
  ) {
    invalid('managed result target must be a 0600 regular file');
  }
  if (resultDescriptor.size > maxBytes) invalid('managed result target exceeds byte limit');
  return {
    attemptId,
    runId,
    taskId,
    role,
    resultFile: expectedResultFile,
    sessionFile: `${RUNTIME_ROOT}/${attemptId}.session.json`,
    maxBytes,
    bundleFile,
    bundleSha256,
    workspacePath,
    readOnly: readOnly === 'true',
  };
}

function validateBundleEnvelope(envelope, binding) {
  exact(envelope, ['instruction', 'task_bundle'], ['continuation'], 'TaskBundle envelope');
  boundedString(envelope.instruction, 'TaskBundle envelope instruction', {
    min: 0,
    max: 8192,
  });
  const bundle = object(envelope.task_bundle, 'TaskBundle');
  const required = [
    'contract_version',
    'run_id',
    'attempt_id',
    'hop',
    'phase',
    'role',
    'objective',
    'skill',
    'inputs',
    'constraints',
    'expected_output',
    'result_channel',
  ];
  assertExactKeys(bundle, required, 'TaskBundle');
  if (bundle.contract_version !== '1.0') invalid('TaskBundle contract version is invalid');
  if (bundle.run_id !== binding.runId) invalid('TaskBundle run binding mismatch');
  if (bundle.attempt_id !== binding.attemptId) invalid('TaskBundle attempt binding mismatch');
  if (bundle.role !== binding.role) invalid('TaskBundle role binding mismatch');
  object(bundle.inputs, 'TaskBundle.inputs');
  if (bundle.inputs.task_id !== binding.taskId) invalid('TaskBundle task binding mismatch');
  object(bundle.constraints, 'TaskBundle.constraints');
  if (typeof bundle.constraints.read_only !== 'boolean') {
    invalid('TaskBundle read-only authority is invalid');
  }
  if (bundle.constraints.read_only !== binding.readOnly) {
    invalid('TaskBundle read-only authority mismatch');
  }
  const workspace = exact(
    bundle.inputs.workspace_spec,
    ['repo', 'base_sha', 'branch', 'expected_head_sha', 'mode', 'run_id', 'attempt_id'],
    [],
    'TaskBundle workspace authority',
  );
  if (workspace.repo !== 'perfectuser21/cecelia') {
    invalid('TaskBundle workspace repo authority mismatch');
  }
  gitSha(workspace.base_sha, 'TaskBundle workspace base SHA');
  boundedString(workspace.branch, 'TaskBundle workspace branch', { max: 255 });
  if (workspace.expected_head_sha !== null) {
    gitSha(workspace.expected_head_sha, 'TaskBundle workspace expected HEAD');
  }
  if (workspace.run_id !== binding.runId || workspace.attempt_id !== binding.attemptId) {
    invalid('TaskBundle workspace execution binding mismatch');
  }
  const expectedMode = binding.readOnly ? 'read-only' : 'read-write';
  if (workspace.mode !== expectedMode) invalid('TaskBundle workspace mode mismatch');
  const channel = exact(
    bundle.result_channel,
    ['version', 'path', 'max_bytes', 'bindings'],
    [],
    'TaskBundle.result_channel',
  );
  if (channel.version !== CHANNEL_VERSION) invalid('TaskBundle result channel version mismatch');
  if (channel.path !== binding.resultFile) invalid('TaskBundle result channel path mismatch');
  if (channel.max_bytes !== binding.maxBytes) invalid('TaskBundle result channel max mismatch');
  assertExactKeys(
    channel.bindings,
    ['task_id', 'run_id', 'attempt_id', 'role'],
    'TaskBundle.result_channel.bindings',
  );
  const expectedBindings = {
    task_id: binding.taskId,
    run_id: binding.runId,
    attempt_id: binding.attemptId,
    role: binding.role,
  };
  for (const [key, expected] of Object.entries(expectedBindings)) {
    if (channel.bindings[key] !== expected) invalid(`TaskBundle ${key} authority mismatch`);
  }
  const expectedRoleOutput = `harness-result/${binding.role}-v1`;
  const isCanary = bundle.expected_output === 'harness-result/canary-v1';
  if (!isCanary && bundle.expected_output !== expectedRoleOutput) {
    invalid('TaskBundle expected_output mismatch');
  }
  if (isCanary && (binding.role !== 'reporter' || bundle.skill !== null)) {
    invalid('TaskBundle canary authority mismatch');
  }
  if (binding.role === 'evaluator') {
    validateVerificationCommands(bundle.inputs.verification_commands);
  }
  return { bundle, isCanary };
}

function validateVerificationCommands(value) {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > MAX_VERIFICATION_COMMANDS
  ) {
    invalid('TaskBundle verification_commands must be non-empty and bounded');
  }
  return value.map((entry, index) => {
    const command = boundedString(
      entry,
      `TaskBundle verification_commands[${index}]`,
      { max: MAX_VERIFICATION_COMMAND_BYTES },
    );
    if (
      Buffer.byteLength(command) > MAX_VERIFICATION_COMMAND_BYTES
      || command.trim() !== command
      || command.includes('\0')
    ) {
      invalid(`TaskBundle verification_commands[${index}] is invalid`);
    }
    return command;
  });
}

function validateProviderMetadata(value, env) {
  const expectedProvider = boundedString(
    env.CECELIA_EXECUTOR,
    'CECELIA_EXECUTOR',
    { max: 64 },
  );
  if (!['claude', 'codex', 'grok'].includes(expectedProvider)) {
    invalid('provider runtime authority is invalid');
  }
  const expectedSession = env.BRAIN_PROVIDER_SESSION_ID || null;
  if (expectedSession !== null) {
    boundedString(expectedSession, 'BRAIN_PROVIDER_SESSION_ID', { max: 512 });
  }
  const credentialRef = UUID_PATTERN.test(env.CECELIA_CREDENTIAL_REF ?? '')
    ? env.CECELIA_CREDENTIAL_REF
    : null;
  const expectedKeys = ['provider', 'session_id'];
  if (credentialRef !== null) {
    expectedKeys.push('credential_ref', 'credential_copy_mutated');
  }
  assertExactKeys(value, expectedKeys, 'provider result metadata');
  if (value.provider !== expectedProvider || value.session_id !== expectedSession) {
    invalid('provider result runtime authority mismatch');
  }
  if (credentialRef !== null) {
    if (value.credential_ref !== credentialRef) {
      invalid('provider result credential authority mismatch');
    }
    const mutation = env.BRAIN_CREDENTIAL_COPY_MUTATED;
    if (!['true', 'false'].includes(mutation)) {
      invalid('credential mutation runtime authority is invalid');
    }
    if (value.credential_copy_mutated !== (mutation === 'true')) {
      invalid('provider result credential mutation mismatch');
    }
  }
  return value;
}

function validateProviderResult(value, binding, env) {
  exact(value, [
    'contract_version',
    'attempt_id',
    'status',
    'summary',
    'artifacts',
    'checks',
    'decision',
    'error',
    'provider_metadata',
  ], [], 'provider result');
  if (value.contract_version !== '1.0') invalid('provider result contract version is invalid');
  if (value.attempt_id !== binding.attemptId) invalid('provider result attempt binding mismatch');
  if (!TERMINAL_STATUSES.has(value.status)) invalid('provider result status is invalid');
  boundedString(value.summary, 'provider result summary', { min: 0, max: 8192 });
  if (!Array.isArray(value.artifacts) || value.artifacts.length > 256) {
    invalid('provider result artifacts must be a bounded array');
  }
  if (!Array.isArray(value.checks) || value.checks.length > 256) {
    invalid('provider result checks must be a bounded array');
  }
  if (value.decision !== null) {
    exact(value.decision, ['outcome', 'reason'], [], 'provider result decision');
    boundedString(value.decision.outcome, 'provider result decision outcome', { max: 4096 });
    boundedString(value.decision.reason, 'provider result decision reason', {
      min: 0,
      max: 8192,
    });
  }
  if (value.error !== null) object(value.error, 'provider result error');
  validateProviderMetadata(value.provider_metadata, env);
  canonicalJson(value);
  return value;
}

async function defaultGit(workspacePath, args, { binary = false } = {}) {
  try {
    const result = await execFileAsync('git', ['-C', workspacePath, ...args], {
      encoding: binary ? null : 'utf8',
      maxBuffer: MAX_BYTES,
    });
    return result.stdout;
  } catch (error) {
    invalid(`git authority command failed: ${error.message}`);
  }
}

async function localAndRemoteGit(deps, workspacePath, branch, expectedSha = null) {
  const localBranch = String(await deps.git(workspacePath, ['branch', '--show-current'])).trim();
  if (localBranch !== branch) invalid('workspace branch authority mismatch');
  const localSha = String(await deps.git(workspacePath, ['rev-parse', 'HEAD'])).trim();
  gitSha(localSha, 'workspace HEAD');
  if (expectedSha !== null && localSha !== expectedSha) {
    invalid('workspace HEAD authority mismatch');
  }
  const status = String(
    await deps.git(workspacePath, ['status', '--porcelain=v1', '--untracked-files=all']),
  );
  if (status !== '') invalid('workspace Git state is not clean');
  const remote = String(
    await deps.git(workspacePath, [
      'ls-remote',
      'https://github.com/perfectuser21/cecelia.git',
      `refs/heads/${branch}`,
    ]),
  ).trim();
  const remoteLines = remote.split('\n').filter(Boolean);
  if (
    remoteLines.length !== 1
    || remoteLines[0] !== `${localSha}\trefs/heads/${branch}`
  ) {
    invalid('remote branch authority mismatch');
  }
  return localSha;
}

function parseGitTreeRecord(buffer, label) {
  const value = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (value.length === 0 || value[value.length - 1] !== 0) {
    invalid(`${label} Git tree record is invalid`);
  }
  const records = value.subarray(0, -1).toString('utf8').split('\0');
  return records.map((record) => {
    const match = record.match(/^([0-9]{6}) (blob|tree) ([a-f0-9]{40})\t(.+)$/s);
    if (!match) invalid(`${label} Git tree record is invalid`);
    return {
      mode: match[1],
      type: match[2],
      oid: match[3],
      path: match[4],
    };
  });
}

function assertRegularGitBlob(entry, label) {
  if (
    entry.type !== 'blob'
    || !['100644', '100755'].includes(entry.mode)
  ) {
    invalid(`${label} Git artifact must be a regular blob`);
  }
}

async function defaultReadGitFile(workspacePath, headSha, relative, deps) {
  const tree = parseGitTreeRecord(
    await deps.git(
      workspacePath,
      ['ls-tree', '-z', headSha, '--', relative],
      { binary: true },
    ),
    'file',
  );
  if (tree.length !== 1 || tree[0].path !== relative) {
    invalid('Git artifact file is missing from verified HEAD');
  }
  assertRegularGitBlob(tree[0], 'file');
  return {
    mode: tree[0].mode,
    bytes: await deps.git(
      workspacePath,
      ['cat-file', 'blob', tree[0].oid],
      { binary: true },
    ),
  };
}

async function defaultReadGitDirectory(workspacePath, headSha, relative, deps) {
  const tree = parseGitTreeRecord(
    await deps.git(
      workspacePath,
      ['ls-tree', '-r', '-z', headSha, '--', relative],
      { binary: true },
    ),
    'directory',
  );
  if (tree.length === 0) invalid('Git artifact directory is empty or missing');
  const entries = [];
  for (const entry of tree) {
    if (!entry.path.startsWith(`${relative}/`)) {
      invalid('Git artifact directory escaped its verified prefix');
    }
    assertRegularGitBlob(entry, 'directory');
    entries.push({
      mode: entry.mode,
      path: entry.path,
      bytes: await deps.git(
        workspacePath,
        ['cat-file', 'blob', entry.oid],
        { binary: true },
      ),
    });
  }
  return entries;
}

function boundedGitBytes(value, label) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (bytes.length > MAX_EVIDENCE_BYTES) {
    invalid(`${label} exceeds evidence byte limit`);
  }
  return bytes;
}

async function hashGitFile(deps, workspacePath, headSha, relative, label) {
  const parsed = relativePath(relative, label);
  const artifact = await deps.readGitFile(workspacePath, headSha, parsed);
  if (!artifact || !['100644', '100755'].includes(artifact.mode)) {
    invalid(`${label} Git artifact must be a regular blob`);
  }
  const bytes = boundedGitBytes(artifact.bytes, label);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return { path: parsed, sha256: `sha256:${digest}` };
}

async function hashGitDirectory(deps, workspacePath, headSha, relative, label) {
  const parsed = relativePath(relative, label);
  const artifacts = await deps.readGitDirectory(workspacePath, headSha, parsed);
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    invalid(`${label} Git artifact directory is empty or missing`);
  }
  let totalBytes = 0;
  const entries = [];
  for (const artifact of artifacts) {
    if (!artifact || !['100644', '100755'].includes(artifact.mode)) {
      invalid(`${label} Git artifact must be a regular blob`);
    }
    const artifactPath = relativePath(artifact.path, `${label} entry`);
    if (!artifactPath.startsWith(`${parsed}/`)) {
      invalid(`${label} Git artifact escaped its verified prefix`);
    }
    const bytes = boundedGitBytes(artifact.bytes, label);
    totalBytes += bytes.length;
    if (entries.length >= MAX_EVIDENCE_FILES || totalBytes > MAX_EVIDENCE_BYTES) {
      invalid(`${label} exceeds evidence byte limit`);
    }
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    entries.push(`${artifactPath.slice(parsed.length + 1)}\0${digest}\0`);
  }
  entries.sort();
  const digest = crypto.createHash('sha256').update(entries.join('')).digest('hex');
  return { path: parsed, sha256: `sha256:${digest}` };
}

async function validateWorkspaceOrigin(bundle, deps, workspacePath) {
  if (bundle.inputs.workspace_spec?.repo !== 'perfectuser21/cecelia') {
    invalid('workspace repo authority mismatch');
  }
  const origin = String(
    await deps.git(workspacePath, ['remote', 'get-url', 'origin']),
  ).trim();
  if (![
    'https://github.com/perfectuser21/cecelia.git',
    'git@github.com:perfectuser21/cecelia.git',
  ].includes(origin)) {
    invalid('workspace origin authority mismatch');
  }
}

function normalizePullRequest(value, allowedStates) {
  assertExactKeys(
    value,
    ['type', 'url', 'number', 'head_ref', 'head_sha', 'state'],
    'pull request authority',
  );
  if (value.type !== 'pull_request') invalid('pull request authority type is invalid');
  webUrl(value.url, 'pull request authority url');
  if (!Number.isInteger(value.number) || value.number < 1) {
    invalid('pull request authority number is invalid');
  }
  const parsedUrl = new URL(value.url);
  if (
    parsedUrl.protocol !== 'https:'
    || parsedUrl.hostname !== 'github.com'
    || parsedUrl.pathname !== `/perfectuser21/cecelia/pull/${value.number}`
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    invalid('pull request repo authority mismatch');
  }
  boundedString(value.head_ref, 'pull request authority head_ref', { max: 255 });
  gitSha(value.head_sha, 'pull request authority head_sha');
  if (!allowedStates.includes(value.state)) invalid('pull request authority state is invalid');
  return JSON.parse(canonicalJson(value));
}

async function defaultInspectPullRequest(reference) {
  webUrl(reference, 'pull request reference');
  let result;
  try {
    result = await execFileAsync(
      'gh',
      ['pr', 'view', reference, '--json', 'url,number,headRefName,headRefOid,state'],
      { encoding: 'utf8', maxBuffer: 131072 },
    );
  } catch (error) {
    invalid(`pull request authority query failed: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    invalid('pull request authority response is invalid JSON');
  }
  assertExactKeys(
    parsed,
    ['url', 'number', 'headRefName', 'headRefOid', 'state'],
    'gh pull request response',
  );
  return {
    type: 'pull_request',
    url: parsed.url,
    number: parsed.number,
    head_ref: parsed.headRefName,
    head_sha: parsed.headRefOid,
    state: parsed.state,
  };
}

function validateBrainUrl(value) {
  const parsed = new URL(boundedString(value, 'BRAIN_URL', { max: 2048 }));
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !['', '/'].includes(parsed.pathname)
  ) {
    invalid('BRAIN_URL must be an http(s) origin');
  }
  return parsed.origin;
}

async function fetchJson(url, label) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    invalid(`${label} request failed: ${error.message}`);
  }
  if (!response.ok) invalid(`${label} returned HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) invalid(`${label} exceeds byte limit`);
  try {
    return JSON.parse(text);
  } catch {
    invalid(`${label} is invalid JSON`);
  }
}

async function defaultReadJudgmentCount(taskId, brainUrl) {
  const root = validateBrainUrl(brainUrl);
  const query = new URL('/api/brain/strategic-decisions', root);
  query.searchParams.set('category', 'judgment');
  query.searchParams.set('source_ref', taskId);
  query.searchParams.set('limit', '10000');
  const payload = await fetchJson(query, 'judgment authority');
  exact(payload, ['success', 'data', 'total'], [], 'judgment authority');
  if (payload.success !== true || !Array.isArray(payload.data)) {
    invalid('judgment authority shape is invalid');
  }
  if (!Number.isInteger(payload.total) || payload.total !== payload.data.length) {
    invalid('judgment authority total is invalid');
  }
  for (const row of payload.data) {
    object(row, 'judgment authority row');
    if (row.category !== 'judgment' || row.source_ref !== taskId) {
      invalid('judgment authority row binding mismatch');
    }
  }
  return payload.total;
}

async function defaultReadLearningCount(taskId, brainUrl) {
  const root = validateBrainUrl(brainUrl);
  const query = new URL('/api/brain/learnings', root);
  query.searchParams.set('task_id', taskId);
  query.searchParams.set('limit', '100');
  query.searchParams.set('offset', '0');
  const payload = await fetchJson(query, 'learning authority');
  exact(payload, ['learnings', 'total', 'limit', 'offset'], [], 'learning authority');
  if (!Array.isArray(payload.learnings)) invalid('learning authority rows are invalid');
  if (
    !Number.isInteger(payload.total)
    || payload.total !== payload.learnings.length
    || payload.limit !== 100
    || payload.offset !== 0
  ) {
    invalid('learning authority pagination is unverifiable');
  }
  for (const row of payload.learnings) {
    object(row, 'learning authority row');
    if (row.task_id !== taskId) invalid('learning authority row binding mismatch');
  }
  return payload.total;
}

function evaluatorLogTail(stdout, stderr) {
  const combined = `${stdout ?? ''}${stderr ?? ''}`
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(-6)
    .filter((line, index, lines) => !(index === lines.length - 1 && line === ''))
    .slice(-5)
    .join('\n');
  return combined.slice(-8192);
}

async function defaultExecuteEvaluatorCommand({
  command,
  cwd,
  timeoutMs = EVALUATOR_COMMAND_TIMEOUT_MS,
}) {
  boundedString(command, 'evaluator command', { max: 8192 });
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > EVALUATOR_COMMAND_TIMEOUT_MS
  ) {
    invalid('evaluator command timeout is invalid');
  }
  const executionEnv = { ...process.env };
  for (const key of [
    'HARNESS_CALLBACK_TOKEN',
    'HARNESS_CALLBACK_URL',
    'CECELIA_CREDENTIAL_REF',
    'BRAIN_CREDENTIAL_COPY_MUTATED',
    'BRAIN_PROVIDER_SESSION_ID',
  ]) {
    delete executionEnv[key];
  }
  try {
    const result = await new Promise((resolve, reject) => {
      const supervisor = `
exec 3>&1 4>&2
exec >/dev/null 2>/dev/null
set -m
command_pid=''
cleanup() {
  if [[ "$command_pid" =~ ^[1-9][0-9]*$ ]]; then
    kill -KILL -- "-$command_pid" 2>/dev/null || true
    wait "$command_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 124' HUP INT TERM
/bin/bash --noprofile --norc -lc "$1" >&3 2>&4 &
command_pid=$!
wait "$command_pid"
command_status=$?
exit "$command_status"
`;
      execFile(
        '/bin/bash',
        ['--noprofile', '--norc', '-c', supervisor, 'runner-owned-evaluator', command],
        {
          cwd,
          env: executionEnv,
          encoding: 'utf8',
          timeout: timeoutMs,
          maxBuffer: MAX_BYTES,
          killSignal: 'SIGTERM',
        },
        (error, stdout, stderr) => {
          const outcome = { stdout, stderr };
          if (error) {
            Object.assign(error, outcome);
            reject(error);
          } else {
            resolve(outcome);
          }
        },
      );
    });
    return {
      command,
      exit_code: 0,
      log_tail: evaluatorLogTail(result.stdout, result.stderr),
    };
  } catch (error) {
    if (error?.killed || ['SIGKILL', 'SIGTERM'].includes(error?.signal)) {
      invalid('evaluator command timed out or exceeded output bounds');
    }
    if (!Number.isInteger(error?.code)) {
      invalid(`evaluator command could not execute: ${error.message}`);
    }
    return {
      command,
      exit_code: error.code,
      log_tail: evaluatorLogTail(error.stdout, error.stderr),
    };
  }
}

function resolveDependencies(injected, env) {
  const resolved = {
    git: injected?.git ?? defaultGit,
    inspectPullRequest: injected?.inspectPullRequest ?? defaultInspectPullRequest,
    readJudgmentCount: injected?.readJudgmentCount
      ?? ((taskId) => defaultReadJudgmentCount(taskId, env.BRAIN_URL)),
    readLearningCount: injected?.readLearningCount
      ?? ((taskId) => defaultReadLearningCount(taskId, env.BRAIN_URL)),
    executeEvaluatorCommand: injected?.executeEvaluatorCommand
      ?? defaultExecuteEvaluatorCommand,
  };
  resolved.readGitFile = injected?.readGitFile
    ?? ((workspacePath, headSha, relative) => (
      defaultReadGitFile(workspacePath, headSha, relative, resolved)
    ));
  resolved.readGitDirectory = injected?.readGitDirectory
    ?? ((workspacePath, headSha, relative) => (
      defaultReadGitDirectory(workspacePath, headSha, relative, resolved)
    ));
  return resolved;
}

function validateRubric(value) {
  assertExactKeys(value, RUBRIC_KEYS, 'reviewer rubric');
  for (const key of RUBRIC_KEYS) {
    if (
      typeof value[key] !== 'number'
      || !Number.isFinite(value[key])
      || value[key] < 0
      || value[key] > 10
    ) {
      invalid(`reviewer rubric ${key} is invalid`);
    }
  }
  return value;
}

function assertFrozenPullRequest(observed, frozen, allowedStates = ['OPEN']) {
  const expected = normalizePullRequest(frozen, allowedStates);
  const actual = normalizePullRequest(observed, allowedStates);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    invalid('pull request differs from frozen TaskBundle authority');
  }
  return actual;
}

async function buildVerifierEnvelope({
  bundle,
  rawEnvelope,
  workspacePath,
  deps: injectedDeps,
  env = process.env,
}) {
  object(bundle, 'TaskBundle');
  object(rawEnvelope, 'raw result');
  const inputs = object(bundle.inputs, 'TaskBundle.inputs');
  const deps = resolveDependencies(injectedDeps, env);
  await validateWorkspaceOrigin(bundle, deps, workspacePath);
  const sprintDir = relativePath(inputs.sprint_dir, 'TaskBundle.inputs.sprint_dir');
  const taskId = boundedString(inputs.task_id, 'TaskBundle.inputs.task_id', { max: 128 });

  if (bundle.role === 'planner') {
    const branch = boundedString(rawEnvelope.branch, 'planner raw branch', { max: 255 });
    const actualHead = await localAndRemoteGit(deps, workspacePath, branch);
    gitSha(actualHead, 'planner HEAD');
    if (rawEnvelope.sprint_dir !== sprintDir) invalid('planner sprint authority mismatch');
    return {
      branch,
      sprint_dir: sprintDir,
      planner_branch: branch,
      prd_sha256: (await hashGitFile(
        deps,
        workspacePath,
        actualHead,
        `${sprintDir}/sprint-prd.md`,
        'planner PRD',
      )).sha256,
      effective_review_required: typeof inputs.review_required === 'boolean'
        ? inputs.review_required
        : true,
    };
  }

  if (bundle.role === 'proposer') {
    const branch = boundedString(inputs.propose_branch, 'proposer frozen branch', { max: 255 });
    const headSha = await localAndRemoteGit(deps, workspacePath, branch);
    return {
      propose_branch: branch,
      head_sha: headSha,
      artifacts: {
        contract_draft: await hashGitFile(
          deps,
          workspacePath,
          headSha,
          `${sprintDir}/contract-draft.md`,
          'proposer contract draft',
        ),
        contract_dod: await hashGitFile(
          deps,
          workspacePath,
          headSha,
          `${sprintDir}/contract-dod.md`,
          'proposer contract DoD',
        ),
        task_plan: await hashGitFile(
          deps,
          workspacePath,
          headSha,
          `${sprintDir}/task-plan.json`,
          'proposer task plan',
        ),
        contract_tests: await hashGitDirectory(
          deps,
          workspacePath,
          headSha,
          `${sprintDir}/tests`,
          'proposer contract tests',
        ),
      },
    };
  }

  if (bundle.role === 'reviewer') {
    const contractSha = gitSha(inputs.contract_sha, 'reviewer frozen contract SHA');
    const contractBranch = boundedString(
      inputs.contract_branch,
      'reviewer frozen contract branch',
      { max: 255 },
    );
    await localAndRemoteGit(deps, workspacePath, contractBranch, contractSha);
    const rubric = validateRubric(rawEnvelope.rubric_scores);
    const judgmentCount = await deps.readJudgmentCount(taskId);
    if (!Number.isInteger(judgmentCount) || judgmentCount < 0 || judgmentCount > 10000) {
      invalid('judgment authority count is invalid');
    }
    return {
      contract_sha: contractSha,
      verdict: RUBRIC_KEYS.every((key) => rubric[key] >= 7) ? 'APPROVED' : 'REVISION',
      rubric_scores: JSON.parse(canonicalJson(rubric)),
      judgments_written: judgmentCount,
    };
  }

  if (bundle.role === 'generator') {
    const observed = await deps.inspectPullRequest(rawEnvelope.pr_url);
    const pullRequest = normalizePullRequest(observed, ['OPEN']);
    await localAndRemoteGit(
      deps,
      workspacePath,
      pullRequest.head_ref,
      pullRequest.head_sha,
    );
    return {
      pull_request: pullRequest,
    };
  }

  if (bundle.role === 'evaluator') {
    const contractSha = gitSha(inputs.contract_sha, 'evaluator frozen contract SHA');
    const observedPr = await deps.inspectPullRequest(inputs.pull_request?.url);
    const pullRequest = assertFrozenPullRequest(observedPr, inputs.pull_request);
    await localAndRemoteGit(
      deps,
      workspacePath,
      pullRequest.head_ref,
      pullRequest.head_sha,
    );
    const verificationCommands = validateVerificationCommands(inputs.verification_commands);
    const claimed = rawEnvelope.behavior_tests;
    if (claimed !== undefined) {
      if (!Array.isArray(claimed) || claimed.length !== verificationCommands.length) {
        invalid('provider behavior_tests commands differ from frozen TaskBundle');
      }
      for (let index = 0; index < claimed.length; index += 1) {
        if (
          !isPlainObject(claimed[index])
          || claimed[index].command !== verificationCommands[index]
        ) {
          invalid('provider behavior_tests commands differ from frozen TaskBundle');
        }
      }
    }
    const behaviorTests = [];
    for (const command of verificationCommands) {
      const execution = await deps.executeEvaluatorCommand({ command, cwd: workspacePath });
      exact(
        execution,
        ['command', 'exit_code'],
        ['log_tail'],
        'Runner evaluator execution authority',
      );
      const observed = {
        command: execution.command,
        exit_code: execution.exit_code,
        log_tail: boundedString(
          execution.log_tail ?? '',
          'Runner evaluator execution log_tail',
          { min: 0, max: 8192 },
        ),
      };
      if (
        observed.command !== command
        || !Number.isSafeInteger(observed.exit_code)
        || observed.exit_code < 0
        || observed.exit_code > 255
      ) {
        invalid('Runner evaluator execution authority mismatch');
      }
      behaviorTests.push(observed);
    }
    return {
      contract_sha: contractSha,
      pull_request: pullRequest,
      behavior_tests: behaviorTests,
    };
  }

  if (bundle.role === 'reporter') {
    const frozenPr = normalizePullRequest(inputs.pull_request, ['OPEN', 'MERGED']);
    if (rawEnvelope.pr_url !== frozenPr.url) {
      invalid('reporter pull request claim differs from frozen authority');
    }
    const observedPr = await deps.inspectPullRequest(frozenPr.url);
    const pullRequest = assertFrozenPullRequest(
      observedPr,
      frozenPr,
      ['OPEN', 'MERGED'],
    );
    await localAndRemoteGit(
      deps,
      workspacePath,
      pullRequest.head_ref,
      pullRequest.head_sha,
    );
    const reportPath = relativePath(rawEnvelope.report_path, 'reporter report path');
    if (!reportPath.startsWith(`${sprintDir}/`)) invalid('reporter report path authority mismatch');
    const learningCount = await deps.readLearningCount(taskId);
    if (!Number.isInteger(learningCount) || learningCount < 0 || learningCount > 100000) {
      invalid('learning authority count is invalid');
    }
    if (!Array.isArray(rawEnvelope.screenshots) || rawEnvelope.screenshots.length > 256) {
      invalid('reporter screenshots are invalid');
    }
    return {
      pull_request: pullRequest,
      report: await hashGitFile(
        deps,
        workspacePath,
        pullRequest.head_sha,
        reportPath,
        'reporter report',
      ),
      learning: await hashGitFile(
        deps,
        workspacePath,
        pullRequest.head_sha,
        `${sprintDir}/learning.md`,
        'reporter learning',
      ),
      screenshots: await Promise.all(rawEnvelope.screenshots.map((entry, index) => (
        hashGitFile(
          deps,
          workspacePath,
          pullRequest.head_sha,
          entry,
          `reporter screenshot ${index}`,
        )
      ))),
      learnings_inserted: learningCount,
    };
  }

  invalid('TaskBundle role is unsupported');
}

function validatePassThroughResult(providerResult, { isCanary }) {
  if (providerResult.artifacts.length !== 0 || providerResult.checks.length !== 0) {
    invalid('pass-through result cannot claim unverified side effects');
  }
  if (SUCCESS_STATUSES.has(providerResult.status) && !isCanary) {
    invalid('successful role result requires raw verification');
  }
  if (isCanary && SUCCESS_STATUSES.has(providerResult.status)) {
    if (
      providerResult.status !== 'completed'
      || providerResult.decision?.outcome !== 'CANARY_OK'
      || providerResult.error !== null
    ) {
      invalid('successful canary proof is invalid');
    }
  } else if (
    !isCanary
    && ['failed', 'cancelled'].includes(providerResult.status)
    && providerResult.decision !== null
  ) {
    invalid('runner failure pass-through decision must be null');
  }
  return JSON.parse(canonicalJson(providerResult));
}

function writeSessionHandoff(binding, providerResult) {
  const metadata = providerResult.provider_metadata;
  if (metadata.session_id == null) return;
  const handoff = {
    contract_version: 'provider-session/v1',
    attempt_id: binding.attemptId,
    provider: metadata.provider,
    session_id: metadata.session_id ?? null,
  };
  const encoded = `${canonicalJson(handoff)}\n`;
  atomicWrite(binding.sessionFile, encoded);
}

function writeManagedSession({
  env = process.env,
  provider,
  sessionId,
}) {
  const binding = validateManagedContext(env, null, { requireProviderResult: false });
  const bundleEnvelope = readPinnedBundle(binding);
  validateBundleEnvelope(bundleEnvelope, binding);
  const expectedProvider = boundedString(
    env.CECELIA_EXECUTOR ?? provider,
    'CECELIA_EXECUTOR',
    { max: 64 },
  );
  if (provider !== expectedProvider || !['claude', 'codex', 'grok'].includes(provider)) {
    invalid('provider session binding mismatch');
  }
  const handoff = {
    contract_version: 'provider-session/v1',
    attempt_id: binding.attemptId,
    provider,
    session_id: boundedString(sessionId, 'provider session id', { max: 512 }),
  };
  atomicWrite(binding.sessionFile, `${canonicalJson(handoff)}\n`);
  return handoff;
}

async function finalizeManagedResult({
  env = process.env,
  providerResultPath,
  deps,
}) {
  const binding = validateManagedContext(env, providerResultPath);
  const bundleEnvelope = readPinnedBundle(binding);
  const { bundle, isCanary } = validateBundleEnvelope(bundleEnvelope, binding);
  const providerResult = validateProviderResult(
    readBoundedJson(providerResultPath, binding.maxBytes, 'provider result file'),
    binding,
    env,
  );
  let result;
  if (!SUCCESS_STATUSES.has(providerResult.status) || isCanary) {
    result = validatePassThroughResult(providerResult, { isCanary });
  } else {
    const rawEnvelope = readBoundedJson(
      binding.resultFile,
      binding.maxBytes,
      'raw result file',
    );
    const verifierEnvelope = await buildVerifierEnvelope({
      bundle,
      rawEnvelope,
      workspacePath: binding.workspacePath,
      deps,
      env,
    });
    result = finalizeRoleResult({
      expectedOutput: bundle.expected_output,
      binding: {
        task_id: binding.taskId,
        run_id: binding.runId,
        attempt_id: binding.attemptId,
        role: binding.role,
      },
      providerResult,
      rawEnvelope,
      verifierEnvelope,
    });
  }
  const encoded = `${canonicalJson(result)}\n`;
  if (Buffer.byteLength(encoded) > binding.maxBytes) {
    invalid('canonical HarnessResult exceeds result channel limit');
  }
  atomicWrite(binding.resultFile, encoded);
  writeSessionHandoff(binding, providerResult);
  return result;
}

async function main() {
  if (process.argv.length === 4 && process.argv[2] === '--provider-result') {
    await finalizeManagedResult({
      env: process.env,
      providerResultPath: process.argv[3],
    });
    return;
  }
  if (process.argv.length === 4 && process.argv[2] === '--provider-session') {
    writeManagedSession({
      env: process.env,
      provider: process.env.CECELIA_EXECUTOR,
      sessionId: process.argv[3],
    });
    return;
  }
  invalid(
    'usage: result-channel-driver.cjs --provider-result <path> '
      + '| --provider-session <session-id>',
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildVerifierEnvelope,
  defaultExecuteEvaluatorCommand,
  finalizeManagedResult,
  isManagedResultChannel,
  writeManagedSession,
};
