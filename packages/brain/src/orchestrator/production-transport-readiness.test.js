import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { describeFleetTransportReadiness } from './production-transport.js';

// 2026-08-16 09:38Z 生产实证：Brain 容器被不带 --env-file 的 compose 重建后
// KERNEL_FLEET_BRIDGE_TOKEN 为空 → production-transport fail-closed →
// evaluator callback 503 无限重试 → run 48d57838 controller lease 过期判死。
// 该缺陷此前只在第一次 attempt 用到 transport 时才暴露；必须在启动/健康面可见。
describe('describeFleetTransportReadiness (fleet bridge token 启动自检)', () => {
  const base = {
    KERNEL_FLEET_REMOTE_ENABLED: 'true',
    FLEET_WORKER_US_MAC_M4_URL: 'http://host.docker.internal:5231',
    KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'http://100.71.151.105:5221',
  };

  it('enabled + 合法共享密钥 → ready', () => {
    const r = describeFleetTransportReadiness({
      ...base,
      KERNEL_FLEET_BRIDGE_TOKEN: 'x'.repeat(64),
    });
    expect(r.enabled).toBe(true);
    expect(r.status).toBe('ready');
    expect(r.shared_secret_configured).toBe(true);
    expect(r.reason).toBeNull();
    // 绝不回显密钥
    expect(JSON.stringify(r)).not.toContain('x'.repeat(32));
  });

  it('enabled + 密钥为空 → unavailable:shared_secret_missing', () => {
    const r = describeFleetTransportReadiness({ ...base, KERNEL_FLEET_BRIDGE_TOKEN: '' });
    expect(r.status).toBe('unavailable');
    expect(r.shared_secret_configured).toBe(false);
    expect(r.reason).toBe('shared_secret_missing');
  });

  it('enabled + 密钥不足 32 字符 → unavailable:shared_secret_too_short', () => {
    const r = describeFleetTransportReadiness({ ...base, KERNEL_FLEET_BRIDGE_TOKEN: 'short-token' });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('shared_secret_too_short');
  });

  it('未启用远端 transport → disabled（不判 degraded）', () => {
    const r = describeFleetTransportReadiness({ KERNEL_FLEET_REMOTE_ENABLED: 'false' });
    expect(r.enabled).toBe(false);
    expect(r.status).toBe('disabled');
  });

  it('enabled + 缺 worker URL → unavailable:worker_urls_missing', () => {
    const r = describeFleetTransportReadiness({
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      KERNEL_FLEET_BRIDGE_TOKEN: 'x'.repeat(64),
    });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('worker_urls_missing');
  });
});

describe('/health 暴露 fleet_transport 就绪态', () => {
  const SRC = readFileSync(new URL('../routes/goals.js', import.meta.url), 'utf8');
  it('handler 响应体含 fleet_transport，且 enabled+unavailable 参与 degraded 聚合', () => {
    const start = SRC.indexOf("router.get('/health'");
    expect(start).toBeGreaterThan(-1);
    const next = SRC.indexOf('router.', start + 20);
    const block = SRC.slice(start, next === -1 ? SRC.length : next);
    expect(block).toMatch(/fleet_transport/);
    expect(block).toMatch(/fleetTransportDegraded/);
  });
});
