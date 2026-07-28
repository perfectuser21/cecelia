#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { TextDecoder } = require('node:util');

const execFileAsync = promisify(execFile);
const CANONICAL_MACHINE_IDS = new Set([
  'us-mac-m4',
  'xian-mac-m4',
  'xian-mac-m1',
]);
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const IMAGE_DIGEST_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
const PROVIDER_FIELDS = new Set([
  'provider',
  'command',
  'args',
  'stdin',
  'output',
]);
const LAUNCH_FIELDS = new Set([
  'attempt_id',
  'task_id',
  'run_id',
  'lease_owner',
  'lease_generation',
  'target',
  'workspace_spec',
  'provider_spec',
  'credential_envelope',
  'result_channel',
  'github_mutation_policy',
  'brain_url',
]);
const TARGET_FIELDS = new Set([
  'machine',
  'provider',
  'account',
  'model',
  'role',
]);
const WORKSPACE_SPEC_FIELDS = new Set([
  'repo',
  'base_sha',
  'branch',
  'expected_head_sha',
  'mode',
  'run_id',
  'attempt_id',
]);
const RESULT_CHANNEL_FIELDS = new Set([
  'version',
  'path',
  'max_bytes',
  'bindings',
]);
const RESULT_CHANNEL_BINDING_FIELDS = new Set([
  'task_id',
  'run_id',
  'attempt_id',
  'role',
]);
const GITHUB_MUTATION_POLICY_FIELDS = new Set([
  'version',
  'repo',
  'branch',
  'base_sha',
  'expected_remote_sha',
  'operation',
  'pr_base',
  'pr_title',
  'pr_body',
  'allowed_paths',
]);
const RESULT_CHANNEL_VERSION = 'attempt-result-file/v1';
const RESULT_CHANNEL_ROOT = '/tmp/cecelia-prompts';
const RESULT_CHANNEL_MAX_BYTES = 1024 * 1024;
const ATTEMPT_STATE_VERSION = 'fleet-attempt-state/v2';
const DELIVERY_METADATA_FIELDS = Object.freeze([
  'delivery_id',
  'result_nonce',
  'result_sha256',
  'result_bytes',
  'terminal_status',
]);
const ATTEMPT_STATE_FIELDS = new Set([
  'schema_version',
  'attempt_id',
  'task_id',
  'run_id',
  'worker_id',
  'lease_owner',
  'lease_generation',
  'provider',
  'brain_url',
  'result_channel',
  'github_mutation_policy',
  'credential',
  'container_id',
  'container_removed',
  'workspace',
  'labels',
  'status',
  'cancel_requested_at',
  'delivery',
  'receipt',
  'quarantine',
  'created_at',
  'updated_at',
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const PROVIDER_PATTERN = /^(codex|claude|grok)$/;
const ROLE_PATTERN = /^(planner|proposer|reviewer|generator|evaluator|judge|reporter)$/;
const TERMINAL_RESULT_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);
const PROVIDER_SESSION_MAX_BYTES = 64 * 1024;
const MAX_STATE_BYTES = 1_048_576;

async function defaultRunCommand(command, args, options) {
  const { stdout = '' } = await execFileAsync(command, args, {
    cwd: options?.cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim() };
}

async function defaultWriteCredential(fifoPath, authJson) {
  const deadline = Date.now() + 10_000;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(
        fifoPath,
        fs.constants.O_WRONLY | fs.constants.O_NONBLOCK,
      );
    } catch (error) {
      if (error?.code !== 'ENXIO' || Date.now() >= deadline) {
        throw new Error('attempt_credential_fifo_write_failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  try {
    const content = Buffer.from(authJson, 'utf8');
    let offset = 0;
    while (offset < content.length) {
      try {
        const written = fs.writeSync(
          descriptor,
          content,
          offset,
          content.length - offset,
        );
        if (written > 0) {
          offset += written;
          continue;
        }
      } catch (error) {
        if (error?.code !== 'EAGAIN') {
          throw new Error('attempt_credential_fifo_write_failed');
        }
      }
      if (Date.now() >= deadline) {
        throw new Error('attempt_credential_fifo_write_failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertRuntimeRoot(value, name) {
  if (
    typeof value !== 'string'
    || !path.isAbsolute(value)
    || value === path.parse(value).root
  ) {
    throw new Error(`attempt_runner_invalid_${name}`);
  }
  return path.resolve(value);
}

function createOwnedPrivateRootGuard(root, errorCode) {
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  } catch {
    throw new Error(errorCode);
  }
  const inspect = () => {
    let stat;
    try {
      stat = fs.lstatSync(root);
    } catch {
      throw new Error(errorCode);
    }
    const expectedUid = typeof process.getuid === 'function'
      ? process.getuid()
      : stat.uid;
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.uid !== expectedUid
      || (stat.mode & 0o777) !== 0o700
    ) {
      throw new Error(errorCode);
    }
    return Object.freeze({ dev: stat.dev, ino: stat.ino });
  };
  const identity = inspect();
  return () => {
    const current = inspect();
    if (current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new Error(errorCode);
    }
  };
}

function assertAttemptId(value) {
  if (!UUID_PATTERN.test(value ?? '')) {
    throw new Error('attempt_state_invalid_attempt_id');
  }
}

function stateContainsForbiddenField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(stateContainsForbiddenField);
  return Object.entries(value).some(([key, nested]) => (
    /(?:authorization|callback_token|secret|result_b64|auth_json|stdin|prompt)/i.test(key)
    || stateContainsForbiddenField(nested)
  ));
}

function hasExactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validateStoredDelivery(value, resultChannel) {
  if (
    !hasExactFields(value, DELIVERY_METADATA_FIELDS)
    || !UUID_PATTERN.test(value.delivery_id ?? '')
    || !UUID_PATTERN.test(value.result_nonce ?? '')
    || !SHA256_PATTERN.test(value.result_sha256 ?? '')
    || !Number.isInteger(value.result_bytes)
    || value.result_bytes < 1
    || value.result_bytes > resultChannel.max_bytes
    || !TERMINAL_RESULT_STATUSES.has(value.terminal_status)
  ) {
    throw new Error('invalid delivery');
  }
}

function validateStoredReceipt(value) {
  if (
    !hasExactFields(value, [
      'receipt_id',
      'receipt_status',
      'persisted_at',
    ])
    || !UUID_PATTERN.test(value.receipt_id ?? '')
    || !['accepted', 'deduped'].includes(value.receipt_status)
    || !isCanonicalTimestamp(value.persisted_at)
  ) {
    throw new Error('invalid receipt');
  }
}

function validateStoredCredential(value, state) {
  if (
    !hasExactFields(value, [
      'credential_ref',
      'attempt_id',
      'account_id',
      'machine_id',
      'issued_at',
      'expires_at',
      'payload_hash',
    ])
    || !UUID_PATTERN.test(value.credential_ref ?? '')
    || value.attempt_id !== state.attempt_id
    || typeof value.account_id !== 'string'
    || value.account_id.length < 1
    || value.machine_id !== state.worker_id
    || !isCanonicalTimestamp(value.issued_at)
    || !isCanonicalTimestamp(value.expires_at)
    || !/^sha256:[a-f0-9]{64}$/.test(value.payload_hash ?? '')
  ) {
    throw new Error('invalid credential');
  }
}

function validateStoredWorkspace(value, state) {
  if (
    !hasExactFields(value, [
      'repo',
      'branch',
      'base_sha',
      'expected_head_sha',
      'head_sha',
      'mode',
      'path',
      'mirror_path',
      'admin_path',
      'owner',
    ])
    || typeof value.repo !== 'string'
    || value.repo.length < 1
    || typeof value.branch !== 'string'
    || value.branch.length < 1
    || !SHA1_PATTERN.test(value.base_sha ?? '')
    || (
      value.expected_head_sha !== null
      && !SHA1_PATTERN.test(value.expected_head_sha ?? '')
    )
    || !SHA1_PATTERN.test(value.head_sha ?? '')
    || !['read-only', 'read-write'].includes(value.mode)
    || !path.isAbsolute(value.path ?? '')
    || !path.isAbsolute(value.mirror_path ?? '')
    || !path.isAbsolute(value.admin_path ?? '')
    || !hasExactFields(value.owner, ['run_id', 'attempt_id'])
    || value.owner.run_id !== state.run_id
    || value.owner.attempt_id !== state.attempt_id
  ) {
    throw new Error('invalid workspace');
  }
}

function validateStoredLabels(value, state) {
  if (
    !hasExactFields(value, [
      'cecelia.fleet.attempt_id',
      'cecelia.fleet.run_id',
      'cecelia.fleet.worker_id',
    ])
    || value['cecelia.fleet.attempt_id'] !== state.attempt_id
    || value['cecelia.fleet.run_id'] !== state.run_id
    || value['cecelia.fleet.worker_id'] !== state.worker_id
  ) {
    throw new Error('invalid labels');
  }
}

function validateStoredQuarantine(value, state) {
  if (
    !hasExactFields(value, [
      'status',
      'attempt_id',
      'path',
      'admin_path',
      'reason',
    ])
    || value.status !== 'quarantined'
    || value.attempt_id !== state.attempt_id
    || !path.isAbsolute(value.path ?? '')
    || !path.isAbsolute(value.admin_path ?? '')
    || typeof value.reason !== 'string'
    || value.reason.length < 1
    || value.reason.length > 256
    || !/^attempt_[a-z0-9_:-]+$/.test(value.reason)
  ) {
    throw new Error('invalid quarantine');
  }
}

function validateDurableAttemptState(state, attemptId = state?.attempt_id) {
  try {
    const requiredFields = [
      'schema_version',
      'attempt_id',
      'task_id',
      'run_id',
      'worker_id',
      'lease_owner',
      'lease_generation',
      'provider',
      'brain_url',
      'result_channel',
      'container_id',
      'workspace',
      'labels',
      'status',
      'created_at',
      'updated_at',
    ];
    if (
      !state
      || typeof state !== 'object'
      || Array.isArray(state)
      || state.schema_version !== ATTEMPT_STATE_VERSION
      || state.attempt_id !== attemptId
      || !UUID_PATTERN.test(state.attempt_id ?? '')
      || !UUID_PATTERN.test(state.run_id ?? '')
      || !CANONICAL_MACHINE_IDS.has(state.worker_id)
      || typeof state.task_id !== 'string'
      || state.task_id.length < 1
      || state.task_id.length > 256
      || /[\r\n]/.test(state.task_id)
      || typeof state.lease_owner !== 'string'
      || state.lease_owner.length < 1
      || state.lease_owner.length > 256
      || /[\r\n]/.test(state.lease_owner)
      || !Number.isInteger(state.lease_generation)
      || state.lease_generation < 0
      || !PROVIDER_PATTERN.test(state.provider ?? '')
      || typeof state.container_id !== 'string'
      || state.container_id.length < 1
      || state.container_id.length > 256
      || /[\r\n]/.test(state.container_id)
      || ![
        'running',
        'mutation_pending',
        'cancel_pending',
        'callback_pending',
        'cleanup_pending',
        'quarantined',
      ]
        .includes(state.status)
      || requiredFields.some((field) => !Object.hasOwn(state, field))
      || Object.keys(state).some((field) => !ATTEMPT_STATE_FIELDS.has(field))
      || stateContainsForbiddenField(state)
      || !isCanonicalTimestamp(state.created_at)
      || !isCanonicalTimestamp(state.updated_at)
    ) {
      throw new Error('invalid state');
    }
    validateBrainUrl(state.brain_url);
    const resultChannel = validateResultChannel(state.result_channel, {
      task_id: state.task_id,
      run_id: state.run_id,
      attempt_id: state.attempt_id,
      role: state.result_channel?.bindings?.role,
    });
    validateStoredWorkspace(state.workspace, state);
    validateStoredLabels(state.labels, state);
    if (Object.hasOwn(state, 'credential')) {
      if (state.provider !== 'codex') throw new Error('unexpected credential');
      validateStoredCredential(state.credential, state);
    }
    if (Object.hasOwn(state, 'github_mutation_policy')) {
      validateGithubMutationPolicy(
        state.github_mutation_policy,
        state.workspace,
        state.result_channel.bindings.role,
      );
    }
    if (state.status === 'running') {
      if (
        Object.hasOwn(state, 'container_removed')
        || Object.hasOwn(state, 'delivery')
        || Object.hasOwn(state, 'receipt')
        || Object.hasOwn(state, 'quarantine')
        || Object.hasOwn(state, 'cancel_requested_at')
      ) {
        throw new Error('invalid running state');
      }
    } else if (state.status === 'mutation_pending') {
      if (
        typeof state.container_removed !== 'boolean'
        || !Object.hasOwn(state, 'github_mutation_policy')
        || Object.hasOwn(state, 'delivery')
        || Object.hasOwn(state, 'receipt')
      ) {
        throw new Error('invalid mutation state');
      }
    } else if (state.status === 'cancel_pending') {
      if (
        typeof state.container_removed !== 'boolean'
        || !isCanonicalTimestamp(state.cancel_requested_at)
        || Object.hasOwn(state, 'delivery')
        || Object.hasOwn(state, 'receipt')
      ) {
        throw new Error('invalid cancel state');
      }
      if (Object.hasOwn(state, 'quarantine')) {
        validateStoredQuarantine(state.quarantine, state);
      }
    } else if (state.status === 'callback_pending') {
      if (
        typeof state.container_removed !== 'boolean'
        || Object.hasOwn(state, 'receipt')
        || Object.hasOwn(state, 'quarantine')
        || Object.hasOwn(state, 'cancel_requested_at')
      ) {
        throw new Error('invalid callback state');
      }
      validateStoredDelivery(state.delivery, resultChannel);
    } else if (state.status === 'cleanup_pending') {
      if (
        state.container_removed !== true
        || Object.hasOwn(state, 'quarantine')
        || Object.hasOwn(state, 'cancel_requested_at')
      ) {
        throw new Error('invalid cleanup state');
      }
      validateStoredDelivery(state.delivery, resultChannel);
      validateStoredReceipt(state.receipt);
    } else {
      if (Object.hasOwn(state, 'cancel_requested_at')) {
        throw new Error('invalid quarantine state');
      }
      validateStoredQuarantine(state.quarantine, state);
      if (
        Object.hasOwn(state, 'container_removed')
        && typeof state.container_removed !== 'boolean'
      ) {
        throw new Error('invalid quarantine container state');
      }
      if (Object.hasOwn(state, 'delivery')) {
        validateStoredDelivery(state.delivery, resultChannel);
      }
      if (Object.hasOwn(state, 'receipt')) validateStoredReceipt(state.receipt);
    }
    return state;
  } catch {
    throw new Error(`attempt_state_corrupt:${attemptId}`);
  }
}

function decodeStrictUtf8(bytes, errorCode) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(errorCode);
  }
}

function readOwnedRegularFile(filePath, {
  maxBytes,
  minBytes = 1,
  errorCode,
  missingIsNull = false,
} = {}) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY
        | fs.constants.O_NONBLOCK
        | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (missingIsNull && error?.code === 'ENOENT') return null;
    throw new Error(errorCode);
  }
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile()
      || (before.mode & 0o777) !== 0o600
      || before.size < minBytes
      || before.size > maxBytes
    ) {
      throw new Error(errorCode);
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (
      offset !== bytes.length
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
    ) {
      throw new Error(errorCode);
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function createFileAttemptStateStore({ stateRoot } = {}) {
  const root = assertRuntimeRoot(stateRoot, 'state_root');
  const assertOwnedRoot = createOwnedPrivateRootGuard(
    root,
    'attempt_state_root_unsafe',
  );

  function fileFor(attemptId) {
    assertOwnedRoot();
    assertAttemptId(attemptId);
    return path.join(root, `${attemptId}.json`);
  }

  function parseState(serialized, attemptId) {
    try {
      const state = JSON.parse(serialized);
      return validateDurableAttemptState(state, attemptId);
    } catch {
      throw new Error(`attempt_state_corrupt:${attemptId}`);
    }
  }

  function readStateFile(target, attemptId) {
    try {
      const bytes = readOwnedRegularFile(target, {
        maxBytes: MAX_STATE_BYTES,
        errorCode: `attempt_state_corrupt:${attemptId}`,
        missingIsNull: true,
      });
      if (bytes === null) return null;
      return parseState(
        decodeStrictUtf8(bytes, `attempt_state_corrupt:${attemptId}`),
        attemptId,
      );
    } catch {
      throw new Error(`attempt_state_corrupt:${attemptId}`);
    }
  }

  return Object.freeze({
    async save(state) {
      assertAttemptId(state?.attempt_id);
      validateDurableAttemptState(state);
      const serialized = `${JSON.stringify(state)}\n`;
      if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
        throw new Error('attempt_state_too_large');
      }
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const target = fileFor(state.attempt_id);
      const temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(temporary, serialized, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
        const temporaryFd = fs.openSync(temporary, fs.constants.O_RDONLY);
        try {
          fs.fsyncSync(temporaryFd);
        } finally {
          fs.closeSync(temporaryFd);
        }
        fs.renameSync(temporary, target);
        const rootFd = fs.openSync(root, fs.constants.O_RDONLY);
        try {
          fs.fsyncSync(rootFd);
        } finally {
          fs.closeSync(rootFd);
        }
      } finally {
        fs.rmSync(temporary, { force: true });
      }
      return state;
    },

    async get(attemptId) {
      const target = fileFor(attemptId);
      return readStateFile(target, attemptId);
    },

    async delete(attemptId) {
      fs.rmSync(fileFor(attemptId), { force: true });
      return true;
    },

    async list() {
      assertOwnedRoot();
      let entries;
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
      return entries
        .filter((entry) => UUID_PATTERN.test(entry.name.replace(/\.json$/, '')))
        .filter((entry) => entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
          const attemptId = entry.name.slice(0, -'.json'.length);
          return readStateFile(path.join(root, entry.name), attemptId);
        })
        .filter((state) => state !== null);
    },
  });
}

