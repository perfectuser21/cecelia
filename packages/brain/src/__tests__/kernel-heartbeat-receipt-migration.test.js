import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration371Url = new URL(
  '../../migrations/371_kernel_heartbeat_receipts.sql',
  import.meta.url,
);

describe('Kernel heartbeat receipt migration', () => {
  it('creates a forward-only append-only nonce audit ledger', () => {
    const sql = existsSync(migration371Url)
      ? readFileSync(migration371Url, 'utf8')
      : '';

    expect(sql, 'migration 371 must exist').not.toBe('');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS harness_heartbeat_receipts/i);
    for (const column of [
      'attempt_id',
      'run_id',
      'worker_id',
      'job_id',
      'lease_owner',
      'lease_generation',
      'heartbeat_nonce',
      'request_sha256',
      'observed_at',
      'lease_seconds',
      'provider_session_id',
      'heartbeat_at',
      'lease_expires_at',
      'persisted_at',
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, 'i'));
    }
    expect(sql).toMatch(/attempt_id UUID NOT NULL[\s\S]*ON DELETE RESTRICT/i);
    expect(sql).toMatch(/run_id UUID NOT NULL[\s\S]*ON DELETE RESTRICT/i);
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*attempt_id\s*,\s*lease_generation\s*,\s*heartbeat_nonce\s*\)/i,
    );
    expect(sql).toMatch(/request_sha256[\s\S]*\^\[a-f0-9\]\{64\}\$/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON harness_heartbeat_receipts/i);
    expect(sql).toMatch(/append-only/i);
    expect(sql).not.toMatch(/DELETE FROM harness_heartbeat_receipts/i);
    expect(sql).toMatch(/VALUES\s*\(\s*'371'/);
  });
});
