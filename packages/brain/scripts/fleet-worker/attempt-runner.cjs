#!/usr/bin/env node
'use strict';

const { execFile, spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const CANONICAL_MACHINE_IDS = new Set([
  'us-mac-m4',
  'xian-mac-m4',
  'xian-mac-m1',
]);
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CONTAINER_NAME_PATTERN = /^cecelia-fleet-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const IMAGE_DIGEST_PATTERN = /^(?:[a-z0-9][a-z0-9._/-]*@)?sha256:[a-f0-9]{64}$/;
const MOUNT_ACCESS_PRINCIPAL_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]{0,63}$/;
const PROVIDER_FIELDS = new Set([
  'provider',
  'command',
  'args',
  'stdin',
  'output',
]);
const PROVIDER_PATTERN = /^(codex|claude|grok)$/;
const GITHUB_CREDENTIAL_ROLES = new Set([
  'planner',
  'proposer',
  'generator',
  'evaluator',
]);
const MAX_STATE_BYTES = 1_048_576;
const MAX_GITHUB_TOKEN_BYTES = 16_384;
const RUNTIME_NETWORK_PATTERN = /^cecelia-attempt-[a-f0-9-]{36}$/;
const RUNTIME_ENVIRONMENT_FIELDS = new Set(['DB_URL', 'DATABASE_URL']);
const EMPTY_RUNTIME_RESOURCES = Object.freeze({
  runtime: Object.freeze({}),
  environment: Object.freeze({}),
  networkName: undefined,
});
const NO_RUNTIME_RESOURCE_MANAGER = Object.freeze({
  async provision({ requirements } = {}) {
    if (requirements?.postgres === true) {
      throw new Error('attempt_resource_manager_required');
    }
    return EMPTY_RUNTIME_RESOURCES;
  },
  async release() {
    return Object.freeze({ status: 'released' });
  },
  async releaseService() {
    return Object.freeze({ status: 'released' });
  },
  async reconcile() {
    return Object.freeze({ removed_attempts: Object.freeze([]) });
  },
});

async function defaultRunCommand(command, args, options) {
  const { stdout = '' } = await execFileAsync(command, args, {
    cwd: options?.cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim() };
}

async function writeContainerFifo(
  containerName,
  fifoPath,
  payload,
  {
    spawnFn,
    timeoutMs,
    writerName,
    errorCode,
  },
) {
  await new Promise((resolve, reject) => {
    let settled = false;
    let child;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new Error(errorCode));
      else resolve();
    };
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL');
      } catch {
        // The generic write failure below remains the only exposed error.
      }
      finish(new Error('timeout'));
    }, timeoutMs);

    try {
      child = spawnFn(
        'docker',
        [
          'exec',
          '-i',
          containerName,
          'sh',
          '-c',
          'cat > "$1"',
          writerName,
          fifoPath,
        ],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      );
      if (
        !child
        || typeof child.once !== 'function'
        || !child.stdin
        || typeof child.stdin.end !== 'function'
      ) {
        finish(new Error('invalid_child'));
        return;
      }
      child.once('error', () => finish(new Error('spawn')));
      child.once('close', (code) => {
        finish(code === 0 ? null : new Error('exit'));
      });
      child.stdin.once('error', () => finish(new Error('stdin')));
      child.stdin.end(payload, 'utf8');
    } catch {
      finish(new Error('spawn'));
    }
  });
}

async function defaultWriteCredential(
  containerName,
  fifoPath,
  authJson,
  {
    spawnFn = spawn,
    timeoutMs = 10_000,
  } = {},
) {
  if (
    !CONTAINER_NAME_PATTERN.test(containerName ?? '')
    || fifoPath !== '/tmp/cecelia-prompts/credential.fifo'
    || typeof authJson !== 'string'
    || authJson.length === 0
    || Buffer.byteLength(authJson, 'utf8') > 196_608
    || typeof spawnFn !== 'function'
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 60_000
  ) {
    throw new Error('attempt_credential_fifo_write_failed');
  }
  return writeContainerFifo(containerName, fifoPath, authJson, {
    spawnFn,
    timeoutMs,
    writerName: 'credential-writer',
    errorCode: 'attempt_credential_fifo_write_failed',
  });
}