function envArgs(values) {
  const args = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    args.push('--env', `${key}=${String(value)}`);
  }
  return args;
}

function labelArgs(labels) {
  const args = [];
  for (const [key, value] of Object.entries(labels)) {
    args.push('--label', `${key}=${value}`);
  }
  return args;
}

function validateBrainUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error('attempt_brain_url_invalid');
  }
  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || parsed.pathname !== '/'
      || parsed.origin !== value
    ) {
      throw new Error('attempt_brain_url_invalid');
    }
    return parsed.origin;
  } catch {
    throw new Error('attempt_brain_url_invalid');
  }
}

function assertExactFields(value, allowed, errorPrefix) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`${errorPrefix}:${field}`);
    }
  }
}

function validateResultChannel(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_result_channel_invalid');
  }
  assertExactFields(
    value,
    RESULT_CHANNEL_FIELDS,
    'attempt_result_channel_unknown_field',
  );
  if (value.version !== RESULT_CHANNEL_VERSION) {
    throw new Error('attempt_result_channel_version_invalid');
  }
  if (
    !Number.isInteger(value.max_bytes)
    || value.max_bytes <= 0
    || value.max_bytes > RESULT_CHANNEL_MAX_BYTES
  ) {
    throw new Error('attempt_result_channel_max_bytes_invalid');
  }
  if (
    !value.bindings
    || typeof value.bindings !== 'object'
    || Array.isArray(value.bindings)
  ) {
    throw new Error('attempt_result_channel_bindings_invalid');
  }
  assertExactFields(
    value.bindings,
    RESULT_CHANNEL_BINDING_FIELDS,
    'attempt_result_channel_binding_unknown_field',
  );
  if (
    typeof value.bindings.task_id !== 'string'
    || value.bindings.task_id.length === 0
    || /[\r\n]/.test(value.bindings.task_id)
  ) {
    throw new Error('attempt_result_channel_task_id_invalid');
  }
  if (!UUID_PATTERN.test(value.bindings.run_id ?? '')) {
    throw new Error('attempt_result_channel_run_id_invalid');
  }
  if (!UUID_PATTERN.test(value.bindings.attempt_id ?? '')) {
    throw new Error('attempt_result_channel_attempt_id_invalid');
  }
  if (!ROLE_PATTERN.test(value.bindings.role ?? '')) {
    throw new Error('attempt_result_channel_role_invalid');
  }
  const expectedPath = `${RESULT_CHANNEL_ROOT}/${value.bindings.attempt_id}.result.json`;
  if (
    value.path !== expectedPath
    || value.path.includes('..')
    || /[\r\n]/.test(value.path)
  ) {
    throw new Error('attempt_result_channel_path_mismatch');
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value.bindings[field] !== expectedValue) {
      throw new Error(`attempt_result_channel_${field}_mismatch`);
    }
  }
  return Object.freeze({
    version: value.version,
    path: value.path,
    max_bytes: value.max_bytes,
    bindings: Object.freeze({
      task_id: value.bindings.task_id,
      run_id: value.bindings.run_id,
      attempt_id: value.bindings.attempt_id,
      role: value.bindings.role,
    }),
  });
}

