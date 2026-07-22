import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../migrations/357_harness_provider_attempts.sql', import.meta.url),
  'utf8',
);

describe('migration 357 harness_attempts', () => {
  it('stores provider-neutral attempt state', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS harness_attempts/);
    expect(sql).toMatch(/UNIQUE\s*\(run_id,\s*hop\)/);
    expect(sql).toMatch(/provider_session_id TEXT/);
    expect(sql).toMatch(/task_bundle JSONB NOT NULL/);
    expect(sql).toMatch(/result JSONB/);
    expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ/);
    expect(sql).toMatch(/callback_secret_hash TEXT NOT NULL/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?ON harness_attempts\s*\(run_id, provider, provider_session_id\)/,
    );
  });
});
