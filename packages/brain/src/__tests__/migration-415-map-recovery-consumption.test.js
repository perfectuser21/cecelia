import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 415 map recovery consumption', () => {
  it('keeps recovery contracts immutable and records one append-only generator consumption', async () => {
    const sql = await readFile(
      new URL('../../migrations/415_map_recovery_consumptions.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS map_recovery_consumptions/i);
    expect(sql).toMatch(/contract_id uuid PRIMARY KEY REFERENCES map_recovery_contracts\(id\)/i);
    expect(sql).toMatch(/attempt_id uuid NOT NULL UNIQUE REFERENCES harness_attempts\(id\)/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON map_recovery_consumptions/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS map_recovery_contract_id UUID/i);
  });
});
