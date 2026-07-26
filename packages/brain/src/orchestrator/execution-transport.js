const TRANSPORT_METHODS = ['launch', 'inspect', 'cancel'];

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
    if (machine === 'us-mac-m4') return local;
    if (machine === 'xian-mac-m4' || machine === 'xian-mac-m1') return remote;
    throw new Error(`execution_transport_unavailable:${String(machine)}`);
  };

  return Object.freeze({
    async launch(input) {
      const machine = input?.target?.machine;
      const launched = await transportFor(machine).launch(input);
      if (machine !== 'us-mac-m4') return launched;
      return {
        ...launched,
        actualMachineId: 'us-mac-m4',
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
      };
    },
    inspect(input) {
      return transportFor(input?.target?.machine).inspect(input);
    },
    cancel(input) {
      return transportFor(input?.target?.machine).cancel(input);
    },
  });
}
