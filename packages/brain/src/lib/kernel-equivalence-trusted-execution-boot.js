import { readFileSync } from 'node:fs';

import {
  BRAIN_TRUSTED_EXECUTION_SOCKET_PATH,
} from './kernel-equivalence-trusted-execution-client.js';
import {
  startBrainTrustedExecutionSocketServer,
} from './kernel-equivalence-trusted-execution-socket-server.js';
import {
  loadProductionTrustedExecutionWiring,
} from './kernel-equivalence-production-wiring.js';
import {
  createPostgresKernelEquivalenceCoordinator,
} from './kernel-equivalence-production-coordinator.js';

const BRAIN_VERSION = JSON.parse(readFileSync(
  new URL('../../package.json', import.meta.url),
  'utf8',
)).version;
const ENGINE_VERSION = readFileSync(
  new URL('../../../engine/VERSION', import.meta.url),
  'utf8',
).trim();
const RECONCILIATION_INTERVAL_MS = 1_000;

function readiness(ready, code, socketPath) {
  return Object.freeze({
    ready,
    code,
    socket_path: socketPath,
  });
}

function stableProductionFailureCode(error, fallback) {
  const code = error?.code;
  return (
    typeof code === 'string'
    && code.length <= 128
    && /^(?:trusted_execution|trusted_runtime|production_trusted_execution)_[a-z0-9_]+$/.test(code)
  )
    ? code
    : fallback;
}

export async function bootBrainTrustedExecution({
  createService,
  readinessSigner,
  socketPath = BRAIN_TRUSTED_EXECUTION_SOCKET_PATH,
} = {}) {
  if (typeof createService !== 'function') {
    return Object.freeze({
      getReadiness: () => readiness(
        false,
        'trusted_execution_assembly_unconfigured',
        null,
      ),
      close: async () => {},
    });
  }

  let listener;
  try {
    const service = await createService();
    listener = await startBrainTrustedExecutionSocketServer({
      readinessSigner,
      service,
      socketPath,
    });
  } catch (error) {
    const code = stableProductionFailureCode(
      error,
      'trusted_execution_assembly_unavailable',
    );
    return Object.freeze({
      getReadiness: () => readiness(false, code, null),
      close: async () => {},
    });
  }

  return Object.freeze({
    getReadiness: listener.getReadiness,
    close: listener.close,
  });
}

export async function bootProductionBrainTrustedExecution({
  env = process.env,
  pool,
  assemblyPorts,
  now = Date.now,
} = {}) {
  let wiring;
  try {
    wiring = loadProductionTrustedExecutionWiring({
      env,
      pool,
      assemblyPorts,
      now,
    });
  } catch (error) {
    const code = stableProductionFailureCode(
      error,
      'trusted_execution_config_unavailable',
    );
    return Object.freeze({
      getReadiness: () => readiness(false, code, null),
      close: async () => {},
    });
  }

  let controller;
  try {
    controller = createPostgresKernelEquivalenceCoordinator({
      pool,
      grantIssuer: wiring.grantIssuer,
      grantExecutionAuthority: wiring.grantExecutionAuthority,
      plan: wiring.plan,
      socketPath: wiring.socket_path,
      brainVersion: BRAIN_VERSION,
      engineVersion: ENGINE_VERSION,
      grantTtlSeconds: wiring.grant_ttl_seconds,
      now,
    });
    await wiring.grantIssuer.cleanupExpiredGrants();
    await controller.reconcileStartup();
  } catch (error) {
    const code = stableProductionFailureCode(
      error,
      'trusted_execution_controller_unavailable',
    );
    return Object.freeze({
      getReadiness: () => readiness(false, code, null),
      close: async () => {},
    });
  }
  const listener = await bootBrainTrustedExecution({
    createService: wiring.createService,
    readinessSigner: wiring.readinessSigner,
    socketPath: wiring.socket_path,
  });
  if (!listener.getReadiness().ready) return listener;

  let available = true;
  let closed = false;
  let listenerClosed = false;
  let maintenanceFailure = null;
  let maintenancePromise = null;
  let interval = null;

  const closeListener = async () => {
    if (listenerClosed) return;
    listenerClosed = true;
    await listener.close();
  };
  const stopInterval = () => {
    if (interval == null) return;
    clearInterval(interval);
    interval = null;
  };
  const failClosed = async () => {
    if (!available) return;
    available = false;
    maintenanceFailure =
      'trusted_execution_controller_reconcile_failed';
    stopInterval();
    await closeListener();
  };
  const maintain = async () => {
    if (closed || !available) return;
    if (maintenancePromise) return maintenancePromise;
    maintenancePromise = (async () => {
      try {
        await wiring.grantIssuer.cleanupExpiredGrants();
        await controller.reconcileStartup();
      } catch {
        await failClosed();
      } finally {
        maintenancePromise = null;
      }
    })();
    return maintenancePromise;
  };

  interval = setInterval(async () => {
    await maintain();
  }, RECONCILIATION_INTERVAL_MS);
  interval.unref?.();

  return Object.freeze({
    getReadiness: () => (
      available
        ? listener.getReadiness()
        : readiness(false, maintenanceFailure, null)
    ),
    close: async () => {
      if (closed) return;
      closed = true;
      available = false;
      stopInterval();
      await maintenancePromise;
      await closeListener();
    },
    grantIssuer: wiring.grantIssuer,
    get controller() {
      return available ? controller : null;
    },
  });
}
