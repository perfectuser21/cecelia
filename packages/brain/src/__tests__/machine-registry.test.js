// packages/brain/src/__tests__/machine-registry.test.js
import { describe, it, expect } from 'vitest';
import {
  MACHINE_ROLES, MACHINES,
  resolvePrimaryWorkerId, isPrimaryWorker,
  listComputeWorkerIds, workerBridgeUrlFor,
} from '../machine-registry.js';

describe('machine-registry（角色模型 SSOT）', () => {
  it('恰好一台 primary（0 台或多台都是配置错误）', () => {
    const primaries = MACHINES.filter((m) => m.machineRole === MACHINE_ROLES.PRIMARY);
    expect(primaries).toHaveLength(1);
  });

  it('当前 primary 解析为 us-mac-m4（Mac Studio 到货后此断言随清单更新）', () => {
    expect(resolvePrimaryWorkerId()).toBe('us-mac-m4');
    expect(isPrimaryWorker('us-mac-m4')).toBe(true);
    expect(isPrimaryWorker('us-vps')).toBe(false);
    expect(isPrimaryWorker(undefined)).toBe(false);
  });

  it('compute workers = primary + secondary，与旧 COMPUTE_SERVERS 完全一致', () => {
    expect(listComputeWorkerIds().sort()).toEqual(
      ['us-mac-m4', 'xian-mac-m1', 'xian-mac-m4'].sort(),
    );
  });

  it('bridge url：env 覆盖优先，否则 tailscaleIp:5231', () => {
    expect(workerBridgeUrlFor('us-mac-m4', { FLEET_WORKER_US_MAC_M4_URL: 'http://override:5231' }))
      .toBe('http://override:5231');
    expect(workerBridgeUrlFor('us-mac-m4', {})).toBe('http://100.71.151.105:5231');
    expect(workerBridgeUrlFor('nonexistent', {})).toBeNull();
  });

  it('scheduler 不是 compute worker', () => {
    expect(listComputeWorkerIds()).not.toContain('us-vps');
  });
});
