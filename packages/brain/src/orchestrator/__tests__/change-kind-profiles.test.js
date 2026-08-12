import { describe, expect, it } from 'vitest';
import { selectPipeline } from '../../work-router.js';

describe('four-form profiles', () => {
  it('keeps evaluator and judge in every coding profile', () => {
    for (const change_kind of ['new_capability','capability_change','bugfix','parameter_only']) {
      const route = selectPipeline({ work_kind: 'coding_mutation', change_kind });
      expect(route.impact_contract_required).toBe(true);
      expect(route.orchestrator).toBe('kernel-harness-v2');
    }
  });
});
