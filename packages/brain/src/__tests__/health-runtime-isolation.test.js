import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { isIsolatedRuntime } from '../runtime-safety.js';

// Execute the actual route handler without importing the server/module graph or
// starting background loops. Every I/O boundary is injected; the runtime guard is real.
const source = readFileSync(new URL('../routes/goals.js', import.meta.url), 'utf8');
const start = source.indexOf("router.get('/health',");
const end = source.indexOf('\n/**', start);
const healthSource = source.slice(start, end);

function harness(env = { NODE_ENV: 'test' }) {
  const deps = {
    pool: { query: vi.fn(async sql => ({ rows: [sql.includes('harness_initiative')
      ? { cnt: 2 }
      : { passed: 3, failed: 1, last_run_at: null }] })) },
    getTickStatus: vi.fn().mockResolvedValue({ loop_running: false, enabled: false, max_concurrent: 3 }),
    getAllCBStates: vi.fn(() => ({})),
    dockerRuntimeProbe: vi.fn().mockResolvedValue({ enabled: true, status: 'healthy', reachable: true, version: 'mock', error: null }),
    checkXianBridgeHealth: vi.fn().mockResolvedValue('online'),
    describeFleetTransportReadiness: vi.fn(() => ({ enabled: true, status: 'ready', reason: null, shared_secret_configured: true, worker_machines: ['mock-worker'] })),
  };
  let handler;
  vm.runInNewContext(healthSource, {
    ...deps,
    router: { get: (path, fn) => { expect(path).toBe('/health'); handler = fn; } },
    isIsolatedRuntime: () => isIsolatedRuntime(env),
    process: { env, uptime: () => 100.5 },
    pkg: { version: 'test-version' },
  }, { filename: 'goals.js:/health' });
  return {
    ...deps,
    async request() {
      const response = { statusCode: 200, body: null };
      const res = {
        status: code => { response.statusCode = code; return res; },
        json: body => { response.body = body; return res; },
      };
      await handler({}, res);
      return response;
    },
  };
}

describe('GET /health runtime isolation', () => {
  it.each([
    { NODE_ENV: 'test' },
    { NODE_ENV: 'development' },
    { VITEST: 'true' },
    { BRAIN_PREVIEW: '1' },
    { BRAIN_EVALUATOR_MODE: 'true' },
    { NODE_ENV: 'production', DB_NAME: 'cecelia_test' },
    { NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/cecelia_scratch' },
  ])('healthy passive API reports stopped automation for %j', async env => {
    const h = harness({ ...env, CECELIA_LOCAL_EXECUTION_ENABLED: 'true', KERNEL_FLEET_REMOTE_ENABLED: 'true', HARNESS_DOCKER_ENABLED: 'true' });
    const { statusCode, body } = await h.request();
    expect(statusCode).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.runtime).toEqual({ isolated: true, background_automation: false });
    expect(body.organs.scheduler).toMatchObject({ status: 'stopped', enabled: false });
    expect(body.local_execution).toMatchObject({ enabled: false, role: 'disabled', reason: 'runtime_isolated' });
    expect(body.docker_runtime).toMatchObject({ enabled: false, status: 'disabled', reachable: false, reason: 'runtime_isolated' });
    expect(body.xian_bridge_status).toBe('disabled');
    expect(body.fleet_transport).toMatchObject({ enabled: false, status: 'disabled', reason: 'runtime_isolated' });
    expect(body.active_pipelines).toBe(2);
    expect(body.evaluator_stats).toMatchObject({ total_runs: 4, passed: 3, failed: 1 });
    expect(h.pool.query).toHaveBeenCalledTimes(2);
    expect(h.dockerRuntimeProbe).not.toHaveBeenCalled();
    expect(h.checkXianBridgeHealth).not.toHaveBeenCalled();
    expect(h.describeFleetTransportReadiness).not.toHaveBeenCalled();
  });

  it('keeps open circuit breakers degraded in isolation', async () => {
    const h = harness();
    h.getAllCBStates.mockReturnValue({ model: { state: 'OPEN' } });
    const { body } = await h.request();
    expect(body.status).toBe('degraded');
    expect(body.organs.circuit_breaker).toMatchObject({ status: 'has_open', open: ['model'] });
  });

  it.each(['harness_initiative', 'harness_evaluate'])('reports DB failure in %s as an error in isolation', async taskType => {
    const h = harness();
    const healthyQuery = h.pool.query.getMockImplementation();
    h.pool.query.mockImplementation(sql => sql.includes(taskType)
      ? Promise.reject(new Error('database unavailable'))
      : healthyQuery(sql));
    const { statusCode, body } = await h.request();
    expect(statusCode).toBe(500);
    expect(body).toMatchObject({ status: 'error', error: 'database unavailable', runtime: { isolated: true, background_automation: false } });
    expect(h.dockerRuntimeProbe).not.toHaveBeenCalled();
    expect(h.checkXianBridgeHealth).not.toHaveBeenCalled();
  });

  it('production with a stopped tick remains degraded and runs external probes', async () => {
    const h = harness({ NODE_ENV: 'production' });
    const { body } = await h.request();
    expect(body.status).toBe('degraded');
    expect(body.runtime).toEqual({ isolated: false, background_automation: true });
    expect(body.organs.scheduler.status).toBe('stopped');
    expect(body.local_execution).toMatchObject({ enabled: true, role: 'executor' });
    expect(body.xian_bridge_status).toBe('online');
    expect(h.dockerRuntimeProbe).toHaveBeenCalledOnce();
    expect(h.checkXianBridgeHealth).toHaveBeenCalledOnce();
    expect(h.describeFleetTransportReadiness).toHaveBeenCalledOnce();
  });

  it('production with running tick stays healthy, including scheduler-only hosts', async () => {
    const h = harness({ NODE_ENV: 'production', CECELIA_LOCAL_EXECUTION_ENABLED: 'false' });
    h.getTickStatus.mockResolvedValue({ loop_running: true, enabled: true });
    const { body } = await h.request();
    expect(body.status).toBe('healthy');
    expect(body.organs.scheduler.status).toBe('running');
    expect(body.local_execution).toMatchObject({ enabled: false, role: 'scheduler_only' });
  });

  it.each(['docker', 'fleet', 'circuit_breaker'])('production %s failure still degrades health', async failure => {
    const h = harness({ NODE_ENV: 'production' });
    h.getTickStatus.mockResolvedValue({ loop_running: true, enabled: true });
    if (failure === 'docker') h.dockerRuntimeProbe.mockRejectedValue(new Error('docker unavailable'));
    if (failure === 'fleet') h.describeFleetTransportReadiness.mockReturnValue({ enabled: true, status: 'unavailable' });
    if (failure === 'circuit_breaker') h.getAllCBStates.mockReturnValue({ model: { state: 'OPEN' } });
    expect((await h.request()).body.status).toBe('degraded');
  });

  it('production evaluator statistics remain best-effort', async () => {
    const h = harness({ NODE_ENV: 'production' });
    h.getTickStatus.mockResolvedValue({ loop_running: true, enabled: true });
    h.pool.query.mockImplementation(sql => sql.includes('harness_evaluate')
      ? Promise.reject(new Error('optional evaluator statistics unavailable'))
      : Promise.resolve({ rows: [{ cnt: 0 }] }));
    const { statusCode, body } = await h.request();
    expect(statusCode).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.evaluator_stats.total_runs).toBe(0);
  });
});
