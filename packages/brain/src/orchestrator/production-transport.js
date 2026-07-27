import { createRemoteBridgeTransport } from './remote-bridge-transport.js';

export const DEFAULT_LOCAL_MACHINE_ID = 'us-mac-m4';
export const DEFAULT_WORKER_BRAIN_URL = 'http://host.docker.internal:5221';

function isValidHttpBaseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
    );
  } catch {
    return false;
  }
}

function guardWorkerConfiguration(worker, {
  enabled,
  workerUrls,
  sharedSecret,
  callbackBaseUrl,
}) {
  const assertAvailable = (input, { requireWorkspace = false } = {}) => {
    const machine = input?.target?.machine;
    const workerUrl = workerUrls?.[machine];
    const workspaceSpec = input?.bundle?.inputs?.workspace_spec;
    if (
      enabled !== true
      || !isValidHttpBaseUrl(workerUrl)
      || typeof sharedSecret !== 'string'
      || sharedSecret.length < 32
      || !isValidHttpBaseUrl(callbackBaseUrl)
      || (
        requireWorkspace
        && (
          input?.bundle?.inputs?.execution_surface !== 'fleet-worker'
          || !workspaceSpec
          || typeof workspaceSpec !== 'object'
          || Array.isArray(workspaceSpec)
        )
      )
    ) {
      throw new Error(`execution_transport_unavailable:${String(machine)}`);
    }
  };
  return Object.freeze({
    async launch(input) {
      assertAvailable(input, { requireWorkspace: true });
      return worker.launch(input);
    },
    async inspect(input) {
      assertAvailable(input);
      return worker.inspect(input);
    },
    async cancel(input) {
      assertAvailable(input);
      return worker.cancel(input);
    },
  });
}

export function createProductionExecutionTransport({
  env = {},
  localMachineId = DEFAULT_LOCAL_MACHINE_ID,
  fetchFn,
  remoteBridgeTimeoutMs,
} = {}) {
  if (localMachineId !== DEFAULT_LOCAL_MACHINE_ID) {
    throw new Error(`invalid_local_execution_machine_id:${String(localMachineId)}`);
  }
  const enabled = env.KERNEL_FLEET_REMOTE_ENABLED === 'true';
  const workerUrls = {
    'us-mac-m4': env.FLEET_WORKER_US_MAC_M4_URL,
    'xian-mac-m4': env.FLEET_WORKER_XIAN_MAC_M4_URL,
    'xian-mac-m1': env.FLEET_WORKER_XIAN_MAC_M1_URL,
  };
  const sharedSecret = env.KERNEL_FLEET_BRIDGE_TOKEN;
  const callbackBaseUrl = env.KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL;
  const worker = createRemoteBridgeTransport({
    enabled,
    bridgeUrls: workerUrls,
    sharedSecret,
    brainUrl: callbackBaseUrl,
    fetchFn,
    timeoutMs: remoteBridgeTimeoutMs,
  });

  return guardWorkerConfiguration(worker, {
    enabled,
    workerUrls,
    sharedSecret,
    callbackBaseUrl,
  });
}
