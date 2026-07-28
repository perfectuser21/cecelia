import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupExpiredGrants: vi.fn(),
  createCoordinator: vi.fn(),
  loadWiring: vi.fn(),
  startListener: vi.fn(),
}));

vi.mock('../kernel-equivalence-production-wiring.js', () => ({
  loadProductionTrustedExecutionWiring: mocks.loadWiring,
}));
vi.mock('../kernel-equivalence-production-coordinator.js', () => ({
  createPostgresKernelEquivalenceCoordinator:
    mocks.createCoordinator,
}));
vi.mock('../kernel-equivalence-trusted-execution-socket-server.js', () => ({
  startBrainTrustedExecutionSocketServer: mocks.startListener,
}));

import {
  bootProductionBrainTrustedExecution,
} from '../kernel-equivalence-trusted-execution-boot.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function controller(reconcileStartup) {
  return Object.freeze({
    owner_service: 'brain.kernel_equivalence.controller',
    capability_id:
      'brain.kernel_equivalence.production_controller.v1',
    schema_version:
      'kernel-equivalence-production-controller/v1',
    executeCase: vi.fn(),
    reconcileStartup,
  });
}

describe('production trusted execution boot lifecycle', () => {
  let intervalCallback;
  let intervalHandle;
  let listener;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    intervalCallback = null;
    intervalHandle = { unref: vi.fn() };
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
      intervalCallback = callback;
      return intervalHandle;
    });
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    listener = {
      getReadiness: vi.fn(() => ({
        ready: true,
        code: null,
        socket_path: '/tmp/kernel-equivalence.sock',
      })),
      close: vi.fn(async () => {}),
    };
    mocks.startListener.mockResolvedValue(listener);
    mocks.cleanupExpiredGrants.mockResolvedValue({
      removed: 0,
      retained: 0,
    });
    mocks.loadWiring.mockReturnValue({
      createService: vi.fn(),
      readinessSigner: Object.freeze({}),
      socket_path: '/tmp/kernel-equivalence.sock',
      grantIssuer: Object.freeze({
        cleanupExpiredGrants: mocks.cleanupExpiredGrants,
      }),
      grant_ttl_seconds: 60,
      plan: Object.freeze({}),
    });
  });

  it('does not expose the Unix listener before startup reconciliation completes', async () => {
    const barrier = deferred();
    const value = controller(vi.fn(() => barrier.promise));
    mocks.createCoordinator.mockReturnValue(value);

    const bootPromise = bootProductionBrainTrustedExecution({
      env: {},
      pool: {},
      assemblyPorts: {},
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.startListener).not.toHaveBeenCalled();
    barrier.resolve({
      inspected: 0,
      settled: 0,
      retained_unknown: 0,
    });
    const boot = await bootPromise;

    expect(mocks.cleanupExpiredGrants).toHaveBeenCalledOnce();
    expect(mocks.startListener).toHaveBeenCalledOnce();
    expect(boot.controller).toBe(value);
    expect(intervalCallback).toEqual(expect.any(Function));
    expect(intervalHandle.unref).toHaveBeenCalledOnce();
    await boot.close();
  });

  it('fails closed when periodic reconciliation or grant cleanup fails', async () => {
    const reconcileStartup = vi.fn()
      .mockResolvedValueOnce({
        inspected: 0,
        settled: 0,
        retained_unknown: 0,
      })
      .mockRejectedValueOnce(new Error('database unavailable'));
    const value = controller(reconcileStartup);
    mocks.createCoordinator.mockReturnValue(value);
    const boot = await bootProductionBrainTrustedExecution({
      env: {},
      pool: {},
      assemblyPorts: {},
    });

    await intervalCallback();

    expect(mocks.cleanupExpiredGrants).toHaveBeenCalledTimes(2);
    expect(listener.close).toHaveBeenCalledOnce();
    expect(boot.controller).toBeNull();
    expect(boot.getReadiness()).toEqual({
      ready: false,
      code: 'trusted_execution_controller_reconcile_failed',
      socket_path: null,
    });
    expect(clearInterval).toHaveBeenCalledWith(intervalHandle);
    await boot.close();
  });
});
