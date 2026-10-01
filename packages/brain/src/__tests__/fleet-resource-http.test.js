import http from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const endpoint = vi.hoisted(() => ({ url: '' }));
vi.mock('../routes/infra-status.js', () => ({
  SERVERS: [{ id: 'us-mac-m4', role: 'worker' }], COMPUTE_SERVERS: ['us-mac-m4'],
}));
vi.mock('../machine-registry.js', () => ({ workerBridgeUrlFor: () => endpoint.url }));
// 保留真实fetch、资源解析、物理容量公式及缓存读取。
import { getFleetStatus, getTotalEffectiveSlots, startFleetRefresh, stopFleetRefresh } from '../fleet-resource-cache.js';

describe('真实HTTP资源报告进入派单容量', () => {
  let server;
  afterEach(async () => {
    stopFleetRefresh();
    if (server) await new Promise(resolve => server.close(resolve));
  });
  it('健康响应有容量，原地址改回传过期样本后容量归零并说明原因', async () => {
    let observedAt = new Date().toISOString();
    let requests = 0;
    server = http.createServer((req, res) => {
      expect(req.url).toBe('/health');
      requests += 1;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        schema_version: 'fleet-node-health/v1', machine_id: 'us-mac-m4', observed_at: observedAt,
        resources: {
          cpu_cores: 10, memory_bytes: 16 * 1024 ** 3,
          cpu_pressure_percent: 20, memory_pressure_percent: 40,
          disk_free_bytes: 40 * 1024 ** 3, disk_used_percent: 60,
        },
      }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    endpoint.url = `http://127.0.0.1:${server.address().port}`;
    startFleetRefresh();
    await vi.waitFor(() => expect(getFleetStatus()[0]?.online).toBe(true));
    expect(getTotalEffectiveSlots()).toBeGreaterThan(0);
    expect(getFleetStatus()[0].observed_at).toBe(observedAt);
    stopFleetRefresh();
    observedAt = new Date(Date.now() - 120_000).toISOString();
    startFleetRefresh();
    await vi.waitFor(() => expect(getFleetStatus()[0]?.admission_reason).toBe('worker_health_stale'));
    expect(requests).toBe(2);
    expect(getTotalEffectiveSlots()).toBe(0);
  });
});
