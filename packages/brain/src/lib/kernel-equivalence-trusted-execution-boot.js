import {
  BRAIN_TRUSTED_EXECUTION_SOCKET_PATH,
} from './kernel-equivalence-trusted-execution-client.js';
import {
  startBrainTrustedExecutionSocketServer,
} from './kernel-equivalence-trusted-execution-socket-server.js';
import {
  loadProductionTrustedExecutionWiring,
} from './kernel-equivalence-production-wiring.js';

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
  return bootBrainTrustedExecution({
    createService: wiring.createService,
    readinessSigner: wiring.readinessSigner,
    socketPath: wiring.socket_path,
  });
}