function validateGithubMutationPolicy(value, workspaceSpec, role) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_github_mutation_policy_invalid');
  }
  assertExactFields(
    value,
    GITHUB_MUTATION_POLICY_FIELDS,
    'attempt_github_mutation_policy_unknown_field',
  );
  if (
    role !== 'generator'
    || value.version !== 'github-mutation/v1'
    || value.repo !== 'perfectuser21/cecelia'
    || !/^cp-[a-z0-9][a-z0-9._-]{0,126}$/.test(value.branch ?? '')
    || value.branch.includes('..')
    || !SHA1_PATTERN.test(value.base_sha ?? '')
    || (
      value.expected_remote_sha !== null
      && !SHA1_PATTERN.test(value.expected_remote_sha ?? '')
    )
    || !['push-and-create-draft', 'push-existing-draft'].includes(value.operation)
    || value.pr_base !== 'main'
    || typeof value.pr_title !== 'string'
    || value.pr_title.length < 1
    || value.pr_title.length > 256
    || /[\r\n\0]/.test(value.pr_title)
    || typeof value.pr_body !== 'string'
    || value.pr_body.length < 1
    || value.pr_body.length > 4096
    || value.pr_body.includes('\0')
    || !Array.isArray(value.allowed_paths)
    || value.allowed_paths.length < 1
    || value.allowed_paths.length > 64
    || value.allowed_paths.some((entry) => (
      typeof entry !== 'string'
      || entry.length < 1
      || entry.length > 1024
      || entry.startsWith('/')
      || /[\r\n\\\0]/.test(entry)
      || entry.split('/').filter(Boolean).some((part) => part === '.' || part === '..')
    ))
    || workspaceSpec?.repo !== value.repo
    || workspaceSpec?.branch !== value.branch
    || workspaceSpec?.base_sha !== value.base_sha
    || workspaceSpec?.expected_head_sha !== value.expected_remote_sha
    || workspaceSpec?.mode !== 'read-write'
  ) {
    throw new Error('attempt_github_mutation_policy_invalid');
  }
  return Object.freeze({
    ...value,
    allowed_paths: Object.freeze([...value.allowed_paths]),
  });
}

