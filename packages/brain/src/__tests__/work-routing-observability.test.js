import { describe, expect, it } from 'vitest';
import { summarizeWorkRouting } from '../work-routing-observability.js';

describe('work routing observability', () => {
  it('reports receipt coverage, direct dev and legacy exemptions', () => {
    expect(summarizeWorkRouting({ coding: 3, receipts: 3, directDev: 0, legacyExempt: 0 })).toEqual({ coding_receipt_coverage: 1, coding_dev_direct: 0, legacy_exempt: 0 });
  });
});
