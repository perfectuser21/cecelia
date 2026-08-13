import { describe, it, expect } from 'vitest';

// TDD Red — 本 sprint 起草时以下导出/行为尚不存在或未修复，预期红。
// 路径相对 sprints/08131731-kernel-78e74563/tests/ → packages/brain/src
const CACHE = '../../../packages/brain/src/fleet-resource-cache.js';
const PLATFORM = '../../../packages/brain/src/platform-utils.js';
const NODE_PROFILE = '../../../packages/brain/src/orchestrator/fleet-node/node-profile.js';
const PROBES = '../../../packages/brain/src/orchestrator/preflight/production-probes.js';

describe('kernel 容量三层失真 [BEHAVIOR]', () => {
  it('computeCapacityFromStats 10 核 16384MB physical>=8 effective>=4', async () => {
    const { computeCapacityFromStats } = await import(CACHE);
    const r = computeCapacityFromStats(
      { platform: 'Darwin arm64', cpu: { cores: 10, usagePercent: 24 }, memory: { totalGB: 16, usedGB: 6, usagePercent: 43 } },
      { macPressureLevel: 0 },
    );
    expect(r.physicalCapacity).toBeGreaterThanOrEqual(8);
    expect(r.effectiveSlots).toBeGreaterThanOrEqual(4);
  });

  it('macOSPressureLevelToFraction 0 1 2 3 精确映射', async () => {
    const { macOSPressureLevelToFraction } = await import(PLATFORM);
    expect(macOSPressureLevelToFraction(0)).toBe(0);
    expect(macOSPressureLevelToFraction(1)).toBe(0.3);
    expect(macOSPressureLevelToFraction(2)).toBe(0.7);
    expect(macOSPressureLevelToFraction(3)).toBe(1);
    expect(macOSPressureLevelToFraction(9)).toBe(-1);
  });

  it('darwin 用内核 level 不用 free% level -1 回退', async () => {
    const { computeCapacityFromStats } = await import(CACHE);
    const stats = { platform: 'Darwin arm64', cpu: { cores: 10, usagePercent: 10 }, memory: { totalGB: 16, usedGB: 14, usagePercent: 90 } };
    // 内核 level=2 → 0.7（不采 free%-derived 的 0.9）
    expect(computeCapacityFromStats(stats, { macPressureLevel: 2 }).pressure).toBeCloseTo(0.7, 9);
    // level=-1（sysctl 失败/非 darwin）→ 回退 used_ratio 0.9，不崩溃
    expect(computeCapacityFromStats(stats, { macPressureLevel: -1 }).pressure).toBeCloseTo(0.9, 9);
  });

  it('getRoleCapacity proposer base 1 available >= 1', async () => {
    const { getRoleCapacity } = await import(NODE_PROFILE);
    expect(getRoleCapacity({ baseCapacity: 1, role: 'proposer' }).capacity).toBeGreaterThanOrEqual(1);
    // drained 不复活；重角色门控保留
    expect(getRoleCapacity({ baseCapacity: 0, role: 'proposer' }).capacity).toBe(0);
    expect(getRoleCapacity({ baseCapacity: 3, role: 'generator' }).capacity).toBe(0);
  });

  it('getMachineCapacity effective 1 proposer available >= 1', async () => {
    const { createProductionCapabilityProbes } = await import(PROBES);
    const mk = (fleet: unknown[]) => createProductionCapabilityProbes({
      pool: { query: async () => ({ rows: [] }) },
      registry: { get: () => undefined },
      fetchFn: async () => new Response(JSON.stringify({ fleet }), { status: 200, headers: { 'content-type': 'application/json' } }),
      env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      nodeAdmissionClient: { getAdmission: async () => ({ state: 'base_admitted', base_admitted: true, dispatch_ready: true, reasons: [] }) },
    });
    const a = await mk([{ id: 'us-mac-m4', online: true, effective_slots: 1, physical_capacity: 8, pressure: 0 }])
      .getMachineCapacity({ machine: 'us-mac-m4', task_bundle: { role: 'proposer' } });
    expect(a.available).toBeGreaterThanOrEqual(1);
    const b = await mk([{ id: 'us-mac-m4', online: true, effective_slots: 0, physical_capacity: 0, pressure: 1 }])
      .getMachineCapacity({ machine: 'us-mac-m4', task_bundle: { role: 'proposer', inputs: { manual_dispatch: true } } });
    expect(b.available).toBe(0);
  });
});
