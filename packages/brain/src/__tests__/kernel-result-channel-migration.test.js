import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration369Url = new URL(
  '../../migrations/369_allow_fleet_worker_execution_transport.sql',
  import.meta.url,
);
const migration370Url = new URL(
  '../../migrations/370_kernel_result_channel_receipts.sql',
  import.meta.url,
);

function migrationText(url) {
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
}

describe('Kernel result channel migrations', () => {
  it('migration 369 forward-only widens the execution transport constraint', () => {
    const sql = migrationText(migration369Url);

    expect(sql, 'migration 369 must exist').not.toBe('');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS harness_attempts_execution_transport_check/i);
    expect(sql).toMatch(
      /execution_transport IN \('local-docker','remote-bridge','fleet-worker'\)/i,
    );
    expect(sql).toMatch(/VALUES\s*\(\s*'369'/);
  });

  it('migration 370 persists server-owned binding and append-only receipts', () => {
    const sql = migrationText(migration370Url);

    expect(sql, 'migration 370 must exist').not.toBe('');
    for (const column of [
      'result_receipt_id',
      'result_sha256',
      'result_bytes',
      'result_delivery_id',
      'result_nonce',
      'result_worker_id',
      'result_persisted_at',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`, 'i'));
    }
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS harness_result_receipts/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*attempt_id\s*,\s*lease_generation\s*\)/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON harness_result_receipts/i);
    expect(sql).toMatch(/append-only/i);
    expect(sql).toMatch(/VALUES\s*\(\s*'370'/);
  });
});
