import { describe, expect, it } from 'vitest';
import { __test__ } from '../release-run-e2e-registry.js';

describe('ReleaseRun server-owned E2E probe registry', () => {
  it('allows staging probes only on loopback or isolated service origins', () => {
    expect(__test__.canonicalOrigin('http://localhost:5222', 'staging'))
      .toBe('http://localhost:5222');
    expect(__test__.canonicalOrigin('http://brain-staging:5222', 'staging'))
      .toBe('http://brain-staging:5222');
    expect(() => __test__.canonicalOrigin(
      'http://169.254.169.254/latest/meta-data',
      'staging',
    )).toThrow(/origin/);
    expect(() => __test__.canonicalOrigin(
      'http://private.example.test:5222',
      'staging',
    )).toThrow('release_e2e_probe_staging_origin_denied');
  });

  it('rejects oversized probe bodies before parsing JSON', async () => {
    const text = async () => JSON.stringify({ data: 'x' });
    await expect(__test__.readBoundedJson({
      headers: {
        get: () => String(__test__.MAX_PROBE_RESPONSE_BYTES + 1),
      },
      text,
    })).rejects.toThrow('release_e2e_probe_response_too_large');
  });
});
