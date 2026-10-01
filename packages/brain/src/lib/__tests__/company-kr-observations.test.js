import { describe, expect, it, vi } from 'vitest';
import { observeCompanyKr } from '../company-kr-observations.js';

describe('公司测量必须有任务与证据', () => {
  it('无证据或无task_id零写', async () => {
    const pool = { connect: vi.fn() };
    await expect(observeCompanyKr(pool, 'kr', { current_value: 0 })).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('拒绝缺少source/fact的证据，即使有值0', async () => {
    const pool = { connect: vi.fn() };
    await expect(observeCompanyKr(pool, 'kr', { task_id: 'task', actor: 'manager', current_value: 0, observed_at: '2026-10-01T00:00:00Z', evidence: [{}] })).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
