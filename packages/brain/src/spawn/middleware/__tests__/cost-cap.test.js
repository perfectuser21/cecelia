import { describe, it, expect } from 'vitest';
import { checkCostCap, CostCapExceededError } from '../cost-cap.js';

describe('checkCostCap()', () => {
  it('passes when no getBudget deps', async () => {
    await expect(checkCostCap({ task: { task_type: 'dev' } }, {})).resolves.toBeUndefined();
  });

  it('passes when budget not exceeded', async () => {
    const deps = { getBudget: async () => ({ usd: 10, usage_usd: 5 }) };
    await expect(checkCostCap({ task: { task_type: 'dev' } }, { deps })).resolves.toBeUndefined();
  });

  it('throws CostCapExceededError when usage >= budget', async () => {
    const deps = { getBudget: async () => ({ usd: 10, usage_usd: 10 }) };
    await expect(checkCostCap({ task: { task_type: 'dev' } }, { deps }))
      .rejects.toThrow(CostCapExceededError);
  });

  it('passes when budget is null from deps', async () => {
    const deps = { getBudget: async () => null };
    await expect(checkCostCap({ task: { task_type: 'dev' } }, { deps })).resolves.toBeUndefined();
  });

  it('passes when task_type missing', async () => {
    const deps = { getBudget: async () => ({ usd: 1, usage_usd: 100 }) };
    await expect(checkCostCap({ task: {} }, { deps })).resolves.toBeUndefined();
  });
});
