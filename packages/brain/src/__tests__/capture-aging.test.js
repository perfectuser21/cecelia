/**
 * capture-aging.js 配对测试
 * 覆盖 FR-7: 账龄哨兵基础行为
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCaptureAging, __resetCaptureAgingForTest } from '../capture-aging.js';

describe('capture-aging: runCaptureAging', () => {
  beforeEach(() => { __resetCaptureAgingForTest(); });

  it('是一个可调用的异步函数', () => {
    expect(typeof runCaptureAging).toBe('function');
    expect(runCaptureAging.constructor.name).toBe('AsyncFunction');
  });

  it('使用空池调用不抛出（处理 0 条记录）', async () => {
    const mockPool = {
      query: async () => ({ rows: [] }),
    };
    let threw = false;
    try {
      await runCaptureAging(mockPool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  // ─── F6修复 防积压回归测试（永久保留在 CI）────────────────────────────────────
  // 根因：no_journey/low_confidence/gate_fail 标记的原子误留 pending_review，
  // 需由 aging 步骤兜底清零（任务 96a00f17，决策 efa578b8 + 4c595c84）。

  it('[F6修复-回归] aging step5 必须清零 no_journey/low_confidence/gate_fail stuck atoms', async () => {
    const parkedIds = [];
    const mockPool = {
      query: async (sql) => {
        // 步骤 5：UPDATE pending_review WHERE ai_reason LIKE '[triage:no_journey|low_confidence|gate_fail]...'
        if (
          /UPDATE capture_atoms/.test(sql) &&
          /\[triage:no_journey/.test(sql) &&
          /\[triage:low_confidence/.test(sql) &&
          /\[triage:gate_fail/.test(sql)
        ) {
          parkedIds.push('stub-1', 'stub-2');
          return { rows: [{ id: 'stub-1' }, { id: 'stub-2' }] };
        }
        return { rows: [] };
      },
    };
    const result = await runCaptureAging(mockPool);
    expect(result.stuck_parked).toBe(2);
    expect(parkedIds).toHaveLength(2);
  });

  it('[F6修复-回归] aging step5 结果 stuck_parked 在返回值中存在', async () => {
    const mockPool = { query: async () => ({ rows: [] }) };
    const result = await runCaptureAging(mockPool);
    expect(result).toHaveProperty('stuck_parked');
    expect(typeof result.stuck_parked).toBe('number');
  });
});
