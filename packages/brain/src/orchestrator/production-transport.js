import { createRemoteBridgeTransport } from './remote-bridge-transport.js';

export const DEFAULT_LOCAL_MACHINE_ID = 'us-mac-m4';
export const DEFAULT_WORKER_BRAIN_URL = 'http://host.docker.internal:5221';
export const DEFAULT_REMOTE_BRIDGE_TIMEOUT_MS = 60_000;
export const DEFAULT_REMOTE_BRIDGE_PREPARE_TIMEOUT_MS = 180_000;
// start 要等 docker start + credential FIFO 写入（entrypoint.sh 真正打开读端）都完成
// 才返回；真实负载下（并发 attempt 抢 CPU/virtiofs）FIFO 写入实测能逼近甚至撞上
// 通用 60s 控制请求超时（remote_bridge_start_timeout），掩盖 attempt-runner 自己
// 更具体的 attempt_*_credential_fifo_write_failed 错误。给 start 单独更大预算，
// 不再和 inspect/cancel/terminal 这类轻量轮询共用 60s 桶。
export const DEFAULT_REMOTE_BRIDGE_START_TIMEOUT_MS = 120_000;

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
      || (
        requireWorkspace
        && (
          !isValidHttpBaseUrl(callbackBaseUrl)
          || input?.bundle?.inputs?.execution_surface !== 'fleet-worker'
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
    async prepare(input) {
      assertAvailable(input, { requireWorkspace: true });
      return worker.prepare(input);
    },
    async start(input) {
      assertAvailable(input);
      return worker.start(input);
    },
    async inspect(input) {
      assertAvailable(input);
      return worker.inspect(input);
    },
    async cancel(input) {
      assertAvailable(input);
      return worker.cancel(input);
    },
    async terminal(input) {
      assertAvailable(input);
      return worker.terminal(input);
    },
  });
}

export function createProductionExecutionTransport({
  env = {},
  localMachineId = DEFAULT_LOCAL_MACHINE_ID,
  fetchFn,
  credentialBroker,
  githubCredentialBroker,
  remoteBridgeTimeoutMs,
  remoteBridgePrepareTimeoutMs,
  remoteBridgeStartTimeoutMs,
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
  const configuredPrepareTimeout = remoteBridgePrepareTimeoutMs
    ?? (
      env.KERNEL_FLEET_PREPARE_TIMEOUT_MS == null
      || env.KERNEL_FLEET_PREPARE_TIMEOUT_MS === ''
        ? (remoteBridgeTimeoutMs ?? DEFAULT_REMOTE_BRIDGE_PREPARE_TIMEOUT_MS)
        : Number(env.KERNEL_FLEET_PREPARE_TIMEOUT_MS)
    );
  const configuredStartTimeout = remoteBridgeStartTimeoutMs
    ?? (
      env.KERNEL_FLEET_START_TIMEOUT_MS == null
      || env.KERNEL_FLEET_START_TIMEOUT_MS === ''
        ? (remoteBridgeTimeoutMs ?? DEFAULT_REMOTE_BRIDGE_START_TIMEOUT_MS)
        : Number(env.KERNEL_FLEET_START_TIMEOUT_MS)
    );
  const worker = createRemoteBridgeTransport({
    enabled,
    bridgeUrls: workerUrls,
    sharedSecret,
    brainUrl: callbackBaseUrl,
    credentialBroker,
    githubCredentialBroker,
    fetchFn,
    timeoutMs: remoteBridgeTimeoutMs ?? DEFAULT_REMOTE_BRIDGE_TIMEOUT_MS,
    prepareTimeoutMs: configuredPrepareTimeout,
    startTimeoutMs: configuredStartTimeout,
  });

  return guardWorkerConfiguration(worker, {
    enabled,
    workerUrls,
    sharedSecret,
    callbackBaseUrl,
  });
}
