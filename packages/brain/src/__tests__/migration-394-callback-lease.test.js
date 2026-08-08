import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../migrations/394_callback_queue_consumer_lease.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../../migrations/rollback/394_callback_queue_consumer_lease.down.sql', import.meta.url),
  'utf8',
);

describe('migration 394 callback_queue consumer lease', () => {
  it('adds both lease columns and a claimable partial index', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS claimed_by TEXT/);
    expect(migration).toMatch(/idx_callback_queue_claimable/);
    expect(migration).toMatch(/WHERE processed_at IS NULL/);
  });

  it('rollback removes the index and both columns', () => {
    expect(rollback).toMatch(/DROP INDEX IF EXISTS idx_callback_queue_claimable/);
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS claimed_by/);
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS claimed_at/);
  });
});
