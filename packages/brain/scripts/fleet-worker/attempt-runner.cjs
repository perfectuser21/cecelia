#!/usr/bin/env node
'use strict';

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
const PROVIDER_PATTERN = /^(codex|claude|grok)$/;

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
}) {
  for (const method of ['prepare', 'verify', 'cleanup', 'quarantine']) {
    requireMethod(workspaceManager, method, 'workspace_manager');
  }
  for (const method of ['launch', 'inspect', 'remove', 'listOwned']) {
    requireMethod(docker, method, 'docker');
  }
  for (const method of ['save', 'get', 'delete', 'list']) {
    requireMethod(stateStore, method, 'state_store');
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
  if (typeof value.output !== 'string' || value.output.length === 0) {
    throw new Error('attempt_provider_output_invalid');
  }
  return Object.freeze({
    provider: value.provider,
    command: value.command,
    args: Object.freeze([...value.args]),
    stdin: value.stdin,
    output: value.output,
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

function createAttemptRunner({
  workspaceManager,
  docker,
  stateStore,
  workerId,
  runnerImageDigest,
} = {}) {
  validateDependencies({
    workspaceManager,
    docker,
    stateStore,
    workerId,
    runnerImageDigest,
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
      const { request, providerSpec } = validateLaunchRequest(input);
      const existing = await stateStore.get(request.attempt_id);
      if (existing) {
        throw new Error('attempt_already_exists');
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
          workspaceMount: {
            source: workspace.path,
            target: '/workspace',
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
        container_id: launched.containerId,
        workspace,
        labels,
        status: 'running',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await stateStore.save(state);
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

    async terminal(attemptId) {
      const state = await stateStore.get(attemptId);
      if (!state) {
        return Object.freeze({ status: 'already_clean', attempt_id: attemptId });
      }
      if (state.worker_id !== workerId) {
        throw new Error('attempt_worker_owner_mismatch');
      }
      try {
        await docker.remove({ containerId: state.container_id });
      } catch (error) {
        return quarantineState(state, error);
      }
      return cleanupWorkspaceState(state);
    },

    async cancel(attemptId) {
      return this.terminal(attemptId);
    },

    async reconcile() {
      const states = await stateStore.list();
      const ownedStates = states.filter((state) => state.worker_id === workerId);
      const knownAttemptIds = new Set(ownedStates.map((state) => state.attempt_id));
      const cleanedAttempts = [];

      for (const state of ownedStates) {
        const inspected = await docker.inspect({ containerId: state.container_id });
        if (!isTerminalContainerStatus(inspected.status)) continue;
        if (inspected.status !== 'missing') {
          try {
            await docker.remove({ containerId: state.container_id });
          } catch (error) {
            await quarantineState(state, error);
            continue;
          }
        }
        const result = await cleanupWorkspaceState(state);
        if (result.status === 'cleaned') cleanedAttempts.push(state.attempt_id);
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
        await docker.remove({ containerId: container.containerId });
        removedOrphanContainers.push(container.containerId);
      }

      return Object.freeze({
        cleaned_attempts: Object.freeze(cleanedAttempts),
        removed_orphan_containers: Object.freeze(removedOrphanContainers),
      });
    },
  };

  return Object.freeze(runner);
}

module.exports = {
  createAttemptRunner,
};
