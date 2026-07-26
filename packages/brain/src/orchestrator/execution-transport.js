import { listCanonicalMachineIds } from './preflight/canonical-machine-id.js';

const TRANSPORT_METHODS = ['launch', 'inspect', 'cancel'];
const [LOCAL_MACHINE_ID, ...REMOTE_MACHINE_IDS] = listCanonicalMachineIds();
const REMOTE_MACHINE_SET = new Set(REMOTE_MACHINE_IDS);

function validateTransport(name, transport) {
  for (const method of TRANSPORT_METHODS) {
    if (typeof transport?.[method] !== 'function') {
      throw new Error(`invalid_execution_transport:${name}.${method}`);
    }
  }
}

export function createExecutionTransportRouter({ local, remote } = {}) {
  validateTransport('local', local);
  validateTransport('remote', remote);

  const transportFor = (machine) => {
    if (machine === LOCAL_MACHINE_ID) return local;
    if (REMOTE_MACHINE_SET.has(machine)) return remote;
    throw new Error(`execution_transport_unavailable:${String(machine)}`);
  };

  return Object.freeze({
    async launch(input) {
      const machine = input?.target?.machine;
      const launched = await transportFor(machine).launch(input);
      if (machine !== LOCAL_MACHINE_ID) return launched;
      return {
        ...launched,
        actualMachineId: LOCAL_MACHINE_ID,
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
      };
    },
    async inspect(input) {
      return transportFor(input?.target?.machine).inspect(input);
    },
    async cancel(input) {
      return transportFor(input?.target?.machine).cancel(input);
    },
  });
}
