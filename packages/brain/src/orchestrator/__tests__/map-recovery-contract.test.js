import { describe, expect, it } from 'vitest';
import { assertMapRecoveryContract } from '../preflight/map-impact-contract.js';

describe('map recovery contract', () => {
  it('is narrow, unexpired, bugfix-only and single-attempt', () => {
    const valid = { change_kind: 'bugfix', reason_code: 'map_unavailable', expires_at: new Date(Date.now()+60000).toISOString(), attempt_id: null };
    expect(assertMapRecoveryContract(valid)).toBe(true);
    expect(() => assertMapRecoveryContract({ ...valid, change_kind: 'new_capability' })).toThrow('map_recovery_forbidden');
    expect(() => assertMapRecoveryContract({ ...valid, attempt_id: 'used' })).toThrow('map_recovery_consumed');
  });
});
