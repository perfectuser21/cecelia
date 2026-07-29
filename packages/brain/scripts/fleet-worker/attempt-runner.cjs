#!/usr/bin/env node
'use strict';

const { execFile, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
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
const MAX_STATE_BYTES = 1_048_576;

async function defaultRunCommand(command, args, options) {
  const { stdout = '' } = await execFileAsync(command, args, {
    cwd: options?.cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim() };
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

  await new Promise((resolve, reject) => {
    let settled = false;
    let child;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new Error('attempt_credential_fifo_write_failed'));
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
          'credential-writer',
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
      child.stdin.end(authJson, 'utf8');
    } catch {
      finish(new Error('spawn'));
    }
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

function createDockerAdapter({
  runCommand = defaultRunCommand,
  runtimeRoot,
  writeCredential = defaultWriteCredential,
  resolveMountSource = fs.realpathSync,
  mountAccessPrincipal,
} = {}) {
  const root = assertRuntimeRoot(runtimeRoot, 'runtime_root');
  if (typeof runCommand !== 'function') {
    throw new Error('attempt_runner_invalid_docker_command_runner');
  }
  if (typeof writeCredential !== 'function') {
    throw new Error('attempt_runner_invalid_credential_writer');
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

  return Object.freeze({
    async launch(input) {
      const attemptId = input?.attemptId;
      assertAttemptId(attemptId);
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
      const workspaceSource = canonicalMountSource(input.workspaceMount.source);
      const workspaceAdminSource = canonicalMountSource(
        input.workspaceAdminMount.source,
      );
      const runtimeSource = canonicalMountSource(attemptRuntime);
      const promptFile = path.join(attemptRuntime, 'task-bundle.json');
      const stdoutFile = path.join(attemptRuntime, 'stdout.jsonl');
      const isCodex = input.providerSpec?.provider === 'codex';
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
        '--add-host',
        'host.docker.internal:host-gateway',
        ...envArgs({
          CECELIA_EXECUTOR: input.providerSpec.provider,
          CECELIA_TASK_ID: attemptId,
          HARNESS_TASK_ID: attemptId,
          HARNESS_ATTEMPT_ID: attemptId,
          HARNESS_RUN_ID: input.runId,
          HARNESS_CALLBACK_URL: input.callback.url,
          HARNESS_CALLBACK_TOKEN: input.callback.token,
          HARNESS_LEASE_OWNER: input.lease.owner,
          HARNESS_LEASE_GENERATION: input.lease.generation,
          HARNESS_READ_ONLY: String(input.workspaceMount.readOnly),
          HARNESS_NODE: input.role,
          HARNESS_MODEL: input.model,
          HARNESS_TASK_BUNDLE_FILE: containerPrompt,
          CECELIA_PROMPT_FILE: containerPrompt,
          CECELIA_STDOUT_FILE: containerStdout,
          CECELIA_CREDENTIAL_FIFO: isCodex
            ? containerCredentialFifo
            : undefined,
          CECELIA_CREDENTIAL_REF: isCodex
            ? input.credential.credentialRef
            : undefined,
          WORKTREE_PATH: '/workspace',
          BRAIN_URL: callbackBrainUrl(input.callback.url),
        }),
        input.image,
      ];
      let created;
      try {
        if (isCodex) {
          await runCommand('mkfifo', ['-m', '600', credentialFifo], undefined);
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
        await runCommand('docker', ['start', containerName], undefined);
        if (isCodex) {
          try {
            await writeCredential(
              containerName,
              containerCredentialFifo,
              input.credential.authJson,
            );
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

    async remove({ containerId, attemptId, containerMissing = false } = {}) {
      assertAttemptId(attemptId);
      if (!containerMissing) {
        await runCommand('docker', ['rm', '-f', '--', containerId], undefined);
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
}) {
  for (const method of ['prepare', 'verify', 'cleanup', 'quarantine', 'reconcile']) {
    requireMethod(workspaceManager, method, 'workspace_manager');
  }
  for (const method of ['launch', 'inspect', 'wait', 'remove', 'listOwned']) {
    requireMethod(docker, method, 'docker');
  }
  for (const method of ['save', 'get', 'delete', 'list']) {
    requireMethod(stateStore, method, 'state_store');
  }
  requireMethod(credentialConsumer, 'consume', 'credential_consumer');
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
    || !/^(planner|proposer|reviewer|generator|evaluator|judge|reporter)$/
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
  return {
    request: value,
    providerSpec: validateProviderSpec(value.provider_spec),
    target: validateTarget(value.target),
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

function createAttemptRunner({
  workspaceManager,
  docker,
  stateStore,
  workerId,
  runnerImageDigest,
  credentialConsumer,
} = {}) {
  validateDependencies({
    workspaceManager,
    docker,
    stateStore,
    workerId,
    runnerImageDigest,
    credentialConsumer,
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

  async function cleanupWorkspaceState(state) {
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
    await stateStore.delete(state.attempt_id);
    return Object.freeze({
      status: 'cleaned',
      attempt_id: state.attempt_id,
    });
  }

  const runner = {
    async launch(input) {
      const { request, providerSpec, target } = validateLaunchRequest(input);
      if (target.machine !== workerId) {
        throw new Error('attempt_target_worker_mismatch');
      }
      const existing = await stateStore.get(request.attempt_id);
      if (existing) {
        throw new Error('attempt_already_exists');
      }

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
      const workspace = await workspaceManager.prepare(request.workspace_spec);
      await workspaceManager.verify(workspace);
      const labels = labelsFor(request, workerId);
      let launched;
      try {
        launched = await docker.launch({
          attemptId: request.attempt_id,
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
          callback: {
            url: request.callback_url,
            token: request.callback_token,
          },
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
        attempt_id: request.attempt_id,
        run_id: request.run_id,
        worker_id: workerId,
        lease_owner: request.lease_owner,
        lease_generation: request.lease_generation,
        provider: providerSpec.provider,
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
      try {
        await docker.remove({
          containerId: state.container_id,
          attemptId: state.attempt_id,
        });
      } catch (error) {
        return quarantineState(state, error);
      }
      return cleanupWorkspaceState(state);
    },

    async cancel(attemptId, lease) {
      const state = await stateStore.get(attemptId);
      if (!state) {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      assertLeaseFence(state, lease);
      return this.terminal(attemptId, lease);
    },

    async reconcile() {
      const states = await stateStore.list();
      const ownedStates = states.filter((state) => state.worker_id === workerId);
      const knownAttemptIds = new Set(ownedStates.map((state) => state.attempt_id));
      const retainedAttemptIds = new Set(states.map((state) => state.attempt_id));
      const cleanedAttempts = [];

      for (const state of ownedStates) {
        const inspected = await docker.inspect({ containerId: state.container_id });
        if (!isTerminalContainerStatus(inspected.status)) continue;
        try {
          await docker.remove({
            containerId: state.container_id,
            attemptId: state.attempt_id,
            ...(inspected.status === 'missing' ? { containerMissing: true } : {}),
          });
        } catch (error) {
          await quarantineState(state, error);
          continue;
        }
        const result = await cleanupWorkspaceState(state);
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

      return Object.freeze({
        cleaned_attempts: Object.freeze(cleanedAttempts),
        removed_orphan_containers: Object.freeze(removedOrphanContainers),
        cleaned_orphan_workspaces: Object.freeze(
          workspaceReconciliation.cleaned_attempts ?? [],
        ),
      });
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
