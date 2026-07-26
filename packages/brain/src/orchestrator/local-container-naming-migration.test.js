import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration363Path = fileURLToPath(
  new URL('../../migrations/363_kernel_fleet_execution_receipts.sql', import.meta.url),
);
const migration364Path = fileURLToPath(
  new URL('../../migrations/364_kernel_local_container_naming.sql', import.meta.url),
);

describe('kernel local container naming migration', () => {
  it('keeps observable migration 363 unchanged and adds provenance in migration 364', () => {
    const migration363 = readFileSync(migration363Path, 'utf8');

    expect(migration363).not.toContain('local_container_naming');
    expect(existsSync(migration364Path)).toBe(true);

    const migration364 = readFileSync(migration364Path, 'utf8');
    expect(migration364).toMatch(
      /ADD COLUMN IF NOT EXISTS local_container_naming\s+TEXT NOT NULL DEFAULT 'legacy-unsuffixed'/i,
    );
    expect(migration364).toMatch(
      /local_container_naming IN \('legacy-unsuffixed','generation-v1'\)/i,
    );
    expect(migration364).toMatch(/VALUES\s*\(\s*'364'/);
  });
});
