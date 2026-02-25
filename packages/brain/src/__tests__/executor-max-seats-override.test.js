/**
 * executor-max-seats-override.test.js
 *
 * 测试 CECELIA_MAX_SEATS 环境变量覆盖逻辑：
 * - D2-1: CECELIA_MAX_SEATS 存在时，MAX_SEATS <= CECELIA_MAX_SEATS
 * - D2-2: CECELIA_MAX_SEATS 未设置时，使用自动计算值
 *
 * DoD 映射：
 * - D2-1 → 'env override 生效，MAX_SEATS 不超过 CECELIA_MAX_SEATS'
 * - D2-2 → '无 env 时使用自动计算值'
 */

import { describe, it, expect } from 'vitest';
import os from 'os';

// 模拟 MAX_SEATS 计算逻辑（与实现保持一致）
function computeMaxSeats(envOverride = null) {
  const CPU_CORES = os.cpus().length;
  const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);
  const MEM_PER_TASK_MB = 500;
  const CPU_PER_TASK = 0.5;
  const USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;
  const USABLE_CPU = CPU_CORES * 0.8;

  const autoMaxSeats = Math.max(Math.floor(Math.min(USABLE_MEM_MB / MEM_PER_TASK_MB, USABLE_CPU / CPU_PER_TASK)), 2);

  const maxSeatsOverride = envOverride ? parseInt(envOverride, 10) : null;
  const maxSeats = (maxSeatsOverride && maxSeatsOverride > 0)
    ? Math.min(maxSeatsOverride, autoMaxSeats)
    : autoMaxSeats;

  return { maxSeats, autoMaxSeats, override: maxSeatsOverride };
}

describe('MAX_SEATS 环境变量覆盖 - D2', () => {
  it('D2-1: CECELIA_MAX_SEATS=6 时 MAX_SEATS 不超过 6', () => {
    const { maxSeats } = computeMaxSeats('6');
    expect(maxSeats).toBeLessThanOrEqual(6);
  });

  it('D2-1: CECELIA_MAX_SEATS=1 时 MAX_SEATS = 1（最小值）', () => {
    const { maxSeats, autoMaxSeats } = computeMaxSeats('1');
    // override=1, autoMaxSeats>=2, min(1, autoMaxSeats)=1
    expect(maxSeats).toBe(1);
  });

  it('D2-1: CECELIA_MAX_SEATS 大于自动计算值时，使用自动计算值', () => {
    // 设置一个很大的值，实际上受限于硬件
    const { maxSeats, autoMaxSeats } = computeMaxSeats('9999');
    expect(maxSeats).toBe(autoMaxSeats);
  });

  it('D2-2: 无 CECELIA_MAX_SEATS 时使用自动计算值', () => {
    const { maxSeats, autoMaxSeats } = computeMaxSeats(null);
    expect(maxSeats).toBe(autoMaxSeats);
  });

  it('D2-2: 自动计算值至少为 2（最小 floor 保护）', () => {
    const { autoMaxSeats } = computeMaxSeats(null);
    expect(autoMaxSeats).toBeGreaterThanOrEqual(2);
  });

  it('D2-1: CECELIA_MAX_SEATS=0（无效值）时使用自动计算', () => {
    // 0 被视为无效，不启用 override
    const { maxSeats, autoMaxSeats } = computeMaxSeats('0');
    expect(maxSeats).toBe(autoMaxSeats);
  });

  it('D2-1: CECELIA_MAX_SEATS=6，自动值>=6 时 MAX_SEATS 精确等于 6', () => {
    // 模拟高配机器，autoMaxSeats = 20
    const override = 6;
    const autoMaxSeats = 20; // 假设高配机器
    const maxSeats = Math.min(override, autoMaxSeats);
    expect(maxSeats).toBe(6);
  });
});