async function defaultWriteGitHubCredential(
  containerName,
  fifoPath,
  token,
  {
    spawnFn = spawn,
    timeoutMs = 10_000,
  } = {},
) {
  if (
    !CONTAINER_NAME_PATTERN.test(containerName ?? '')
    || fifoPath !== '/tmp/cecelia-prompts/github-credential.fifo'
    || typeof token !== 'string'
    || token.length === 0
    || /[\r\n\0]/.test(token)
    || Buffer.byteLength(token, 'utf8') > MAX_GITHUB_TOKEN_BYTES
    || typeof spawnFn !== 'function'
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 60_000
  ) {
    throw new Error('attempt_github_credential_fifo_write_failed');
  }
  return writeContainerFifo(containerName, fifoPath, token, {
    spawnFn,
    timeoutMs,
    writerName: 'github-credential-writer',
    errorCode: 'attempt_github_credential_fifo_write_failed',
  });
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

function assertAttemptId(value) {
  if (!UUID_PATTERN.test(value ?? '')) {
    throw new Error('attempt_state_invalid_attempt_id');
  }
}

function createFileAttemptStateStore({ stateRoot } = {}) {
  const root = assertRuntimeRoot(stateRoot, 'state_root');

  function fileFor(attemptId) {
    assertAttemptId(attemptId);
    return path.join(root, `${attemptId}.json`);
  }

  function parseState(serialized, attemptId) {
    try {
      const state = JSON.parse(serialized);
      if (
        !state
        || typeof state !== 'object'
        || Array.isArray(state)
        || state.attempt_id !== attemptId
      ) {
        throw new Error('invalid shape');
      }
      return state;
    } catch {
      throw new Error(`attempt_state_corrupt:${attemptId}`);
    }
  }

  return Object.freeze({
    async save(state) {
      assertAttemptId(state?.attempt_id);
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
        fs.renameSync(temporary, target);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
      return state;
    },

    async get(attemptId) {
      const target = fileFor(attemptId);
      try {
        return parseState(fs.readFileSync(target, 'utf8'), attemptId);
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },

    async delete(attemptId) {
      fs.rmSync(fileFor(attemptId), { force: true });
      return true;
    },

    async list() {
      let entries;
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
      return entries
        .filter((entry) => entry.isFile() && UUID_PATTERN.test(entry.name.replace(/\.json$/, '')))
        .filter((entry) => entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
          const attemptId = entry.name.slice(0, -'.json'.length);
          return parseState(
            fs.readFileSync(path.join(root, entry.name), 'utf8'),
            attemptId,
          );
        });
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

function callbackBrainUrl(callbackUrl) {
  try {
    const parsed = new URL(callbackUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    throw new Error('attempt_callback_url_invalid');
  }
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

function isExplicitlyMissingDockerObject(error) {
  const detail = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join('\n');
  return /no such (?:container|object)|container.*not found/i.test(detail);
}

function createDockerAdapter({
  runCommand = defaultRunCommand,
  runtimeRoot,
  writeCredential = defaultWriteCredential,
  writeGitHubCredential = defaultWriteGitHubCredential,
  resolveMountSource = fs.realpathSync,
  mountAccessPrincipal,
  cleanupAccessPrincipal,
} = {}) {
  const root = assertRuntimeRoot(runtimeRoot, 'runtime_root');
  if (typeof runCommand !== 'function') {
    throw new Error('attempt_runner_invalid_docker_command_runner');
  }
  if (typeof writeCredential !== 'function') {
    throw new Error('attempt_runner_invalid_credential_writer');
  }
  if (typeof writeGitHubCredential !== 'function') {
    throw new Error('attempt_runner_invalid_github_credential_writer');
  }
  if (typeof resolveMountSource !== 'function') {
    throw new Error('attempt_runner_invalid_mount_source_resolver');
  }
  if (
    mountAccessPrincipal !== undefined
    && !MOUNT_ACCESS_PRINCIPAL_PATTERN.test(mountAccessPrincipal)
  ) {
    throw new Error('attempt_runner_invalid_mount_access_principal');
  }
  if (
    cleanupAccessPrincipal !== undefined
    && !MOUNT_ACCESS_PRINCIPAL_PATTERN.test(cleanupAccessPrincipal)
  ) {
    throw new Error('attempt_runner_invalid_cleanup_access_principal');
  }

  function canonicalMountSource(source) {
    let resolved;
    try {
      resolved = resolveMountSource(source);
    } catch {
      throw new Error('attempt_mount_source_unavailable');
    }
    if (
      typeof resolved !== 'string'
      || !path.isAbsolute(resolved)
      || resolved === path.parse(resolved).root
    ) {
      throw new Error('attempt_mount_source_invalid');
    }
    return path.resolve(resolved);
  }

  async function prepareContainer(input) {
      const attemptId = input?.attemptId;
      assertAttemptId(attemptId);
      if (
        !Number.isSafeInteger(input?.timeoutSeconds)
        || input.timeoutSeconds <= 0
      ) {
        throw new Error('attempt_timeout_seconds_invalid');
      }
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
      if (
        input.runtimeNetwork !== undefined
        && (
          input.runtimeNetwork !== `cecelia-attempt-${attemptId}`
          || !RUNTIME_NETWORK_PATTERN.test(input.runtimeNetwork)
        )
      ) {
        throw new Error('attempt_runtime_network_invalid');
      }
      const runtimeEnvironment = input.runtimeEnvironment ?? {};
      if (
        !runtimeEnvironment
        || typeof runtimeEnvironment !== 'object'
        || Array.isArray(runtimeEnvironment)
        || Object.keys(runtimeEnvironment).some(
          (key) => !RUNTIME_ENVIRONMENT_FIELDS.has(key),
        )
        || Object.values(runtimeEnvironment).some(
          (value) => typeof value !== 'string' || /[\r\n\0]/.test(value),
        )
      ) {
        throw new Error('attempt_runtime_environment_invalid');
      }
      const attemptRuntime = path.join(root, attemptId);
      fs.mkdirSync(attemptRuntime, { recursive: true, mode: 0o700 });
      const workspaceSource = canonicalMountSource(input.workspaceMount.source);
      const workspaceAdminSource = canonicalMountSource(
        input.workspaceAdminMount.source,
      );
      const runtimeSource = canonicalMountSource(attemptRuntime);
      const promptFile = path.join(attemptRuntime, 'task-bundle.json');
      const stdoutFile = path.join(attemptRuntime, 'stdout.jsonl');
      const isCodex = input.providerSpec?.provider === 'codex';
      const needsGitHubCredential = GITHUB_CREDENTIAL_ROLES.has(input.role);
      if (
        isCodex
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
      if (
        needsGitHubCredential
        && (
          !UUID_PATTERN.test(input.githubCredential?.credentialRef ?? '')
          || typeof input.githubCredential?.token !== 'string'
          || input.githubCredential.token.length === 0
          || /[\r\n\0]/.test(input.githubCredential.token)
          || Buffer.byteLength(input.githubCredential.token, 'utf8')
            > MAX_GITHUB_TOKEN_BYTES
        )
      ) {
        fs.rmSync(attemptRuntime, { recursive: true, force: true });
        throw new Error('attempt_github_credential_invalid');
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
      const githubCredentialFifo = path.join(
        attemptRuntime,
        'github-credential.fifo',
      );
      const containerGitHubCredentialFifo =
        '/tmp/cecelia-prompts/github-credential.fifo';
      const workspaceMount = [
        `type=bind,src=${workspaceSource},dst=/workspace`,
        input.workspaceMount.readOnly ? 'readonly' : null,
      ].filter(Boolean).join(',');
      const runtimeMount = `type=bind,src=${runtimeSource},dst=/tmp/cecelia-prompts`;
      const workspaceAdminMount = [
        `type=bind,src=${workspaceAdminSource},dst=${input.workspaceAdminMount.target}`,
        input.workspaceAdminMount.readOnly ? 'readonly' : null,
      ].filter(Boolean).join(',');
      const createArgs = [
        'create',
        '--name',
        containerName,
        ...labelArgs(input.labels),
        ...(input.role === 'evaluator' ? ['--user', 'root'] : []),
        ...(input.runtimeNetwork
          ? ['--network', input.runtimeNetwork]
          : []),
        '--mount',
        workspaceMount,
        '--mount',
        workspaceAdminMount,
        '--mount',
        runtimeMount,
        ...(isCodex
          ? [
              '--tmpfs',
              '/home/cecelia/.codex:rw,noexec,nosuid,nodev,mode=0700,uid=999,gid=999',
            ]
          : []),
        ...(needsGitHubCredential
          ? [
              '--tmpfs',
              '/home/cecelia/.config/gh:rw,noexec,nosuid,nodev,mode=0700,uid=999,gid=999',
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
          HARNESS_CALLBACK_URL: input.callback.url,
          HARNESS_CALLBACK_TOKEN: input.callback.token,
          HARNESS_LEASE_OWNER: input.lease.owner,
          HARNESS_LEASE_GENERATION: input.lease.generation,
          HARNESS_READ_ONLY: String(input.workspaceMount.readOnly),
          // Server-observed checkout SHA + the frozen invariant. The Provider
          // never reports these; the Runner reads them back to gate pushes.
          HARNESS_WORKSPACE_START_SHA: input.workspaceStartSha,
          HARNESS_FROZEN_BASELINE: String(input.frozenBaseline === true),
          HARNESS_NODE: input.role,
          HARNESS_MODEL: input.model,
          HARNESS_TIMEOUT_SECONDS: String(input.timeoutSeconds),
          HARNESS_TASK_BUNDLE_FILE: containerPrompt,
          CECELIA_PROMPT_FILE: containerPrompt,
          CECELIA_STDOUT_FILE: containerStdout,
          CECELIA_CREDENTIAL_FIFO: isCodex
            ? containerCredentialFifo
            : undefined,
          CECELIA_CREDENTIAL_REF: isCodex
            ? input.credential.credentialRef
            : undefined,
          CECELIA_GITHUB_CREDENTIAL_FIFO: needsGitHubCredential
            ? containerGitHubCredentialFifo
            : undefined,
          CECELIA_GITHUB_CREDENTIAL_REF: needsGitHubCredential
            ? input.githubCredential.credentialRef
            : undefined,
          WORKTREE_PATH: '/workspace',
          BRAIN_URL: callbackBrainUrl(input.callback.url),
          ...input.roleEnv,
          ...runtimeEnvironment,
        }),
        input.image,
      ];
      let created;
      try {
        if (needsGitHubCredential) {
          await runCommand(
            'mkfifo',
            ['-m', '600', githubCredentialFifo],
            undefined,
          );
        }
        if (isCodex) {
          await runCommand('mkfifo', ['-m', '600', credentialFifo], undefined);
        }
        if (cleanupAccessPrincipal !== undefined) {
          await runCommand('chmod', [
            '+a',
            `${cleanupAccessPrincipal} allow list,add_file,search,add_subdirectory,delete,delete_child,file_inherit,directory_inherit`,
            workspaceSource,
            workspaceAdminSource,
            runtimeSource,
          ], undefined);
        }
        if (mountAccessPrincipal !== undefined) {
          await runCommand('/usr/bin/find', [
            '-x',
            workspaceSource,
            workspaceAdminSource,
            runtimeSource,
            '(',
            '-type',
            'd',
            '-o',
            '-type',
            'f',
            '-o',
            '-type',
            'p',
            ')',
            '-exec',
            'chmod',
            '+a',
            `${mountAccessPrincipal} allow read,write,execute,delete`,
            '{}',
            '+',
          ], undefined);
        }
        created = await runCommand('docker', createArgs);
        if (!String(created?.stdout ?? '').trim()) {
          throw new Error('attempt_container_id_missing');
        }
      } catch (error) {
        let removalError = null;
        try {
          await runCommand(
            'docker',
            ['rm', '-f', '--', containerName],
            undefined,
          );
        } catch (cleanupError) {
          if (!isExplicitlyMissingDockerObject(cleanupError)) {
            removalError = cleanupError;
          }
        }
        if (removalError) {
          const rollbackError = new Error(
            `attempt_container_rollback_failed:${error.message}`,
            { cause: new AggregateError([error, removalError]) },
          );
          rollbackError.rollbackContainerId = containerName;
          throw rollbackError;
        }
        fs.rmSync(attemptRuntime, { recursive: true, force: true });
        throw error;
      }
      const containerId = String(created?.stdout ?? '').trim();
      return Object.freeze({
        containerId,
        ...(isCodex ? { credentialFifo } : {}),
        ...(needsGitHubCredential ? { githubCredentialFifo } : {}),
      });
  }

  async function startContainer({
    attemptId,
    containerId,
    credentialFifo,
    githubCredentialFifo,
    credential,
    githubCredential,
  } = {}) {
    assertAttemptId(attemptId);
    if (typeof containerId !== 'string' || containerId.length === 0) {
      throw new Error('attempt_container_id_missing');
    }
    const attemptRuntime = path.join(root, attemptId);
    const expectedCredentialFifo = path.join(
      attemptRuntime,
      'credential.fifo',
    );
    const expectedGitHubCredentialFifo = path.join(
      attemptRuntime,
      'github-credential.fifo',
    );
    if (credential && credentialFifo !== expectedCredentialFifo) {
      throw new Error('attempt_credential_fifo_invalid');
    }
    if (
      githubCredential
      && githubCredentialFifo !== expectedGitHubCredentialFifo
    ) {
      throw new Error('attempt_github_credential_fifo_invalid');
    }
    const containerName = `cecelia-fleet-${attemptId}`;
    try {
      await runCommand('docker', ['start', containerName], undefined);
      if (githubCredential) {
        await writeGitHubCredential(
          containerName,
          '/tmp/cecelia-prompts/github-credential.fifo',
          githubCredential.token,
        );
      }
      if (credential) {
        await writeCredential(
          containerName,
          '/tmp/cecelia-prompts/credential.fifo',
          credential.authJson,
        );
      }
    } finally {
      if (githubCredentialFifo) {
        fs.rmSync(githubCredentialFifo, { force: true });
      }
      if (credentialFifo) {
        fs.rmSync(credentialFifo, { force: true });
      }
    }
    return Object.freeze({ containerId });
  }

  async function launchContainer(input) {
    const prepared = await prepareContainer(input);
    try {
      await startContainer({
        attemptId: input.attemptId,
        ...prepared,
        credential: input.credential,
        githubCredential: input.githubCredential,
      });
    } catch (error) {
      const containerName = `cecelia-fleet-${input.attemptId}`;
      let removalError = null;
      try {
        await runCommand(
          'docker',
          ['rm', '-f', '--', containerName],
          undefined,
        );
      } catch (cleanupError) {
        if (!isExplicitlyMissingDockerObject(cleanupError)) {
          removalError = cleanupError;
        }
      }
      if (removalError) {
        const rollbackError = new Error(
          `attempt_container_rollback_failed:${error.message}`,
          { cause: new AggregateError([error, removalError]) },
        );
        rollbackError.rollbackContainerId = containerName;
        throw rollbackError;
      }
      fs.rmSync(path.join(root, input.attemptId), {
        recursive: true,
        force: true,
      });
      throw error;
    }
    return Object.freeze({ containerId: prepared.containerId });
  }

  return Object.freeze({
    prepare: prepareContainer,
    start: startContainer,
    launch: launchContainer,

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

    async remove({ containerId, attemptId, containerMissing = false } = {}) {
      assertAttemptId(attemptId);
      if (!containerMissing) {
        try {
          await runCommand('docker', ['rm', '-f', '--', containerId], undefined);
        } catch (error) {
          if (!isExplicitlyMissingDockerObject(error)) throw error;
        }
      }
      fs.rmSync(path.join(root, attemptId), { recursive: true, force: true });
      return Object.freeze({ removed: true });
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
  githubCredentialConsumer,
  resourceManager,
}) {
  for (const method of ['prepare', 'verify', 'cleanup', 'quarantine', 'reconcile']) {
    requireMethod(workspaceManager, method, 'workspace_manager');
  }
  for (const method of [
    'prepare',
    'start',
    'launch',
    'inspect',
    'wait',
    'remove',
    'listOwned',
  ]) {
    requireMethod(docker, method, 'docker');
  }
  for (const method of ['save', 'get', 'delete', 'list']) {
    requireMethod(stateStore, method, 'state_store');
  }
  requireMethod(credentialConsumer, 'consume', 'credential_consumer');
  requireMethod(
    githubCredentialConsumer,
    'consume',
    'github_credential_consumer',
  );
  for (const method of ['provision', 'release', 'releaseService', 'reconcile']) {
    requireMethod(resourceManager, method, 'resource_manager');
  }
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
  if (!CANONICAL_MACHINE_IDS.has(value.machine)) {
    throw new Error('attempt_target_machine_invalid');
  }
  if (!PROVIDER_PATTERN.test(value.provider ?? '')) {
    throw new Error('attempt_target_provider_invalid');
  }
  if (
    typeof value.role !== 'string'
    || !/^(commander|planner|proposer|reviewer|generator|evaluator|judge|reporter)$/
      .test(value.role)
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

function taskExecutionContract(providerSpec, request, target) {
  let bundle;
  try {
    bundle = JSON.parse(providerSpec.stdin)?.task_bundle;
  } catch {
    throw new Error('attempt_task_bundle_invalid');
  }
  const inputs = bundle?.inputs;
  if (
    !bundle
    || typeof bundle !== 'object'
    || Array.isArray(bundle)
    || bundle.run_id !== request.run_id
    || bundle.attempt_id !== request.attempt_id
    || bundle.role !== target.role
    || !inputs
    || typeof inputs !== 'object'
    || Array.isArray(inputs)
    || typeof inputs.task_id !== 'string'
    || inputs.task_id.length === 0
  ) {
    throw new Error('attempt_task_bundle_invalid');
  }

  const roleEnv = {
    ...(inputs.sprint_dir
      ? { SPRINT_DIR: String(inputs.sprint_dir) }
      : {}),
    WORKSPACE_PATH: '/workspace',
    ...(target.role === 'planner' && inputs.planner_branch
      ? { PLANNER_BRANCH: String(inputs.planner_branch) }
      : {}),
    ...(inputs.contract_round != null
      ? { PROPOSE_ROUND: String(inputs.contract_round) }
      : {}),
    ...(inputs.propose_branch
      ? { PROPOSE_BRANCH: String(inputs.propose_branch) }
      : {}),
    ...(inputs.contract_branch
      ? { CONTRACT_BRANCH: String(inputs.contract_branch) }
      : {}),
    ...(target.role === 'evaluator' && inputs.pr_branch
      ? { PR_BRANCH: String(inputs.pr_branch) }
      : {}),
    ...(target.role === 'evaluator' && inputs.pr_head_sha
      ? { PR_HEAD_SHA: String(inputs.pr_head_sha) }
      : {}),
    ...(target.role === 'evaluator'
      ? {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'remote.origin.pushurl',
        GIT_CONFIG_VALUE_0: 'blocked-by-harness://evaluator',
      }
      : {}),
  };
  const inputRequirements = inputs.runtime_resources;
  const requestRequirements = request.runtime_resources;
  if (
    (inputRequirements === undefined) !== (requestRequirements === undefined)
    || (
      inputRequirements !== undefined
      && JSON.stringify(inputRequirements) !== JSON.stringify(requestRequirements)
    )
  ) {
    throw new Error('attempt_runtime_requirements_mismatch');
  }
  const runtimeRequirements = inputRequirements ?? requestRequirements ?? {};
  if (
    !runtimeRequirements
    || typeof runtimeRequirements !== 'object'
    || Array.isArray(runtimeRequirements)
    || Object.keys(runtimeRequirements).some((key) => key !== 'postgres')
    || (
      runtimeRequirements.postgres !== undefined
      && typeof runtimeRequirements.postgres !== 'boolean'
    )
  ) {
    throw new Error('attempt_runtime_requirements_invalid');
  }
  return Object.freeze({
    taskId: inputs.task_id,
    roleEnv: Object.freeze(roleEnv),
    runtimeRequirements: Object.freeze({
      postgres: runtimeRequirements.postgres === true,
    }),
  });
}

function validateLaunchRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('attempt_launch_request_invalid');
  }
  if (!UUID_PATTERN.test(value.attempt_id ?? '')) {
    throw new Error('attempt_id_invalid');
  }
  if (!UUID_PATTERN.test(value.run_id ?? '')) {
    throw new Error('attempt_run_id_invalid');
  }
  if (
    value.workspace_spec?.attempt_id !== value.attempt_id
    || value.workspace_spec?.run_id !== value.run_id
  ) {
    throw new Error('attempt_workspace_owner_mismatch');
  }
  if (typeof value.lease_owner !== 'string' || value.lease_owner.length === 0) {
    throw new Error('attempt_lease_owner_invalid');
  }
  if (!Number.isInteger(value.lease_generation) || value.lease_generation < 0) {
    throw new Error('attempt_lease_generation_invalid');
  }
  if (
    !Number.isSafeInteger(value.timeout_seconds)
    || value.timeout_seconds <= 0
  ) {
    throw new Error('attempt_timeout_seconds_invalid');
  }
  const providerSpec = validateProviderSpec(value.provider_spec);
  const target = validateTarget(value.target);
  return {
    request: value,
    providerSpec,
    target,
    executionContract: taskExecutionContract(providerSpec, value, target),
  };
}

function labelsFor(request, workerId) {
  return Object.freeze({
    'cecelia.fleet.attempt_id': request.attempt_id,
    'cecelia.fleet.run_id': request.run_id,
    'cecelia.fleet.worker_id': workerId,
  });
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function credentialEnvelopeIdentity(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return envelope;
  }
  const metadata = { ...envelope };
  delete metadata.payload;
  return metadata;
}

function prepareRequestFingerprint(request) {
  const boundedIdentity = {
    ...request,
    callback_token: undefined,
    callback_token_hash: `sha256:${createHash('sha256')
      .update(String(request.callback_token ?? ''), 'utf8')
      .digest('hex')}`,
    credential_envelope: credentialEnvelopeIdentity(
      request.credential_envelope,
    ),
    github_credential_envelope: credentialEnvelopeIdentity(
      request.github_credential_envelope,
    ),
  };
  return `sha256:${createHash('sha256')
    .update(stableJson(boundedIdentity), 'utf8')
    .digest('hex')}`;
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

function createAttemptRunner({
  workspaceManager,
  docker,
  stateStore,
  workerId,
  runnerImageDigest,
  credentialConsumer,
  githubCredentialConsumer,
  resourceManager = NO_RUNTIME_RESOURCE_MANAGER,
} = {}) {
  validateDependencies({
    workspaceManager,
    docker,
    stateStore,
    workerId,
    runnerImageDigest,
    credentialConsumer,
    githubCredentialConsumer,
    resourceManager,
  });

  async function quarantineState(state, error) {
    const quarantined = await workspaceManager.quarantine(state.workspace, error);
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

  async function cleanupWorkspaceState(state, { deleteState = true } = {}) {
    const cleaned = await workspaceManager.cleanup(state.workspace);
    if (cleaned.status === 'quarantined') {
      await stateStore.save({
        ...state,
        status: 'quarantined',
        quarantine: cleaned,
        updated_at: new Date().toISOString(),
      });
      return Object.freeze({
        status: 'quarantined',
        attempt_id: state.attempt_id,
        reason: cleaned.reason,
      });
    }
    if (deleteState) {
      await stateStore.delete(state.attempt_id);
    }
    return Object.freeze({
      status: 'cleaned',
      attempt_id: state.attempt_id,
    });
  }

  async function releaseResources(state) {
    if (!state.runtime_resources || Object.keys(state.runtime_resources).length === 0) {
      return;
    }
    await resourceManager.release({
      attemptId: state.attempt_id,
      runtime: state.runtime_resources,
    });
  }

  async function releaseRuntimeService(state) {
    if (!state.runtime_resources || Object.keys(state.runtime_resources).length === 0) {
      return;
    }
    await resourceManager.releaseService({
      attemptId: state.attempt_id,
      runtime: state.runtime_resources,
    });
  }

  const pendingCredentials = new Map();
  const prepareOperations = new Map();
  const startOperations = new Map();
  const terminalWaiters = new Set();
  const finalizationPromises = new Map();

  function terminalStartResult(attemptId, terminalStatus) {
    return Object.freeze({
      status: 'terminal',
      attempt_id: attemptId,
      terminal_status: terminalStatus,
      deduped: true,
    });
  }

  async function persistTerminalTombstone(state, terminalStatus) {
    const tombstone = Object.freeze({
      attempt_id: state.attempt_id,
      worker_id: state.worker_id,
      lease_owner: state.lease_owner,
      lease_generation: state.lease_generation,
      status: 'terminal',
      terminal_status: terminalStatus,
      terminal_at: new Date().toISOString(),
    });
    await stateStore.save(tombstone);
    return tombstone;
  }

  function hasRequiredPendingCredentials(state) {
    const pending = pendingCredentials.get(state.attempt_id);
    return (!state.credential || Boolean(pending?.credential))
      && (!state.github_credential || Boolean(pending?.githubCredential));
  }

  function installTerminalWaiter(state) {
    if (terminalWaiters.has(state.attempt_id)) return;
    terminalWaiters.add(state.attempt_id);
    void Promise.resolve()
      .then(() => docker.wait({ containerId: state.container_id }))
      .then(() => finalizeAttempt(state.attempt_id, null, {
        containerId: state.container_id,
        leaseGeneration: state.lease_generation,
      }))
      .catch(() => {})
      .finally(() => terminalWaiters.delete(state.attempt_id));
  }

  function finalizeAttempt(attemptId, lease = null, expected = null) {
    const existing = finalizationPromises.get(attemptId);
    if (existing) return existing;
    const operation = (async () => {
      const state = await stateStore.get(attemptId);
      if (!state) {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      if (state.worker_id !== workerId) {
        throw new Error('attempt_worker_owner_mismatch');
      }
      if (
        expected
        && (
          state.container_id !== expected.containerId
          || state.lease_generation !== expected.leaseGeneration
        )
      ) {
        return Object.freeze({ status: 'stale_waiter', attempt_id: attemptId });
      }
      if (lease !== null) {
        assertLeaseFence(state, lease);
      }
      pendingCredentials.delete(attemptId);
      try {
        await docker.remove({
          containerId: state.container_id,
          attemptId: state.attempt_id,
          ...(expected?.containerMissing === true
            ? { containerMissing: true }
            : {}),
        });
      } catch (error) {
        return quarantineState(state, error);
      }
      try {
        await releaseResources(state);
      } catch (error) {
        return quarantineState(state, error);
      }
      const result = await cleanupWorkspaceState(state, { deleteState: false });
      if (result.status === 'cleaned') {
        await persistTerminalTombstone(
          state,
          expected?.terminalStatus ?? 'cleaned',
        );
      }
      return result;
    })();
    finalizationPromises.set(attemptId, operation);
    void operation.finally(() => {
      if (finalizationPromises.get(attemptId) === operation) {
        finalizationPromises.delete(attemptId);
      }
    }).catch(() => {});
    return operation;
  }

  async function rollbackLaunch({
    error,
    workspace,
    attemptId,
    containerId,
    resources,
  }) {
    const cleanupFailures = [];
    let containerCleanupFailed = false;
    const rollbackContainerId = containerId ?? error?.rollbackContainerId;
    if (rollbackContainerId) {
      try {
        await docker.remove({ containerId: rollbackContainerId, attemptId });
      } catch (cleanupError) {
        containerCleanupFailed = true;
        cleanupFailures.push(cleanupError);
      }
    }
    if (resources && Object.keys(resources.runtime).length > 0) {
      try {
        await resourceManager.release({
          attemptId,
          runtime: resources.runtime,
        });
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    try {
      if (containerCleanupFailed) {
        await workspaceManager.quarantine(workspace, cleanupFailures[0]);
      } else {
        await workspaceManager.cleanup(workspace);
      }
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    if (cleanupFailures.length > 0) {
      throw new Error(`attempt_launch_rollback_failed:${error.message}`, {
        cause: new AggregateError([error, ...cleanupFailures]),
      });
    }
    throw error;
  }

  function receiptForState(state) {
    return Object.freeze({
      attempt_id: state.attempt_id,
      run_id: state.run_id,
      actual_machine_id: workerId,
      execution_transport: 'fleet-worker',
      remote_job_id: state.container_id,
      container_id: state.container_id,
      workspace_head_sha: state.workspace?.head_sha,
    });
  }

  function isExactPrepareDuplicate(state, request, requestFingerprint) {
    return state.worker_id === workerId
      && state.run_id === request.run_id
      && state.lease_owner === request.lease_owner
      && state.lease_generation === request.lease_generation
      && state.prepare_request_fingerprint === requestFingerprint
      && typeof state.container_id === 'string'
      && state.container_id.length > 0
      && ['prepared', 'starting', 'running'].includes(state.status);
  }

  function consumeAttemptCredentials(request, target) {
    let credential = null;
    if (target.provider === 'codex') {
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
    let githubCredential = null;
    if (GITHUB_CREDENTIAL_ROLES.has(target.role)) {
      if (
        !request.github_credential_envelope
        || typeof request.github_credential_envelope !== 'object'
        || Array.isArray(request.github_credential_envelope)
      ) {
        throw new Error('github_credential_envelope_required');
      }
      githubCredential = githubCredentialConsumer.consume(
        request.github_credential_envelope,
        {
          attemptId: request.attempt_id,
          machineId: workerId,
        },
      );
    }
    return { credential, githubCredential };
  }

  function dockerRequestFor({
    request,
    providerSpec,
    target,
    executionContract,
    workspace,
    labels,
    resources,
    credential,
    githubCredential,
  }) {
    return {
      attemptId: request.attempt_id,
      runId: request.run_id,
      workerId,
      image: runnerImageDigest,
      providerSpec,
      taskId: executionContract.taskId,
      roleEnv: executionContract.roleEnv,
      timeoutSeconds: request.timeout_seconds,
      role: target.role,
      model: target.model,
      workspaceStartSha: workspace.head_sha,
      frozenBaseline: workspace.frozen_baseline === true,
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
      callback: {
        url: request.callback_url,
        token: request.callback_token,
      },
      lease: {
        owner: request.lease_owner,
        generation: request.lease_generation,
      },
      credential,
      githubCredential,
      runtimeNetwork: resources.networkName,
      runtimeEnvironment: resources.environment,
    };
  }

  const runner = {
    async prepare(input) {
      const {
        request,
        providerSpec,
        target,
        executionContract,
      } = validateLaunchRequest(input);
      if (target.machine !== workerId) {
        throw new Error('attempt_target_worker_mismatch');
      }
      const requestFingerprint = prepareRequestFingerprint(request);
      const inFlight = prepareOperations.get(request.attempt_id);
      if (inFlight) {
        if (inFlight.requestFingerprint !== requestFingerprint) {
          throw new Error('attempt_already_exists');
        }
        return inFlight.promise;
      }

      const operation = (async () => {
      const existing = await stateStore.get(request.attempt_id);
      if (existing) {
        if (isExactPrepareDuplicate(existing, request, requestFingerprint)) {
          if (
            ['prepared', 'starting'].includes(existing.status)
            && !hasRequiredPendingCredentials(existing)
          ) {
            throw new Error('attempt_credentials_unavailable');
          }
          return receiptForState(existing);
        }
        throw new Error('attempt_already_exists');
      }

      const { credential, githubCredential } = consumeAttemptCredentials(
        request,
        target,
      );
      const workspace = await workspaceManager.prepare(request.workspace_spec);
      await workspaceManager.verify(workspace);
      const labels = labelsFor(request, workerId);
      let resources = EMPTY_RUNTIME_RESOURCES;
      if (executionContract.runtimeRequirements.postgres) {
        try {
          resources = await resourceManager.provision({
            attemptId: request.attempt_id,
            requirements: executionContract.runtimeRequirements,
          });
        } catch (error) {
          await workspaceManager.cleanup(workspace);
          throw error;
        }
      }

      let prepared;
      try {
        prepared = await docker.prepare(dockerRequestFor({
          request,
          providerSpec,
          target,
          executionContract,
          workspace,
          labels,
          resources,
          credential,
          githubCredential,
        }));
      } catch (error) {
        return rollbackLaunch({
          error,
          workspace,
          attemptId: request.attempt_id,
          resources,
        });
      }
      if (
        typeof prepared?.containerId !== 'string'
        || prepared.containerId.length === 0
      ) {
        return rollbackLaunch({
          error: new Error('attempt_container_id_missing'),
          workspace,
          attemptId: request.attempt_id,
          resources,
        });
      }

      const now = new Date().toISOString();
      const state = {
        attempt_id: request.attempt_id,
        run_id: request.run_id,
        worker_id: workerId,
        lease_owner: request.lease_owner,
        lease_generation: request.lease_generation,
        provider: providerSpec.provider,
        prepare_request_fingerprint: requestFingerprint,
        credential_delivery_status: 'pending',
        ...(credential ? { credential: credential.metadata } : {}),
        ...(githubCredential
          ? { github_credential: githubCredential.metadata }
          : {}),
        container_id: prepared.containerId,
        ...(prepared.credentialFifo
          ? { credential_fifo: prepared.credentialFifo }
          : {}),
        ...(prepared.githubCredentialFifo
          ? { github_credential_fifo: prepared.githubCredentialFifo }
          : {}),
        ...(Object.keys(resources.runtime).length > 0
          ? { runtime_resources: resources.runtime }
          : {}),
        workspace,
        labels,
        status: 'prepared',
        created_at: now,
        updated_at: now,
      };
      try {
        await stateStore.save(state);
      } catch (error) {
        return rollbackLaunch({
          error,
          workspace,
          attemptId: request.attempt_id,
          containerId: prepared.containerId,
          resources,
        });
      }
      pendingCredentials.set(request.attempt_id, Object.freeze({
        credential,
        githubCredential,
      }));
      return receiptForState(state);
      })();
      prepareOperations.set(request.attempt_id, {
        requestFingerprint,
        promise: operation,
      });
      try {
        return await operation;
      } finally {
        if (prepareOperations.get(request.attempt_id)?.promise === operation) {
          prepareOperations.delete(request.attempt_id);
        }
      }
    },

    start(attemptId, lease) {
      const inFlight = startOperations.get(attemptId);
      if (inFlight) {
        if (
          lease?.owner !== inFlight.lease.owner
          || lease?.generation !== inFlight.lease.generation
        ) {
          return Promise.reject(new Error('attempt_lease_conflict'));
        }
        return inFlight.promise.then((result) => Object.freeze({
          ...result,
          deduped: true,
        }));
      }

      const operation = (async () => {
        const state = await stateStore.get(attemptId);
        if (!state) throw new Error('attempt_not_found');
        if (state.worker_id !== workerId) {
          throw new Error('attempt_worker_owner_mismatch');
        }
        assertLeaseFence(state, lease);
        if (state.status === 'terminal') {
          return terminalStartResult(attemptId, state.terminal_status);
        }
        if (state.status === 'running') {
          if (terminalWaiters.has(attemptId)) {
            return Object.freeze({
              status: 'running',
              attempt_id: attemptId,
              deduped: true,
            });
          }
          const inspected = await docker.inspect({
            containerId: state.container_id,
          });
          if (isTerminalContainerStatus(inspected.status)) {
            const cleanup = await finalizeAttempt(attemptId, lease, {
              containerId: state.container_id,
              leaseGeneration: state.lease_generation,
              terminalStatus: inspected.status,
              ...(inspected.status === 'missing'
                ? { containerMissing: true }
                : {}),
            });
            return terminalStartResult(
              attemptId,
              cleanup.status === 'cleaned'
                ? inspected.status
                : cleanup.status,
            );
          }
          if (state.credential_delivery_status !== 'delivered') {
            const cleanup = await finalizeAttempt(attemptId, lease, {
              containerId: state.container_id,
              leaseGeneration: state.lease_generation,
              terminalStatus: 'credential_delivery_unconfirmed',
            });
            return terminalStartResult(
              attemptId,
              cleanup.status === 'cleaned'
                ? 'credential_delivery_unconfirmed'
                : cleanup.status,
            );
          }
          if (inspected.status !== 'running') {
            throw new Error('attempt_start_state_conflict');
          }
          installTerminalWaiter(state);
          return Object.freeze({
            status: 'running',
            attempt_id: attemptId,
            deduped: true,
          });
        }
        if (state.status === 'starting') {
          const inspected = await docker.inspect({
            containerId: state.container_id,
          });
          if (
            inspected.status === 'running'
            && state.credential_delivery_status === 'delivered'
          ) {
            const runningState = {
              ...state,
              status: 'running',
              updated_at: new Date().toISOString(),
            };
            await stateStore.save(runningState);
            installTerminalWaiter(runningState);
            return Object.freeze({
              status: 'running',
              attempt_id: attemptId,
              deduped: true,
            });
          }
          if (inspected.status === 'running') {
            const cleanup = await finalizeAttempt(attemptId, lease, {
              containerId: state.container_id,
              leaseGeneration: state.lease_generation,
              terminalStatus: 'credential_delivery_unconfirmed',
            });
            return terminalStartResult(
              attemptId,
              cleanup.status === 'cleaned'
                ? 'credential_delivery_unconfirmed'
                : cleanup.status,
            );
          }
          if (isTerminalContainerStatus(inspected.status)) {
            const cleanup = await finalizeAttempt(attemptId, lease, {
              containerId: state.container_id,
              leaseGeneration: state.lease_generation,
              terminalStatus: inspected.status,
              ...(inspected.status === 'missing'
                ? { containerMissing: true }
                : {}),
            });
            return terminalStartResult(
              attemptId,
              cleanup.status === 'cleaned'
                ? inspected.status
                : cleanup.status,
            );
          }
          if (!['created', 'prepared'].includes(inspected.status)) {
            throw new Error('attempt_start_state_conflict');
          }
        }
        if (!['prepared', 'starting'].includes(state.status)) {
          throw new Error('attempt_start_state_conflict');
        }
        const credentials = pendingCredentials.get(attemptId);
        if (
          (state.credential && !credentials?.credential)
          || (state.github_credential && !credentials?.githubCredential)
        ) {
          throw new Error('attempt_credentials_unavailable');
        }

        if (state.status === 'prepared') {
          await stateStore.save({
            ...state,
            status: 'starting',
            updated_at: new Date().toISOString(),
          });
        }
        try {
          await docker.start({
            attemptId,
            containerId: state.container_id,
            credentialFifo: state.credential_fifo,
            githubCredentialFifo: state.github_credential_fifo,
            credential: credentials?.credential ?? null,
            githubCredential: credentials?.githubCredential ?? null,
          });
          pendingCredentials.delete(attemptId);
          await stateStore.save({
            ...state,
            status: 'running',
            credential_delivery_status: 'delivered',
            updated_at: new Date().toISOString(),
          });
        } catch (error) {
          pendingCredentials.delete(attemptId);
          const cleanup = await finalizeAttempt(attemptId, lease);
          if (cleanup.status !== 'cleaned') {
            throw new Error(`attempt_start_rollback_failed:${error.message}`, {
              cause: error,
            });
          }
          throw error;
        }
        installTerminalWaiter(state);
        return Object.freeze({
          status: 'running',
          attempt_id: attemptId,
        });
      })();
      startOperations.set(attemptId, { lease, promise: operation });
      void operation.finally(() => {
        if (startOperations.get(attemptId)?.promise === operation) {
          startOperations.delete(attemptId);
        }
      }).catch(() => {});
      return operation;
    },

    async launch(input) {
      const {
        request,
        providerSpec,
        target,
        executionContract,
      } = validateLaunchRequest(input);
      if (target.machine !== workerId) {
        throw new Error('attempt_target_worker_mismatch');
      }
      const existing = await stateStore.get(request.attempt_id);
      if (existing) {
        throw new Error('attempt_already_exists');
      }

      const { credential, githubCredential } = consumeAttemptCredentials(
        request,
        target,
      );
      const workspace = await workspaceManager.prepare(request.workspace_spec);
      await workspaceManager.verify(workspace);
      const labels = labelsFor(request, workerId);
      let resources = EMPTY_RUNTIME_RESOURCES;
      if (executionContract.runtimeRequirements.postgres) {
        try {
          resources = await resourceManager.provision({
            attemptId: request.attempt_id,
            requirements: executionContract.runtimeRequirements,
          });
        } catch (error) {
          await workspaceManager.cleanup(workspace);
          throw error;
        }
      }
      let launched;
      try {
        launched = await docker.launch(dockerRequestFor({
          request,
          providerSpec,
          target,
          executionContract,
          workspace,
          labels,
          resources,
          credential,
          githubCredential,
        }));
      } catch (error) {
        return rollbackLaunch({
          error,
          workspace,
          attemptId: request.attempt_id,
          resources,
        });
      }
      if (typeof launched?.containerId !== 'string' || launched.containerId.length === 0) {
        return rollbackLaunch({
          error: new Error('attempt_container_id_missing'),
          workspace,
          attemptId: request.attempt_id,
          resources,
        });
      }

      const state = {
        attempt_id: request.attempt_id,
        run_id: request.run_id,
        worker_id: workerId,
        lease_owner: request.lease_owner,
        lease_generation: request.lease_generation,
        provider: providerSpec.provider,
        credential_delivery_status: 'delivered',
        ...(credential ? { credential: credential.metadata } : {}),
        ...(githubCredential
          ? { github_credential: githubCredential.metadata }
          : {}),
        container_id: launched.containerId,
        ...(Object.keys(resources.runtime).length > 0
          ? { runtime_resources: resources.runtime }
          : {}),
        workspace,
        labels,
        status: 'running',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      try {
        await stateStore.save(state);
      } catch (error) {
        return rollbackLaunch({
          error,
          workspace,
          attemptId: request.attempt_id,
          containerId: launched.containerId,
          resources,
        });
      }
      void docker.wait({ containerId: launched.containerId })
        .then(() => finalizeAttempt(request.attempt_id, null, {
          containerId: launched.containerId,
          leaseGeneration: request.lease_generation,
        }))
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
      if (['prepared', 'starting', 'terminal', 'quarantined'].includes(state.status)) {
        return Object.freeze({
          attempt_id: attemptId,
          status: state.status,
          ...(state.container_id ? { container_id: state.container_id } : {}),
          ...(state.status === 'terminal'
            ? { terminal_status: state.terminal_status }
            : {}),
        });
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
      if (state.status === 'terminal') {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      try {
        await releaseRuntimeService(state);
      } catch (error) {
        return Object.freeze({
          status: 'quarantined',
          attempt_id: state.attempt_id,
          reason: 'attempt_runtime_resource_cleanup_failed',
        });
      }
      // Do not remove the Runner here. It is the callback retry executor and
      // must remain alive until Brain has durably committed the terminal claim
      // and returned 2xx. docker.wait() performs the full exact-attempt cleanup
      // after the Runner exits naturally.
      return Object.freeze({
        status: 'cleaned',
        attempt_id: state.attempt_id,
      });
    },

    async cancel(attemptId, lease) {
      const state = await stateStore.get(attemptId);
      if (!state) {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      assertLeaseFence(state, lease);
      if (state.status === 'terminal') {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      return finalizeAttempt(attemptId, lease);
    },

    async reconcile() {
      const states = await stateStore.list();
      const ownedTombstones = states
        .filter((state) => (
          state.worker_id === workerId && state.status === 'terminal'
        ))
        .sort((left, right) => (
          String(left.terminal_at).localeCompare(String(right.terminal_at))
          || left.attempt_id.localeCompare(right.attempt_id)
        ));
      for (const tombstone of ownedTombstones.slice(0, -1_024)) {
        await stateStore.delete(tombstone.attempt_id);
      }

      const activeStates = states.filter((state) => state.status !== 'terminal');
      const ownedStates = activeStates.filter(
        (state) => state.worker_id === workerId,
      );
      const knownAttemptIds = new Set(ownedStates.map((state) => state.attempt_id));
      const retainedAttemptIds = new Set(
        activeStates.map((state) => state.attempt_id),
      );
      const cleanedAttempts = [];

      for (const state of ownedStates) {
        const inspected = await docker.inspect({ containerId: state.container_id });
        const deliveryConfirmed =
          state.credential_delivery_status === 'delivered';
        if (
          inspected.status === 'running'
          && deliveryConfirmed
          && ['starting', 'running'].includes(state.status)
        ) {
          const runningState = state.status === 'running'
            ? state
            : {
              ...state,
              status: 'running',
              updated_at: new Date().toISOString(),
            };
          if (state.status !== 'running') {
            await stateStore.save(runningState);
          }
          installTerminalWaiter(runningState);
          continue;
        }

        const containerTerminal = isTerminalContainerStatus(inspected.status);
        const deliveryUnconfirmed = (
          ['prepared', 'starting', 'running'].includes(state.status)
          && !deliveryConfirmed
        );
        if (!containerTerminal && !deliveryUnconfirmed) continue;

        const terminalStatus = containerTerminal
          ? inspected.status
          : 'credential_delivery_unconfirmed';
        const result = await finalizeAttempt(state.attempt_id, null, {
          containerId: state.container_id,
          leaseGeneration: state.lease_generation,
          terminalStatus,
          ...(inspected.status === 'missing'
            ? { containerMissing: true }
            : {}),
        });
        if (result.status === 'cleaned') {
          cleanedAttempts.push(state.attempt_id);
          retainedAttemptIds.delete(state.attempt_id);
        }
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
      const resourceReconciliation = await resourceManager.reconcile({
        retainedAttemptIds: [...retainedAttemptIds],
      });

      return Object.freeze({
        cleaned_attempts: Object.freeze(cleanedAttempts),
        removed_orphan_containers: Object.freeze(removedOrphanContainers),
        cleaned_orphan_workspaces: Object.freeze(
          workspaceReconciliation.cleaned_attempts ?? [],
        ),
        removed_orphan_resources: Object.freeze(
          resourceReconciliation.removed_attempts ?? [],
        ),
      });
    },
  };

  return Object.freeze(runner);
}

module.exports = {
  __test__: Object.freeze({
    defaultWriteCredential,
    defaultWriteGitHubCredential,
  }),
  createAttemptRunner,
  createDockerAdapter,
  createFileAttemptStateStore,
};
