import { describe, expect, it } from 'vitest';
import { assertMapImpactContract } from './map-impact-contract.js';

describe('Map Impact Contract preflight', () => {
  it('accepts only fresh same-repo same-revision contracts', () => {
    const input = { repo: 'perfectuser21/cecelia', base_sha: 'abc', map: { repo: 'perfectuser21/cecelia', freshness: 'fresh', source_revision: 'abc', scanner_valid: true }, impact_contract: { status: 'active', source_revision: 'abc' } };
    expect(assertMapImpactContract(input)).toMatchObject({ impact_contract_policy: 'required' });
    expect(() => assertMapImpactContract({ ...input, map: { ...input.map, freshness: 'stale' } })).toThrow('map_stale');
    expect(() => assertMapImpactContract({ ...input, impact_contract: null })).toThrow('impact_contract_missing');
  });
});
