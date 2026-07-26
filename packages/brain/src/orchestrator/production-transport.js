import { createDetachedLauncher } from './dispatcher.js';
import { createExecutionTransportRouter } from './execution-transport.js';
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

function guardRemoteConfiguration(remote, {
  enabled,
  bridgeUrls,
  sharedSecret,
  callbackBaseUrl,
}) {
  const assertAvailable = (input) => {
    const machine = input?.target?.machine;
    const bridgeUrl = bridgeUrls?.[machine];
    if (
      enabled !== true
      || !isValidHttpBaseUrl(bridgeUrl)
      || typeof sharedSecret !== 'string'
      || sharedSecret.length < 32
      || !isValidHttpBaseUrl(callbackBaseUrl)
    ) {
      throw new Error(`execution_transport_unavailable:${String(machine)}`);
    }
  };
  return Object.freeze({
    async launch(input) {
      assertAvailable(input);
      return remote.launch(input);
    },
    async inspect(input) {
      assertAvailable(input);
      return remote.inspect(input);
    },
    async cancel(input) {
      assertAvailable(input);
      return remote.cancel(input);
    },
  });
}

export function createProductionExecutionTransport({
  env = {},
  attemptStore,
  spawnDetached,
  removeContainer,
  brainUrl = env.BRAIN_URL ?? DEFAULT_WORKER_BRAIN_URL,
  leaseOwner,
  localMachineId = DEFAULT_LOCAL_MACHINE_ID,
  fetchFn,
  remoteBridgeTimeoutMs,
} = {}) {
  if (localMachineId !== DEFAULT_LOCAL_MACHINE_ID) {
    throw new Error(`invalid_local_execution_machine_id:${String(localMachineId)}`);
  }
  const local = createDetachedLauncher({
    spawnDetached,
    removeContainer,
    attemptStore,
    brainUrl,
    leaseOwner,
    machineId: localMachineId,
  });
  const enabled = env.KERNEL_FLEET_REMOTE_ENABLED === 'true';
  const bridgeUrls = {
    'xian-mac-m4': env.XIAN_M4_KERNEL_BRIDGE_URL,
    'xian-mac-m1': env.XIAN_M1_KERNEL_BRIDGE_URL,
  };
  const sharedSecret = env.KERNEL_FLEET_BRIDGE_TOKEN;
  const callbackBaseUrl = env.KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL;
  const remote = createRemoteBridgeTransport({
    enabled,
    bridgeUrls,
    sharedSecret,
    brainUrl: callbackBaseUrl,
    fetchFn,
    timeoutMs: remoteBridgeTimeoutMs,
  });

  return createExecutionTransportRouter({
    local,
    localMachineId,
    remote: guardRemoteConfiguration(remote, {
      enabled,
      bridgeUrls,
      sharedSecret,
      callbackBaseUrl,
    }),
  });
}
