import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('kernel fleet execution receipt migration', () => {
  it('adds rerunnable fleet execution receipt columns and constraints', () => {
    const sql = readFileSync(
      new URL('../../migrations/363_kernel_fleet_execution_receipts.sql', import.meta.url),
      'utf8',
    );

    for (const [column, type] of [
      ['requested_machine_id', 'TEXT'],
      ['actual_machine_id', 'TEXT'],
      ['execution_transport', 'TEXT'],
      ['remote_job_id', 'TEXT'],
      ['machine_attestation_status', 'TEXT'],
      ['lease_generation', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\s+${type}`, 'i'));
    }

    expect(sql).toMatch(
      /WHERE requested_machine_id IS NULL\s+AND machine_id IS NOT NULL/i,
    );
    expect(sql).toMatch(/execution_transport IS NULL\s+OR execution_transport IN \('local-docker','remote-bridge'\)/i);
    expect(sql).toMatch(/machine_attestation_status IS NULL\s+OR machine_attestation_status IN \('local','verified','rejected','pending'\)/i);
    expect(sql.match(/pg_constraint/gi)).toHaveLength(2);
    expect(sql).toMatch(/VALUES\s*\(\s*'363'/);
  });
});
