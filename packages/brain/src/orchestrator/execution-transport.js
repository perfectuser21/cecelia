const TRANSPORT_METHODS = ['launch', 'inspect', 'cancel'];

function validateTransport(name, transport) {
  for (const method of TRANSPORT_METHODS) {
    if (typeof transport?.[method] !== 'function') {
      throw new Error(`invalid_execution_transport:${name}.${method}`);
    }
  }
}

export function createExecutionTransportRouter({
  local,
  remote,
  localMachineId = 'us-mac-m4',
} = {}) {
  validateTransport('local', local);
  validateTransport('remote', remote);

  const transportFor = (machine) => {
    if (machine === localMachineId) return local;
    if (machine === 'xian-mac-m4' || machine === 'xian-mac-m1') return remote;
    throw new Error(`execution_transport_unavailable:${String(machine)}`);
  };

  return Object.freeze({
    async launch(input) {
      const machine = input?.target?.machine;
      const launched = await transportFor(machine).launch(input);
      if (machine !== localMachineId) return launched;
      return {
        ...launched,
        actualMachineId: localMachineId,
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
