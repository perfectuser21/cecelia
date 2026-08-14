import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL(
  '../../../scripts/smoke/unified-work-router-role-chain-smoke.sh',
  import.meta.url,
));
const denylist = fileURLToPath(new URL(
  '../../../../quality/smoke-denylist.txt',
  import.meta.url,
));
describe('unified work router role-chain smoke CI contract', () => {
  it('requires an explicit real Harness opt-in outside the generic smoke job', () => {
    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SKIP: real Harness role chain requires explicit opt-in');
    expect(result.stderr).toBe('');
  });

  it('registers the external-worker smoke in the ratchet denylist', () => {
    expect(readFileSync(denylist, 'utf8'))
      .toMatch(/^unified-work-router-role-chain-smoke\.sh$/m);
  });

  it('accepts the opt-in only from the execution environment', () => {
    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HARNESS_ROLE_CHAIN_ENABLED: '1',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('SKIP:');
    expect(result.stderr).toContain('DB_URL is required');
  });
});
