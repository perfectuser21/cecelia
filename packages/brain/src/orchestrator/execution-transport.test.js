import { describe, expect, it, vi } from 'vitest';

import { createExecutionTransportRouter } from './execution-transport.js';

function createTransport(name) {
  return {
    launch: vi.fn(async () => ({ source: name, launchField: 'preserved' })),
    inspect: vi.fn(async () => ({ source: name, state: 'running' })),
    cancel: vi.fn(async () => ({ source: name, cancelled: true })),
  };
}

function createRouter() {
  const local = createTransport('local');
  const remote = createTransport('remote');
  return {
    local,
    remote,
    router: createExecutionTransportRouter({ local, remote }),
  };
}

describe('execution transport dependency validation', () => {
  it.each([
    ['local.launch', { local: { inspect() {}, cancel() {} }, remote: createTransport('remote') }],
    ['local.inspect', { local: { launch() {}, cancel() {} }, remote: createTransport('remote') }],
    ['local.cancel', { local: { launch() {}, inspect() {} }, remote: createTransport('remote') }],
    ['remote.launch', { local: createTransport('local'), remote: { inspect() {}, cancel() {} } }],
    ['remote.inspect', { local: createTransport('local'), remote: { launch() {}, cancel() {} } }],
    ['remote.cancel', { local: createTransport('local'), remote: { launch() {}, inspect() {} } }],
  ])('fails clearly when %s is unavailable', (dependency, transports) => {
    expect(() => createExecutionTransportRouter(transports)).toThrow(
      `invalid_execution_transport:${dependency}`,
    );
  });

  it('fails clearly when a transport object is missing', () => {
    expect(() => createExecutionTransportRouter({
      local: createTransport('local'),
    })).toThrow('invalid_execution_transport:remote.launch');
  });
});

describe('execution transport routing', () => {
  it('routes a US launch only to local and enriches its result without losing fields', async () => {
    const { local, remote, router } = createRouter();
    const input = {
      attempt: { id: 'attempt-us' },
      target: { machine: 'us-mac-m4' },
      opaque: 'unchanged',
    };
    local.launch.mockResolvedValueOnce({
      launchField: 'preserved',
      actualMachineId: 'untrusted-value',
      remoteJobId: 'must-be-cleared',
    });

    await expect(router.launch(input)).resolves.toEqual({
      launchField: 'preserved',
      actualMachineId: 'us-mac-m4',
      executionTransport: 'local-docker',
      remoteJobId: null,
      attestationStatus: 'local',
    });
    expect(local.launch).toHaveBeenCalledOnce();
    expect(local.launch).toHaveBeenCalledWith(input);
    expect(remote.launch).not.toHaveBeenCalled();
  });

  it.each(['xian-mac-m4', 'xian-mac-m1'])(
    'routes a %s launch only to remote and returns its result unchanged',
    async (machine) => {
      const { local, remote, router } = createRouter();
      const input = { attempt: { id: `attempt-${machine}` }, target: { machine } };
      const remoteResult = {
        marker: Symbol(machine),
        actualMachineId: machine,
        executionTransport: 'remote-bridge',
      };
      remote.launch.mockResolvedValueOnce(remoteResult);

      const result = await router.launch(input);

      expect(result).toBe(remoteResult);
      expect(remote.launch).toHaveBeenCalledOnce();
      expect(remote.launch).toHaveBeenCalledWith(input);
      expect(local.launch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['inspect', 'us-mac-m4', 'local'],
    ['inspect', 'xian-mac-m4', 'remote'],
    ['inspect', 'xian-mac-m1', 'remote'],
    ['cancel', 'us-mac-m4', 'local'],
    ['cancel', 'xian-mac-m4', 'remote'],
    ['cancel', 'xian-mac-m1', 'remote'],
  ])('routes %s for %s only to %s and passes through input and result', async (
    operation,
    machine,
    expectedTransport,
  ) => {
    const { local, remote, router } = createRouter();
    const input = { target: { machine }, remoteJobId: 'remote-job-1' };
    const selected = expectedTransport === 'local' ? local : remote;
    const unselected = expectedTransport === 'local' ? remote : local;
    const transportResult = { operation, machine };
    selected[operation].mockResolvedValueOnce(transportResult);

    const result = await router[operation](input);

    expect(result).toBe(transportResult);
    expect(selected[operation]).toHaveBeenCalledOnce();
    expect(selected[operation]).toHaveBeenCalledWith(input);
    expect(unselected[operation]).not.toHaveBeenCalled();
  });

  it.each([
    ['launch', { target: { machine: 'moon-base' } }, 'moon-base'],
    ['inspect', { target: { machine: 'moon-base' } }, 'moon-base'],
    ['cancel', { target: { machine: 'moon-base' } }, 'moon-base'],
    ['launch', {}, 'undefined'],
    ['inspect', { target: {} }, 'undefined'],
    ['cancel', { target: null }, 'undefined'],
  ])('%s rejects machine %s without calling either transport', async (
    operation,
    input,
    machine,
  ) => {
    const { local, remote, router } = createRouter();

    await expect(Promise.resolve().then(() => router[operation](input))).rejects.toThrow(
      `execution_transport_unavailable:${machine}`,
    );
    expect(local[operation]).not.toHaveBeenCalled();
    expect(remote[operation]).not.toHaveBeenCalled();
  });

  it.each([
    ['launch', 'us-mac-m4', 'local', 'remote'],
    ['launch', 'xian-mac-m4', 'remote', 'local'],
    ['inspect', 'xian-mac-m1', 'remote', 'local'],
    ['cancel', 'us-mac-m4', 'local', 'remote'],
  ])('does not fall back when selected %s transport fails for %s', async (
    operation,
    machine,
    selectedName,
    unselectedName,
  ) => {
    const { local, remote, router } = createRouter();
    const selected = selectedName === 'local' ? local : remote;
    const unselected = unselectedName === 'local' ? local : remote;
    const input = { target: { machine } };
    const transportFailure = new Error(`${selectedName}-${operation}-failed`);
    selected[operation].mockRejectedValueOnce(transportFailure);

    await expect(router[operation](input)).rejects.toBe(transportFailure);
    expect(selected[operation]).toHaveBeenCalledOnce();
    expect(unselected[operation]).not.toHaveBeenCalled();
  });
});
