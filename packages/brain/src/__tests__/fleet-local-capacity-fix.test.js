/**
 * 本机容量三层失真修复 — 回归测试（永久保留在 CI）
 *
 * 复现 run 8783807c 实证：us-mac-m4（真实 10 核 / 16GB / 空载）被算成
 * physical=2 / effective=1，proposer(权重2) 得 floor(1/2)=0，spawn 卡
 * all_execution_targets_exhausted 25 分钟。三层根因：
 *   ① collectLocalStats 在容器 cgroup 视角下采集失真（os.totalmem≈5GB）→ physical 触底兜底 2；
 *   ② macOS 上 pressure 用 free% 推断（缓存吃满内存 → 恒 0.3-0.4）→ effective 永久折半；
 *   ③ getRoleCapacity 用 Math.floor(base/weight)，effective=1 + 权重2 → 永久归零死区。
 *
 * 禁 mock 边（CONTRACT IS LAW）：本文件真调 calculatePhysicalCapacity /
 * resolveMemPressureRatio / getRoleCapacity / collectLocalStats 本体，只注入
 * 最外层输入（hostResources / kernelLevel / memUsagePercent），不 mock 被改的边。
 */
import { describe, it, expect } from 'vitest';
import { calculatePhysicalCapacity, resolveMemPressureRatio } from '../platform-utils.js';
import { collectLocalStats } from '../routes/infra-status.js';
import { getRoleCapacity } from '../orchestrator/fleet-node/node-profile.js';

describe('本机容量三层失真修复 [BEHAVIOR]', () => {
  // ── 根因① collectLocalStats 采集真实主机资源（不再被容器 cgroup 触底）──
  describe('① collectLocalStats 主机资源采集', () => {
    it('注入主机级资源(10核/16384MB) collectLocalStats 反映真实资源', () => {
      const stats = collectLocalStats({ hostResources: { cpuCores: 10, totalMemMB: 16384 } });
      expect(stats.cpu.cores).toBe(10);
      expect(Math.round(stats.memory.totalGB)).toBe(16);
    });

    it('主机级 stats 推导 physical ≥ 8（不再触发下限兜底 2）', () => {
      const stats = collectLocalStats({ hostResources: { cpuCores: 10, totalMemMB: 16384 } });
      const totalMemMB = Math.round(stats.memory.totalGB * 1024);
      expect(calculatePhysicalCapacity(totalMemMB, stats.cpu.cores, 400, 0.5)).toBeGreaterThanOrEqual(8);
    });

    it('calculatePhysicalCapacity(16384,10) ≥ 8（公式回归守卫）', () => {
      expect(calculatePhysicalCapacity(16384, 10, 400, 0.5)).toBeGreaterThanOrEqual(8);
    });
  });

  // ── 根因② macOS pressure 用内核自评等级映射，darwin free% 不再参与 ──
  describe('② macOS 内核 pressure 映射', () => {
    it.each([
      [0, 0],
      [1, 0.3],
      [2, 0.7],
      [3, 1],
    ])('darwin 内核等级 %i → pressure ratio %f', (level, ratio) => {
      expect(
        resolveMemPressureRatio({ platform: 'darwin', kernelLevel: level, memUsagePercent: 90 }),
      ).toBeCloseTo(ratio, 5);
    });

    it('darwin 有有效内核等级时 free%/usagePercent 不参与（level=0 且 usage=90 → 0）', () => {
      expect(
        resolveMemPressureRatio({ platform: 'darwin', kernelLevel: 0, memUsagePercent: 90 }),
      ).toBe(0);
    });

    it('darwin 内核读取失败(-1) 明确 fallback 到 usagePercent，不静默当 0 造成过派', () => {
      expect(
        resolveMemPressureRatio({ platform: 'darwin', kernelLevel: -1, memUsagePercent: 90 }),
      ).toBeCloseTo(0.9, 5);
    });

    it('非 darwin（Linux 远端）走既有 usagePercent 路径，行为不变', () => {
      expect(
        resolveMemPressureRatio({ platform: 'linux', kernelLevel: -1, memUsagePercent: 50 }),
      ).toBeCloseTo(0.5, 5);
    });
  });

  // ── 根因③ effective≥1 时角色分配保底，drained/offline(0) 仍不可派 ──
  describe('③ 角色分配保底消灭 floor 归零死区', () => {
    it('effective=1 proposer(权重2) available ≥ 1（死区消灭）', () => {
      expect(getRoleCapacity({ baseCapacity: 1, role: 'proposer' }).capacity).toBeGreaterThanOrEqual(1);
    });

    it('effective=2 generator(权重4) available ≥ 1（死区消灭）', () => {
      expect(getRoleCapacity({ baseCapacity: 2, role: 'generator' }).capacity).toBeGreaterThanOrEqual(1);
    });

    it('drained/offline effective=0 → proposer capacity=0（manual override 语义不回退）', () => {
      expect(getRoleCapacity({ baseCapacity: 0, role: 'proposer' }).capacity).toBe(0);
    });

    it('drained/offline effective=0 → generator capacity=0（不可派语义保留）', () => {
      expect(getRoleCapacity({ baseCapacity: 0, role: 'generator' }).capacity).toBe(0);
    });

    it('权重1角色不受保底影响 commander effective=3 → 3', () => {
      expect(getRoleCapacity({ baseCapacity: 3, role: 'commander' }).capacity).toBe(3);
    });

    it('保底不破坏大 base 的正常分配 generator(权重4) effective=8 → 2', () => {
      expect(getRoleCapacity({ baseCapacity: 8, role: 'generator' }).capacity).toBe(2);
    });
  });
});
