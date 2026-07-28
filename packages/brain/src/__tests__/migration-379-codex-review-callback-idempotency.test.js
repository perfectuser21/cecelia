import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL(
  '../../migrations/379_codex_review_callback_idempotency.sql',
  import.meta.url,
), 'utf8');

describe('migration 379 — Codex review callback idempotency', () => {
  it('adds a nullable idempotency key and a partial unique index', () => {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS idempotency_key TEXT/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_callback_queue_idempotency_key/,
    );
    expect(migration).toMatch(/WHERE idempotency_key IS NOT NULL/);
  });

  it('registers schema version 379 idempotently', () => {
    expect(migration).toContain("VALUES ('379'");
    expect(migration).toContain('ON CONFLICT (version) DO NOTHING');
  });
});
