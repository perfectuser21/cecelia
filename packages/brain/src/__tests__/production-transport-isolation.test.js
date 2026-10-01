import { afterEach, describe, expect, it, vi } from 'vitest';
const worker = vi.hoisted(() => Object.fromEntries(['prepare', 'start', 'inspect', 'cancel', 'terminal'].map(key => [key, vi.fn()])));
vi.mock('../machine-registry.js', () => ({ resolvePrimaryWorkerId: () => 'us-mac-m4' }));
vi.mock('../orchestrator/remote-bridge-transport.js', () => ({ createRemoteBridgeTransport: () => worker }));
import { createProductionExecutionTransport } from '../orchestrator/production-transport.js';
const configured = { KERNEL_FLEET_REMOTE_ENABLED: 'true', KERNEL_FLEET_BRIDGE_TOKEN: 'fixture-token-with-at-least-32-bytes',
  KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'http://fixture-brain:5221', FLEET_WORKER_US_MAC_M4_URL: 'http://fixture-worker:5231' };
const input = { target: { machine: 'us-mac-m4' }, bundle: { inputs: { execution_surface: 'fleet-worker', workspace_spec: {} } } };

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('新版 Fleet 派发也遵守宿主和目标环境的隔离', () => {
  it.each(['prepare', 'start', 'inspect', 'cancel', 'terminal'])('%s 不触及真实 worker', async method => {
    vi.stubEnv('NODE_ENV', 'test');
    const transport = createProductionExecutionTransport({ env: { ...configured, NODE_ENV: 'production' } });
    await expect(transport[method](input)).rejects.toMatchObject({ code: 'EXECUTION_RUNTIME_ISOLATED' });
    expect(worker[method]).not.toHaveBeenCalled();
  });
  it('生产宿主不能用测试配置派发', async () => {
    for (const key of ['NODE_ENV','VITEST','DB_NAME','PGDATABASE','DATABASE_URL','BRAIN_PREVIEW','BRAIN_EVALUATOR_MODE']) vi.stubEnv(key, '');
    const transport = createProductionExecutionTransport({ env: { ...configured, DB_NAME: 'cecelia_test' } });
    await expect(transport.prepare(input)).rejects.toMatchObject({ code: 'EXECUTION_RUNTIME_ISOLATED' });
    expect(worker.prepare).not.toHaveBeenCalled();
  });
});
