import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('Generator trust boundary [BEHAVIOR]', () => {
  it('Generator 不持有 push callback lease 凭据', async () => {
    const output = execFileSync('bash', ['docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'], { encoding: 'utf8', env: { ...process.env, HARNESS_TRUST_BOUNDARY_ASSERT_MODE: 'contract' } });
    expect(output).toContain('GENERATOR_PUSH_BLOCKED');
    expect(output).toContain('GENERATOR_CALLBACK_ENV_ABSENT');
    expect(output).toContain('GENERATOR_CAPABILITIES_EMPTY');
    expect(output).toContain('TRUSTED_TRANSPORT_PUBLISHED');
  });
});
