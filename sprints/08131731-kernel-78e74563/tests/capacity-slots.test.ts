// TDD Red — 本机容量三层失真修复
// 覆盖父路: 独立小路（无父路）—— 修复 kernel 容量核算，无既有 golden_path step 锚点
//
// 三层根因对应：
//   ① 本机 stats 采集失真 → calculatePhysicalCapacity 命中 Math.max(raw,2) 下限兜底
//   ② macOS pressure 用 free% 反推恒 0.3-0.4 → effective 永久折半（kernel 自评未接线）
//   ③ 角色权重 2 + effective=1 → floor(1/2)=0 永久归零死区
//
// 说明：① 的真实红证据在部署后 curl capacity-budget（us-mac-m4 physical=2，见 DoD B-06，
//        真机接缝）；本文件的 ① 单测是"真实 16GB/10核 stats → 公式产 ≥8"的回归守卫，
//        证明公式本身正确、bug 在采集侧（取证结论）。
import { describe, it, expect } from 'vitest';
import {
  calculatePhysicalCapacity,
  macPressureLevelToRatio,
} from '../../../packages/brain/src/platform-utils.js';
import { getRoleCapacity } from '../../../packages/brain/src/orchestrator/fleet-node/node-profile.js';

describe('层③ 角色权重折算保底：floor 归零死区消灭 [BEHAVIOR]', () => {
  it('getRoleCapacity proposer(权重2) baseCapacity=1 返回 capacity>=1', () => {
    // 现状：floor(1/2)=0（死区）。修复后：effective>=1 → 至少 1 槽。
    expect(getRoleCapacity({ baseCapacity: 1, role: 'proposer' }).capacity).toBeGreaterThanOrEqual(1);
  });

  it('getRoleCapacity generator(权重4) baseCapacity=1..3 均返回 capacity>=1', () => {
    for (const base of [1, 2, 3]) {
      expect(getRoleCapacity({ baseCapacity: base, role: 'generator' }).capacity).toBeGreaterThanOrEqual(1);
    }
  });

  it('保底不回退不变量：baseCapacity=0（drained/offline/effective=0）仍返回 capacity=0', () => {
    // [manual不回退] 铁律：容量保底不得复活 effective=0 机器。
    expect(getRoleCapacity({ baseCapacity: 0, role: 'proposer' }).capacity).toBe(0);
    expect(getRoleCapacity({ baseCapacity: 0, role: 'generator' }).capacity).toBe(0);
  });

  it('回归守卫：baseCapacity=8 权重折算不变（proposer=4）', () => {
    expect(getRoleCapacity({ baseCapacity: 8, role: 'proposer' }).capacity).toBe(4);
  });
});

describe('层② macOS pressure 内核自评等级映射 [BEHAVIOR]', () => {
  it('映射表 0→0 / 1→0.3 / 2→0.7 / 3→1', () => {
    expect(macPressureLevelToRatio(0)).toBe(0);
    expect(macPressureLevelToRatio(1)).toBeCloseTo(0.3, 5);
    expect(macPressureLevelToRatio(2)).toBeCloseTo(0.7, 5);
    expect(macPressureLevelToRatio(3)).toBe(1);
  });

  it('kernel 不可用（level=-1）返回 null，触发既有 used_ratio 回退（darwin 上 free% 仅此时参与）', () => {
    expect(macPressureLevelToRatio(-1)).toBeNull();
    expect(macPressureLevelToRatio(99)).toBeNull();
  });
});

describe('层① 真实本机 stats → 物理容量守卫 [BEHAVIOR]', () => {
  it('calculatePhysicalCapacity(16384,10,400,0.5) 返回 >=8（真 16GB/10核 不命中下限兜底 2）', () => {
    // 取证：本机 collectLocalStats 若返回真实 16384MB/10核，公式产 16；
    // 现网 physical=2 源于采集返回 ~5GB/6核（见 DoD B-06 真机接缝）。
    expect(calculatePhysicalCapacity(16384, 10, 400, 0.5)).toBeGreaterThanOrEqual(8);
  });
});