function freshenResultTarget(attemptRuntime, resultChannel) {
  const resultTarget = path.join(attemptRuntime, path.basename(resultChannel.path));
  const expectedTarget = path.join(
    attemptRuntime,
    `${resultChannel.bindings.attempt_id}.result.json`,
  );
  if (resultTarget !== expectedTarget) {
    throw new Error('attempt_result_target_path_mismatch');
  }

  let descriptor;
  try {
    let existing;
    try {
      existing = fs.lstatSync(resultTarget);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (existing?.isSymbolicLink()) {
      throw new Error('attempt_result_target_symlink');
    }
    if (existing && !existing.isFile()) {
      throw new Error('attempt_result_target_not_regular');
    }
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    descriptor = fs.openSync(
      resultTarget,
      fs.constants.O_WRONLY
        | fs.constants.O_TRUNC
        | noFollow
        | (existing ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL),
      0o600,
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error('attempt_result_target_not_regular');
    }
    fs.fchmodSync(descriptor, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const finalStat = fs.lstatSync(resultTarget);
  if (!finalStat.isFile() || finalStat.isSymbolicLink()) {
    throw new Error('attempt_result_target_not_regular');
  }
  return resultTarget;
}

function parseDockerLabels(serialized) {
  const labels = {};
  for (const pair of String(serialized ?? '').split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    labels[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return labels;
}

function isFrozenFleetCanary(providerStdin, {
  attemptId,
  runId,
  taskId,
  role,
} = {}) {
  try {
    const bundle = JSON.parse(providerStdin)?.task_bundle;
    return bundle?.expected_output === 'harness-result/canary-v1'
      && bundle?.skill === null
      && role === 'reporter'
      && bundle?.attempt_id === attemptId
      && bundle?.run_id === runId
      && bundle?.role === role
      && bundle?.inputs?.task_id === taskId;
  } catch {
    return false;
  }
}

function createDockerAdapter({
  runCommand = defaultRunCommand,
  runtimeRoot,
  writeCredential = defaultWriteCredential,
} = {}) {
  const root = assertRuntimeRoot(runtimeRoot, 'runtime_root');
  const assertOwnedRoot = createOwnedPrivateRootGuard(
    root,
    'attempt_runtime_root_unsafe',
  );
  if (typeof runCommand !== 'function') {
    throw new Error('attempt_runner_invalid_docker_command_runner');
  }
  if (typeof writeCredential !== 'function') {
    throw new Error('attempt_runner_invalid_credential_writer');
  }

  async function readSession({ attemptId } = {}) {
    assertOwnedRoot();
    assertAttemptId(attemptId);
    const sessionPath = path.join(root, attemptId, `${attemptId}.session.json`);
    const sessionBytes = readOwnedRegularFile(sessionPath, {
      maxBytes: PROVIDER_SESSION_MAX_BYTES,
      errorCode: 'attempt_session_invalid',
      missingIsNull: true,
    });
    if (sessionBytes === null) return null;
    let session;
    try {
      session = JSON.parse(decodeStrictUtf8(sessionBytes, 'attempt_session_invalid'));
    } catch {
      throw new Error('attempt_session_invalid');
    }
    if (
      !hasExactFields(session, [
        'attempt_id',
        'contract_version',
        'provider',
        'session_id',
      ])
      || session.contract_version !== 'provider-session/v1'
      || session.attempt_id !== attemptId
      || !PROVIDER_PATTERN.test(session.provider ?? '')
      || typeof session.session_id !== 'string'
      || session.session_id.length < 1
      || session.session_id.length > 16_384
      || /[\r\n]/.test(session.session_id)
    ) {
      throw new Error('attempt_session_invalid');
    }
    return Object.freeze(session);
  }

  return Object.freeze({
    async launch(input) {
      assertOwnedRoot();
      const attemptId = input?.attemptId;
      assertAttemptId(attemptId);
      if (
        typeof input.taskId !== 'string'
        || input.taskId.length === 0
        || /[\r\n]/.test(input.taskId)
      ) {
        throw new Error('attempt_task_id_invalid');
      }
      const brainUrl = validateBrainUrl(input.brainUrl);
      const resultChannel = validateResultChannel(input.resultChannel, {
        task_id: input.taskId,
        run_id: input.runId,
        attempt_id: attemptId,
        role: input.role,
      });
      if (
        input.workspaceMount?.target !== '/workspace'
        || typeof input.workspaceMount?.source !== 'string'
        || !path.isAbsolute(input.workspaceMount.source)
      ) {
        throw new Error('attempt_workspace_mount_invalid');
      }
      if (
        typeof input.workspaceAdminMount?.source !== 'string'
        || !path.isAbsolute(input.workspaceAdminMount.source)
        || input.workspaceAdminMount.target !== input.workspaceAdminMount.source
      ) {
        throw new Error('attempt_workspace_admin_mount_invalid');
      }
      const attemptRuntime = path.join(root, attemptId);
      fs.mkdirSync(attemptRuntime, { recursive: true, mode: 0o700 });
      const runtimeStat = fs.lstatSync(attemptRuntime);
      if (runtimeStat.isSymbolicLink()) {
        throw new Error('attempt_runtime_symlink');
      }
      if (!runtimeStat.isDirectory()) {
        throw new Error('attempt_runtime_not_directory');
      }
      const promptFile = path.join(attemptRuntime, 'task-bundle.json');
      const stdoutFile = path.join(attemptRuntime, 'stdout.jsonl');
      freshenResultTarget(attemptRuntime, resultChannel);
      const isCodex = input.providerSpec?.provider === 'codex';
      const isCanary = isFrozenFleetCanary(input.providerSpec?.stdin, {
        attemptId,
        runId: input.runId,
        taskId: input.taskId,
        role: input.role,
      });
      const usesCredential = isCodex && !isCanary;
      if (
        usesCredential
        && (
          !UUID_PATTERN.test(input.credential?.credentialRef ?? '')
          || typeof input.credential?.authJson !== 'string'
          || input.credential.authJson.length === 0
          || Buffer.byteLength(input.credential.authJson, 'utf8') > 196_608
        )
      ) {
        fs.rmSync(attemptRuntime, { recursive: true, force: true });
        throw new Error('attempt_credential_invalid');
      }
      fs.writeFileSync(promptFile, input.providerSpec.stdin, {
        encoding: 'utf8',
        mode: 0o600,
      });

      const containerName = `cecelia-fleet-${attemptId}`;
      const containerPrompt = '/tmp/cecelia-prompts/task-bundle.json';
      const containerStdout = '/tmp/cecelia-prompts/stdout.jsonl';
      const credentialFifo = path.join(attemptRuntime, 'credential.fifo');
      const containerCredentialFifo = '/tmp/cecelia-prompts/credential.fifo';
      const workspaceMount = [
        `type=bind,src=${input.workspaceMount.source},dst=/workspace`,
        input.workspaceMount.readOnly ? 'readonly' : null,
      ].filter(Boolean).join(',');
      const runtimeMount = `type=bind,src=${attemptRuntime},dst=/tmp/cecelia-prompts`;
      const workspaceAdminMount = [
        `type=bind,src=${input.workspaceAdminMount.source},dst=${input.workspaceAdminMount.target}`,
        input.workspaceAdminMount.readOnly ? 'readonly' : null,
      ].filter(Boolean).join(',');
      const createArgs = [
        'create',
        '--name',
        containerName,
        ...labelArgs(input.labels),
        '--mount',
        workspaceMount,
        '--mount',
        workspaceAdminMount,
        '--mount',
        runtimeMount,
        ...(usesCredential
          ? [
              '--tmpfs',
              '/home/cecelia/.codex:rw,noexec,nosuid,nodev,mode=0700',
            ]
          : []),
        '--add-host',
        'host.docker.internal:host-gateway',
        ...envArgs({
          CECELIA_EXECUTOR: input.providerSpec.provider,
          CECELIA_TASK_ID: input.taskId,
          HARNESS_TASK_ID: input.taskId,
          HARNESS_ATTEMPT_ID: attemptId,
          HARNESS_RUN_ID: input.runId,
          HARNESS_LEASE_OWNER: input.lease.owner,
          HARNESS_LEASE_GENERATION: input.lease.generation,
          HARNESS_READ_ONLY: String(input.workspaceMount.readOnly),
          HARNESS_CANARY: String(isCanary),
          HARNESS_NODE: input.role,
          HARNESS_MODEL: input.model,
          HARNESS_TASK_BUNDLE_FILE: containerPrompt,
          CECELIA_PROMPT_FILE: containerPrompt,
          CECELIA_STDOUT_FILE: containerStdout,
          BRAIN_RESULT_FILE: resultChannel.path,
          BRAIN_RESULT_MAX_BYTES: resultChannel.max_bytes,
          BRAIN_RESULT_CHANNEL_VERSION: resultChannel.version,
          CECELIA_CREDENTIAL_FIFO: usesCredential
            ? containerCredentialFifo
            : undefined,
          CECELIA_CREDENTIAL_REF: usesCredential
            ? input.credential.credentialRef
            : undefined,
          WORKTREE_PATH: '/workspace',
          BRAIN_URL: brainUrl,
        }),
        input.image,
      ];
      let created;
      try {
        created = await runCommand('docker', createArgs);
        if (!String(created?.stdout ?? '').trim()) {
          throw new Error('attempt_container_id_missing');
        }
        if (usesCredential) {
          await runCommand('mkfifo', ['-m', '600', credentialFifo], undefined);
        }
        await runCommand('docker', ['start', containerName], undefined);
        if (usesCredential) {
          try {
            await writeCredential(credentialFifo, input.credential.authJson);
          } finally {
            fs.rmSync(credentialFifo, { force: true });
          }
        }
      } catch (error) {
        await runCommand('docker', ['rm', '-f', '--', containerName], undefined)
          .catch(() => {});
        fs.rmSync(attemptRuntime, { recursive: true, force: true });
        throw error;
      }
      const containerId = String(created?.stdout ?? '').trim();
      return Object.freeze({ containerId });
    },

    async inspect({ containerId } = {}) {
      try {
        const result = await runCommand('docker', [
          'inspect',
          '--format',
          '{{.State.Status}}',
          containerId,
        ]);
        return Object.freeze({
          status: String(result?.stdout ?? '').trim() || 'unknown',
        });
      } catch {
        return Object.freeze({ status: 'missing' });
      }
    },

    async wait({ containerId } = {}) {
      const result = await runCommand(
        'docker',
        ['wait', '--', containerId],
        undefined,
      );
      const statusCode = Number.parseInt(String(result?.stdout ?? '').trim(), 10);
      return Object.freeze({
        statusCode: Number.isInteger(statusCode) ? statusCode : null,
      });
    },

    async remove({
      containerId,
      attemptId,
      containerMissing = false,
      preserveRuntime = false,
    } = {}) {
      assertOwnedRoot();
      assertAttemptId(attemptId);
      if (!containerMissing) {
        await runCommand('docker', ['rm', '-f', '--', containerId], undefined);
      }
      if (!preserveRuntime) {
        fs.rmSync(path.join(root, attemptId), { recursive: true, force: true });
      }
      return Object.freeze({ removed: true });
    },

    async readResult({ attemptId, resultChannel } = {}) {
      assertOwnedRoot();
      assertAttemptId(attemptId);
      const channel = validateResultChannel(resultChannel, {
        task_id: resultChannel?.bindings?.task_id,
        run_id: resultChannel?.bindings?.run_id,
        attempt_id: attemptId,
        role: resultChannel?.bindings?.role,
      });
      const attemptRuntime = path.join(root, attemptId);
      const resultPath = path.join(attemptRuntime, `${attemptId}.result.json`);
      const resultBytes = readOwnedRegularFile(resultPath, {
        maxBytes: channel.max_bytes,
        errorCode: 'attempt_result_invalid',
        missingIsNull: true,
      });
      if (resultBytes === null) throw new Error('attempt_result_missing');
      let result;
      try {
        const text = decodeStrictUtf8(resultBytes, 'attempt_result_invalid');
        result = JSON.parse(text);
      } catch {
        throw new Error('attempt_result_invalid');
      }
      if (
        !result
        || typeof result !== 'object'
        || Array.isArray(result)
        || result.attempt_id !== attemptId
        || !TERMINAL_RESULT_STATUSES.has(result.status)
      ) {
        throw new Error('attempt_result_invalid');
      }
      const session = await readSession({ attemptId });
      return Object.freeze({
        resultBytes,
        terminalStatus: result.status,
        session: session == null ? null : Object.freeze(session),
      });
    },

    async readGithubMutation({ attemptId, resultChannel } = {}) {
      assertAttemptId(attemptId);
      const channel = validateResultChannel(resultChannel, {
        task_id: resultChannel?.bindings?.task_id,
        run_id: resultChannel?.bindings?.run_id,
        attempt_id: attemptId,
        role: 'generator',
      });
      const attemptRuntime = path.join(root, attemptId);
      const declarationBytes = readOwnedRegularFile(
        path.join(attemptRuntime, `${attemptId}.result.json`),
        {
          maxBytes: channel.max_bytes,
          errorCode: 'attempt_github_mutation_declaration_invalid',
          missingIsNull: true,
        },
      );
      const providerResultBytes = readOwnedRegularFile(
        path.join(attemptRuntime, `${attemptId}.provider.json`),
        {
          maxBytes: channel.max_bytes,
          errorCode: 'attempt_github_mutation_provider_result_invalid',
          missingIsNull: true,
        },
      );
      if (declarationBytes === null) {
        throw new Error('attempt_github_mutation_evidence_missing');
      }
      // The Runner stages provider.json only for a successful Generator result.
      // A missing provider result therefore means result.json is already the
      // canonical failed result and must bypass every GitHub write.
      if (providerResultBytes === null) return null;
      return Object.freeze({ declarationBytes, providerResultBytes });
    },

    async writeResult({ attemptId, resultChannel, resultBytes } = {}) {
      assertAttemptId(attemptId);
      const channel = validateResultChannel(resultChannel, {
        task_id: resultChannel?.bindings?.task_id,
        run_id: resultChannel?.bindings?.run_id,
        attempt_id: attemptId,
        role: 'generator',
      });
      if (
        !Buffer.isBuffer(resultBytes)
        || resultBytes.length < 2
        || resultBytes.length > channel.max_bytes
      ) {
        throw new Error('attempt_result_invalid');
      }
      const attemptRuntime = path.join(root, attemptId);
      const target = path.join(attemptRuntime, `${attemptId}.result.json`);
      const temporary = path.join(
        attemptRuntime,
        `.${attemptId}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
      );
      let descriptor;
      try {
        descriptor = fs.openSync(
          temporary,
          fs.constants.O_WRONLY
            | fs.constants.O_CREAT
            | fs.constants.O_EXCL
            | (fs.constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        fs.writeFileSync(descriptor, resultBytes);
        fs.fsyncSync(descriptor);
        fs.fchmodSync(descriptor, 0o600);
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
      const current = fs.lstatSync(target);
      if (!current.isFile() || current.isSymbolicLink()) {
        fs.rmSync(temporary, { force: true });
        throw new Error('attempt_result_invalid');
      }
      fs.renameSync(temporary, target);
      return Object.freeze({ written: true });
    },

    readSession,

    async cleanupRuntime({ attemptId } = {}) {
      assertOwnedRoot();
      assertAttemptId(attemptId);
      fs.rmSync(path.join(root, attemptId), { recursive: true, force: true });
      return Object.freeze({ cleaned: true });
    },

    async listOwned({ workerId } = {}) {
      const result = await runCommand('docker', [
        'ps',
        '-a',
        '--filter',
        `label=cecelia.fleet.worker_id=${workerId}`,
        '--format',
        '{{json .}}',
      ]);
      return String(result?.stdout ?? '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const row = JSON.parse(line);
          return {
            containerId: row.ID,
            labels: parseDockerLabels(row.Labels),
          };
        });
    },
  });
}

function requireMethod(value, method, name) {
  if (typeof value?.[method] !== 'function') {
    throw new Error(`attempt_runner_invalid_${name}.${method}`);
  }
}

function validateDependencies({
  workspaceManager,
  docker,
  stateStore,
  workerId,
  runnerImageDigest,
  credentialConsumer,
  resultDelivery,
  githubMutationBroker,
}) {
  for (const method of ['prepare', 'verify', 'cleanup', 'quarantine', 'reconcile']) {
    requireMethod(workspaceManager, method, 'workspace_manager');
  }
  for (const method of [
    'launch',
    'inspect',
    'wait',
    'remove',
    'readResult',
    'readGithubMutation',
    'writeResult',
    'cleanupRuntime',
    'listOwned',
  ]) {
    requireMethod(docker, method, 'docker');
  }
  for (const method of ['save', 'get', 'delete', 'list']) {
    requireMethod(stateStore, method, 'state_store');
  }
  requireMethod(credentialConsumer, 'consume', 'credential_consumer');
  for (const method of ['prepare', 'deliver']) {
    requireMethod(resultDelivery, method, 'result_delivery');
  }
  requireMethod(githubMutationBroker, 'execute', 'github_mutation_broker');
  if (!CANONICAL_MACHINE_IDS.has(workerId)) {
    throw new Error('attempt_runner_invalid_worker_id');
  }
  if (!IMAGE_DIGEST_PATTERN.test(runnerImageDigest ?? '')) {
    throw new Error('attempt_runner_invalid_runner_digest');
  }
}

function validateProviderSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_provider_spec_invalid');
  }
  for (const field of Object.keys(value)) {
    if (!PROVIDER_FIELDS.has(field)) {
      throw new Error(`attempt_provider_spec_unknown_field:${field}`);
    }
  }
  if (!PROVIDER_PATTERN.test(value.provider ?? '')) {
    throw new Error('attempt_provider_invalid');
  }
  if (
    typeof value.command !== 'string'
    || value.command.length === 0
    || /[\/\r\n]/.test(value.command)
  ) {
    throw new Error('attempt_provider_command_invalid');
  }
  if (
    !Array.isArray(value.args)
    || value.args.some((arg) => typeof arg !== 'string' || /[\r\n\0]/.test(arg))
  ) {
    throw new Error('attempt_provider_args_invalid');
  }
  if (typeof value.stdin !== 'string') {
    throw new Error('attempt_provider_stdin_invalid');
  }
  const validOutput = (
    typeof value.output === 'string'
    && value.output.length > 0
  ) || (
    value.output
    && typeof value.output === 'object'
    && !Array.isArray(value.output)
  );
  if (!validOutput) {
    throw new Error('attempt_provider_output_invalid');
  }
  return Object.freeze({
    provider: value.provider,
    command: value.command,
    args: Object.freeze([...value.args]),
    stdin: value.stdin,
    output: typeof value.output === 'string'
      ? value.output
      : Object.freeze({ ...value.output }),
  });
}

function validateTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_target_invalid');
  }
  assertExactFields(value, TARGET_FIELDS, 'attempt_target_unknown_field');
  if (!CANONICAL_MACHINE_IDS.has(value.machine)) {
    throw new Error('attempt_target_machine_invalid');
  }
  if (!PROVIDER_PATTERN.test(value.provider ?? '')) {
    throw new Error('attempt_target_provider_invalid');
  }
  if (
    typeof value.role !== 'string'
    || !ROLE_PATTERN.test(value.role)
  ) {
    throw new Error('attempt_target_role_invalid');
  }
  if (value.model != null && (
    typeof value.model !== 'string'
    || value.model.length === 0
    || /[\r\n]/.test(value.model)
  )) {
    throw new Error('attempt_target_model_invalid');
  }
  return Object.freeze({
    machine: value.machine,
    provider: value.provider,
    account: value.account ?? null,
    model: value.model ?? null,
    role: value.role,
  });
}

function validateLaunchRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_launch_request_invalid');
  }
  assertExactFields(value, LAUNCH_FIELDS, 'attempt_launch_request_unknown_field');
  if (!UUID_PATTERN.test(value.attempt_id ?? '')) {
    throw new Error('attempt_id_invalid');
  }
  if (!UUID_PATTERN.test(value.run_id ?? '')) {
    throw new Error('attempt_run_id_invalid');
  }
  if (
    typeof value.task_id !== 'string'
    || value.task_id.length === 0
    || /[\r\n]/.test(value.task_id)
  ) {
    throw new Error('attempt_task_id_invalid');
  }
  const target = validateTarget(value.target);
  if (target.provider !== 'codex') {
    throw new Error('attempt_provider_credential_broker_required');
  }
  if (['evaluator', 'reporter'].includes(target.role)) {
    throw new Error('attempt_github_read_broker_required');
  }
  const resultChannel = validateResultChannel(value.result_channel, {
    task_id: value.task_id,
    run_id: value.run_id,
    attempt_id: value.attempt_id,
    role: target.role,
  });
  if (
    !value.workspace_spec
    || typeof value.workspace_spec !== 'object'
    || Array.isArray(value.workspace_spec)
  ) {
    throw new Error('attempt_workspace_spec_invalid');
  }
  assertExactFields(
    value.workspace_spec,
    WORKSPACE_SPEC_FIELDS,
    'attempt_workspace_spec_unknown_field',
  );
  if (
    value.workspace_spec?.attempt_id !== value.attempt_id
    || value.workspace_spec?.run_id !== value.run_id
  ) {
    throw new Error('attempt_workspace_owner_mismatch');
  }
  const githubMutationPolicy = target.role === 'generator'
    && value.workspace_spec.mode === 'read-write'
    ? validateGithubMutationPolicy(
        value.github_mutation_policy,
        value.workspace_spec,
        target.role,
      )
    : null;
  if (
    (target.role !== 'generator' || value.workspace_spec.mode !== 'read-write')
    && value.github_mutation_policy !== undefined
  ) {
    throw new Error('attempt_github_mutation_policy_role_mismatch');
  }
  if (typeof value.lease_owner !== 'string' || value.lease_owner.length === 0) {
    throw new Error('attempt_lease_owner_invalid');
  }
  if (!Number.isInteger(value.lease_generation) || value.lease_generation < 0) {
    throw new Error('attempt_lease_generation_invalid');
  }
  const brainUrl = validateBrainUrl(value.brain_url);
  const providerSpec = validateProviderSpec(value.provider_spec);
  if (providerSpec.provider !== target.provider) {
    throw new Error('attempt_provider_target_mismatch');
  }
  return {
    request: value,
    providerSpec,
    target,
    resultChannel,
    githubMutationPolicy,
    brainUrl,
  };
}

function labelsFor(request, workerId) {
  return Object.freeze({
    'cecelia.fleet.attempt_id': request.attempt_id,
    'cecelia.fleet.run_id': request.run_id,
    'cecelia.fleet.worker_id': workerId,
  });
}

function isTerminalContainerStatus(status) {
  return ['missing', 'exited', 'dead', 'removed'].includes(status);
}

function assertLeaseFence(state, lease) {
  if (
    !lease
    || lease.owner !== state.lease_owner
    || lease.generation !== state.lease_generation
  ) {
    throw new Error('attempt_lease_conflict');
  }
}

function validateDeliveryMetadata(value, resultBytes, terminalStatus) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_delivery_metadata_invalid');
  }
  const fields = Object.keys(value).sort();
  const expectedFields = [...DELIVERY_METADATA_FIELDS].sort();
  if (
    fields.length !== expectedFields.length
    || fields.some((field, index) => field !== expectedFields[index])
    || !UUID_PATTERN.test(value.delivery_id ?? '')
    || !UUID_PATTERN.test(value.result_nonce ?? '')
    || !SHA256_PATTERN.test(value.result_sha256 ?? '')
    || value.result_sha256 !== createHash('sha256').update(resultBytes).digest('hex')
    || value.result_bytes !== resultBytes.length
    || value.terminal_status !== terminalStatus
  ) {
    throw new Error('attempt_delivery_metadata_invalid');
  }
  return Object.freeze({ ...value });
}

function safeReceiptMetadata(receipt) {
  if (
    !receipt
    || typeof receipt !== 'object'
    || Array.isArray(receipt)
    || receipt.schema_version !== 'fleet-attempt-result-receipt/v1'
    || !UUID_PATTERN.test(receipt.receipt_id ?? '')
    || !['accepted', 'deduped'].includes(receipt.receipt_status)
    || typeof receipt.persisted_at !== 'string'
    || Number.isNaN(Date.parse(receipt.persisted_at))
  ) {
    throw new Error('attempt_result_receipt_invalid');
  }
  return Object.freeze({
    receipt_id: receipt.receipt_id,
    receipt_status: receipt.receipt_status,
    persisted_at: receipt.persisted_at,
  });
}

function safeQuarantineReason(value) {
  const rawReason = String(value?.message ?? value?.reason ?? value ?? '');
  const reason = rawReason.match(/\battempt_[a-z0-9_:-]{1,240}\b/i)?.[0]
    ?.toLowerCase()
    ?? 'attempt_quarantined';
  return reason.slice(0, 256);
}

function safeQuarantineMetadata(value, state) {
  return Object.freeze({
    status: 'quarantined',
    attempt_id: state.attempt_id,
    path: typeof value?.path === 'string' ? value.path : state.workspace.path,
    admin_path: typeof value?.admin_path === 'string'
      ? value.admin_path
      : state.workspace.admin_path,
    reason: safeQuarantineReason(value),
  });
}

function createAttemptRunner({
  workspaceManager,
  docker,
  stateStore,
  workerId,
  runnerImageDigest,
  credentialConsumer,
  resultDelivery,
  githubMutationBroker,
} = {}) {
  validateDependencies({
    workspaceManager,
    docker,
    stateStore,
    workerId,
    runnerImageDigest,
    credentialConsumer,
    resultDelivery,
    githubMutationBroker,
  });

  const attemptLocks = new Map();

  function withAttemptLock(attemptId, operation) {
    const previous = attemptLocks.get(attemptId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    attemptLocks.set(attemptId, tail);
    void tail.then(() => {
      if (attemptLocks.get(attemptId) === tail) {
        attemptLocks.delete(attemptId);
      }
    });
    return result;
  }

  async function quarantineState(state, error) {
    const reason = safeQuarantineReason(error);
    const quarantined = safeQuarantineMetadata(
      await workspaceManager.quarantine(state.workspace, new Error(reason)),
      state,
    );
    const nextState = {
      ...state,
      status: 'quarantined',
      quarantine: quarantined,
      updated_at: new Date().toISOString(),
    };
    await stateStore.save(nextState);
    return Object.freeze({
      status: 'quarantined',
      attempt_id: state.attempt_id,
      reason: quarantined.reason,
    });
  }

  async function cleanupAckedState(state) {
    const cleaned = await workspaceManager.cleanup(state.workspace);
    if (cleaned.status === 'quarantined') {
      const quarantined = safeQuarantineMetadata(cleaned, state);
      await stateStore.save({
        ...state,
        status: 'quarantined',
        quarantine: quarantined,
        updated_at: new Date().toISOString(),
      });
      return Object.freeze({
        status: 'quarantined',
        attempt_id: state.attempt_id,
        reason: quarantined.reason,
      });
    }
    await docker.cleanupRuntime({ attemptId: state.attempt_id });
    await stateStore.delete(state.attempt_id);
    return Object.freeze({
      status: 'cleaned',
      attempt_id: state.attempt_id,
    });
  }

  async function readPendingResult(state) {
    const observed = await docker.readResult({
      attemptId: state.attempt_id,
      resultChannel: state.result_channel,
    });
    const digest = createHash('sha256').update(observed.resultBytes).digest('hex');
    if (
      state.delivery
      && (
        state.delivery.result_sha256 !== digest
        || state.delivery.result_bytes !== observed.resultBytes.length
        || state.delivery.terminal_status !== observed.terminalStatus
      )
    ) {
      throw new Error('attempt_pending_result_changed');
    }
    return observed;
  }

  async function ensurePendingContainerRemoved(state, { containerMissing = false } = {}) {
    if (state.container_removed === true) return state;
    await docker.remove({
      containerId: state.container_id,
      attemptId: state.attempt_id,
      preserveRuntime: true,
      ...(containerMissing ? { containerMissing: true } : {}),
    });
    const removed = {
      ...state,
      container_removed: true,
      updated_at: new Date().toISOString(),
    };
    await stateStore.save(removed);
    return removed;
  }

  async function deliverPendingState(
    inputState,
    observedResult = null,
    { containerMissing = false } = {},
  ) {
    let state;
    try {
      state = await ensurePendingContainerRemoved(inputState, { containerMissing });
    } catch (error) {
      return quarantineState(inputState, error);
    }
    let observed;
    try {
      observed = observedResult ?? await readPendingResult(state);
    } catch (error) {
      return quarantineState(state, error);
    }
    let receipt;
    try {
      receipt = await resultDelivery.deliver({
        state,
        resultBytes: observed.resultBytes,
        terminalStatus: observed.terminalStatus,
        session: observed.session,
        delivery: state.delivery,
      });
      receipt = safeReceiptMetadata(receipt);
    } catch {
      return Object.freeze({
        status: 'callback_pending',
        attempt_id: state.attempt_id,
      });
    }
    const cleanupPending = {
      ...state,
      status: 'cleanup_pending',
      receipt,
      updated_at: new Date().toISOString(),
    };
    await stateStore.save(cleanupPending);
    return cleanupAckedState(cleanupPending);
  }

  async function beginCallbackPending(
    state,
    { containerMissing = false, containerRemoved = false } = {},
  ) {
    let observed;
    try {
      observed = await readPendingResult(state);
    } catch (error) {
      return quarantineState(state, error);
    }
    let delivery;
    try {
      delivery = validateDeliveryMetadata(
        await resultDelivery.prepare({
          state,
          resultBytes: observed.resultBytes,
          terminalStatus: observed.terminalStatus,
          session: observed.session,
        }),
        observed.resultBytes,
        observed.terminalStatus,
      );
    } catch (error) {
      return quarantineState(state, error);
    }
    const callbackPending = {
      ...state,
      status: 'callback_pending',
      delivery,
      container_removed: containerRemoved || state.container_removed === true,
      updated_at: new Date().toISOString(),
    };
    // This durable write must happen before the only result-producing container
    // is removed. A restart can then replay the exact runtime bytes.
    await stateStore.save(callbackPending);
    return deliverPendingState(callbackPending, observed, { containerMissing });
  }

  async function continueGithubMutation(inputState) {
    let state = inputState;
    try {
      state = await ensurePendingContainerRemoved(state);
      const evidence = await docker.readGithubMutation({
        attemptId: state.attempt_id,
        resultChannel: state.result_channel,
      });
      if (evidence === null) {
        return beginCallbackPending(state, { containerRemoved: true });
      }
      const finalized = await githubMutationBroker.execute({
        state,
        policy: state.github_mutation_policy,
        declarationBytes: evidence.declarationBytes,
        providerResultBytes: evidence.providerResultBytes,
      });
      if (!Buffer.isBuffer(finalized?.resultBytes)) {
        throw new Error('attempt_github_mutation_result_invalid');
      }
      await docker.writeResult({
        attemptId: state.attempt_id,
        resultChannel: state.result_channel,
        resultBytes: finalized.resultBytes,
      });
      return beginCallbackPending(state, { containerRemoved: true });
    } catch (error) {
      return quarantineState(state, error);
    }
  }

  function cancelPendingResult(state) {
    return Object.freeze({
      status: 'cancel_pending',
      attempt_id: state.attempt_id,
    });
  }

  async function continueCancellation(inputState) {
    let state = inputState;
    if (state.quarantine) return cancelPendingResult(state);
    if (state.container_removed !== true) {
      try {
        const inspected = await docker.inspect({ containerId: state.container_id });
        state = await ensurePendingContainerRemoved(state, {
          containerMissing: inspected.status === 'missing',
        });
      } catch {
        return cancelPendingResult(state);
      }
    }
    let cleaned;
    try {
      cleaned = await workspaceManager.cleanup(state.workspace);
    } catch {
      return cancelPendingResult(state);
    }
    if (cleaned.status === 'quarantined') {
      const retained = {
        ...state,
        quarantine: safeQuarantineMetadata(cleaned, state),
        updated_at: new Date().toISOString(),
      };
      await stateStore.save(retained);
      return cancelPendingResult(retained);
    }
    try {
      await docker.cleanupRuntime({ attemptId: state.attempt_id });
      await stateStore.delete(state.attempt_id);
    } catch {
      return cancelPendingResult(state);
    }
    return Object.freeze({
      status: 'cancelled',
      attempt_id: state.attempt_id,
    });
  }

  const unlockedRunner = {
    async launch(input) {
      const {
        request,
        providerSpec,
        target,
        resultChannel,
        githubMutationPolicy,
        brainUrl,
      } = validateLaunchRequest(input);
      if (target.machine !== workerId) {
        throw new Error('attempt_target_worker_mismatch');
      }
      const existing = await stateStore.get(request.attempt_id);
      if (existing) {
        throw new Error('attempt_already_exists');
      }

      let credential = null;
      const isCanary = isFrozenFleetCanary(providerSpec.stdin, {
        attemptId: request.attempt_id,
        runId: request.run_id,
        taskId: request.task_id,
        role: target.role,
      });
      if (target.provider === 'codex' && !isCanary) {
        if (
          !request.credential_envelope
          || typeof request.credential_envelope !== 'object'
          || Array.isArray(request.credential_envelope)
        ) {
          throw new Error('credential_envelope_required');
        }
        credential = credentialConsumer.consume(request.credential_envelope, {
          attemptId: request.attempt_id,
          accountId: target.account,
          machineId: workerId,
        });
      }
      const workspace = await workspaceManager.prepare(request.workspace_spec);
      await workspaceManager.verify(workspace);
      const labels = labelsFor(request, workerId);
      let launched;
      try {
        launched = await docker.launch({
          attemptId: request.attempt_id,
          taskId: request.task_id,
          runId: request.run_id,
          workerId,
          image: runnerImageDigest,
          providerSpec,
          role: target.role,
          model: target.model,
          workspaceMount: {
            source: workspace.path,
            target: '/workspace',
            readOnly: workspace.mode === 'read-only',
          },
          workspaceAdminMount: {
            source: workspace.admin_path,
            target: workspace.admin_path,
            readOnly: workspace.mode === 'read-only',
          },
          labels,
          resultChannel,
          brainUrl,
          lease: {
            owner: request.lease_owner,
            generation: request.lease_generation,
          },
          credential,
        });
      } catch (error) {
        await workspaceManager.cleanup(workspace);
        throw error;
      }
      if (typeof launched?.containerId !== 'string' || launched.containerId.length === 0) {
        await workspaceManager.cleanup(workspace);
        throw new Error('attempt_container_id_missing');
      }

      const state = {
        schema_version: ATTEMPT_STATE_VERSION,
        attempt_id: request.attempt_id,
        task_id: request.task_id,
        run_id: request.run_id,
        worker_id: workerId,
        lease_owner: request.lease_owner,
        lease_generation: request.lease_generation,
        provider: providerSpec.provider,
        brain_url: brainUrl,
        result_channel: resultChannel,
        ...(githubMutationPolicy
          ? { github_mutation_policy: githubMutationPolicy }
          : {}),
        ...(credential ? { credential: credential.metadata } : {}),
        container_id: launched.containerId,
        workspace,
        labels,
        status: 'running',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      try {
        await stateStore.save(state);
      } catch (error) {
        try {
          await docker.remove({
            containerId: launched.containerId,
            attemptId: request.attempt_id,
          });
        } catch (cleanupError) {
          await workspaceManager.quarantine(workspace, cleanupError);
          throw error;
        }
        await workspaceManager.cleanup(workspace);
        throw error;
      }
      void docker.wait({ containerId: launched.containerId })
        .then(() => runner.terminal(request.attempt_id))
        .catch(() => {});
      return Object.freeze({
        attempt_id: request.attempt_id,
        run_id: request.run_id,
        actual_machine_id: workerId,
        execution_transport: 'fleet-worker',
        remote_job_id: launched.containerId,
        container_id: launched.containerId,
        workspace_head_sha: workspace.head_sha,
      });
    },

    async inspect(attemptId) {
      const state = await stateStore.get(attemptId);
      if (!state) {
        return Object.freeze({ status: 'missing', attempt_id: attemptId });
      }
      if (state.worker_id !== workerId) {
        throw new Error('attempt_worker_owner_mismatch');
      }
      const inspected = await docker.inspect({ containerId: state.container_id });
      return Object.freeze({
        attempt_id: attemptId,
        status: inspected.status,
        container_id: state.container_id,
      });
    },

    async terminal(attemptId, lease = null) {
      const state = await stateStore.get(attemptId);
      if (!state) {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      if (state.worker_id !== workerId) {
        throw new Error('attempt_worker_owner_mismatch');
      }
      if (lease !== null) {
        assertLeaseFence(state, lease);
      }
      if (state.status === 'cancel_pending') {
        return continueCancellation(state);
      }
      if (state.status === 'mutation_pending') {
        return continueGithubMutation(state);
      }
      if (state.status === 'callback_pending') {
        return deliverPendingState(state);
      }
      if (state.status === 'cleanup_pending') {
        return cleanupAckedState(state);
      }
      if (state.status === 'quarantined') {
        return Object.freeze({
          status: 'quarantined',
          attempt_id: state.attempt_id,
          reason: state.quarantine?.reason ?? 'retained',
        });
      }
      if (state.status !== 'running') {
        throw new Error('attempt_state_status_invalid');
      }
      if (state.github_mutation_policy) {
        const mutationPending = {
          ...state,
          status: 'mutation_pending',
          container_removed: false,
          updated_at: new Date().toISOString(),
        };
        await stateStore.save(mutationPending);
        return continueGithubMutation(mutationPending);
      }
      return beginCallbackPending(state);
    },

    async cancel(attemptId, lease) {
      const state = await stateStore.get(attemptId);
      if (!state) {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      assertLeaseFence(state, lease);
      if (['callback_pending', 'cleanup_pending'].includes(state.status)) {
        throw new Error('attempt_callback_pending');
      }
      if (state.status === 'quarantined') {
        return Object.freeze({
          status: 'quarantined',
          attempt_id: state.attempt_id,
          reason: state.quarantine?.reason ?? 'retained',
        });
      }
      if (state.status === 'cancel_pending') {
        return continueCancellation(state);
      }
      if (state.status !== 'running') {
        throw new Error('attempt_state_status_invalid');
      }
      const now = new Date().toISOString();
      const cancelPending = {
        ...state,
        status: 'cancel_pending',
        container_removed: false,
        cancel_requested_at: now,
        updated_at: now,
      };
      await stateStore.save(cancelPending);
      return continueCancellation(cancelPending);
    },

    async reconcile() {
      const states = await stateStore.list();
      const ownedStates = states.filter((state) => state.worker_id === workerId);
      const knownAttemptIds = new Set(ownedStates.map((state) => state.attempt_id));
      const retainedAttemptIds = new Set(states.map((state) => state.attempt_id));
      const cleanedAttempts = [];
      const cancelledAttempts = [];

      for (const listedState of ownedStates) {
        await withAttemptLock(listedState.attempt_id, async () => {
          const state = await stateStore.get(listedState.attempt_id);
          if (!state) {
            knownAttemptIds.delete(listedState.attempt_id);
            retainedAttemptIds.delete(listedState.attempt_id);
            return;
          }
          if (state.worker_id !== workerId || state.status === 'quarantined') return;
          if (state.status === 'cancel_pending') {
            const result = await continueCancellation(state);
            if (result.status === 'cancelled') {
              cancelledAttempts.push(state.attempt_id);
              retainedAttemptIds.delete(state.attempt_id);
            }
            return;
          }
          if (state.status === 'mutation_pending') {
            const result = await continueGithubMutation(state);
            if (result.status === 'cleaned') {
              cleanedAttempts.push(state.attempt_id);
              retainedAttemptIds.delete(state.attempt_id);
            }
            return;
          }
          if (state.status === 'callback_pending') {
            const inspected = state.container_removed === true
              ? null
              : await docker.inspect({ containerId: state.container_id });
            const result = await deliverPendingState(state, null, {
              containerMissing: inspected?.status === 'missing',
            });
            if (result.status === 'cleaned') {
              cleanedAttempts.push(state.attempt_id);
              retainedAttemptIds.delete(state.attempt_id);
            }
            return;
          }
          if (state.status === 'cleanup_pending') {
            const result = await cleanupAckedState(state);
            if (result.status === 'cleaned') {
              cleanedAttempts.push(state.attempt_id);
              retainedAttemptIds.delete(state.attempt_id);
            }
            return;
          }
          if (state.status !== 'running') {
            await quarantineState(state, new Error('attempt_state_status_invalid'));
            return;
          }
          const inspected = await docker.inspect({ containerId: state.container_id });
          if (!isTerminalContainerStatus(inspected.status)) return;
          if (state.github_mutation_policy) {
            const mutationPending = {
              ...state,
              status: 'mutation_pending',
              container_removed: inspected.status === 'missing',
              updated_at: new Date().toISOString(),
            };
            await stateStore.save(mutationPending);
            const result = await continueGithubMutation(mutationPending);
            if (result.status === 'cleaned') {
              cleanedAttempts.push(state.attempt_id);
              retainedAttemptIds.delete(state.attempt_id);
            }
            return;
          }
          const result = await beginCallbackPending(state, {
            containerMissing: inspected.status === 'missing',
          });
          if (result.status === 'cleaned') {
            cleanedAttempts.push(state.attempt_id);
            retainedAttemptIds.delete(state.attempt_id);
          }
        });
      }

      const removedOrphanContainers = [];
      const containers = await docker.listOwned({ workerId });
      for (const container of containers) {
        const labels = container?.labels ?? {};
        const attemptId = labels['cecelia.fleet.attempt_id'];
        const containerWorkerId = labels['cecelia.fleet.worker_id'];
        const runId = labels['cecelia.fleet.run_id'];
        if (
          containerWorkerId !== workerId
          || !UUID_PATTERN.test(attemptId ?? '')
          || !UUID_PATTERN.test(runId ?? '')
          || knownAttemptIds.has(attemptId)
        ) {
          continue;
        }
        await docker.remove({
          containerId: container.containerId,
          attemptId,
        });
        removedOrphanContainers.push(container.containerId);
      }
      const workspaceReconciliation = await workspaceManager.reconcile({
        retainedAttemptIds: [...retainedAttemptIds],
      });

      return Object.freeze({
        cleaned_attempts: Object.freeze(cleanedAttempts),
        cancelled_attempts: Object.freeze(cancelledAttempts),
        removed_orphan_containers: Object.freeze(removedOrphanContainers),
        cleaned_orphan_workspaces: Object.freeze(
          workspaceReconciliation.cleaned_attempts ?? [],
        ),
      });
    },
  };

  const runner = {
    launch(input) {
      const attemptId = String(input?.request?.attempt_id ?? '__invalid_attempt__');
      return withAttemptLock(attemptId, () => unlockedRunner.launch(input));
    },
    inspect(attemptId) {
      return unlockedRunner.inspect(attemptId);
    },
    terminal(attemptId, lease = null) {
      return withAttemptLock(
        String(attemptId ?? '__invalid_attempt__'),
        () => unlockedRunner.terminal(attemptId, lease),
      );
    },
    cancel(attemptId, lease) {
      return withAttemptLock(
        String(attemptId ?? '__invalid_attempt__'),
        () => unlockedRunner.cancel(attemptId, lease),
      );
    },
    reconcile() {
      return unlockedRunner.reconcile();
    },
  };

  return Object.freeze(runner);
}

module.exports = {
  __test__: Object.freeze({ defaultWriteCredential }),
  createAttemptRunner,
  createDockerAdapter,
  createFileAttemptStateStore,
};
