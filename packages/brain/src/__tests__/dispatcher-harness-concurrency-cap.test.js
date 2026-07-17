// 主线A（收权）：in_progress 任务数不再是判定依据；判定走 harnessSlotCheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../slot-allocator.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, harnessSlotCheck: vi.fn(), calculateSlotBudget: vi.fn() };
});

import { shouldApplyHarnessCap, HARNESS_TASK_CAP_BACKSTOP } from '../dispatcher.js';

describe('harness cap 收权后语义（beeba317）', () => {
  it('MAX_CONCURRENT_HARNESS_INITIATIVES 已删除', async () => {
    const mod = await import('../dispatcher.js');
    expect(mod.MAX_CONCURRENT_HARNESS_INITIATIVES).toBeUndefined();
    expect(mod.harnessConcurrencyExceeded).toBeUndefined();
  });

  it('TASK_CAP 兜底常量 = 12', () => {
    expect(HARNESS_TASK_CAP_BACKSTOP).toBe(12);
  });

  it('shouldApplyHarnessCap 语义不变：harness_initiative 受控', () => {
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative' })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'golden_path_proposal' })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'dev' })).toBe(false);
  });

  it('resume 豁免语义不变（回归：OPEN-2 自愈锁死案）', () => {
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative', payload: { resume_from_checkpoint: true } })).toBe(false);
  });
});
