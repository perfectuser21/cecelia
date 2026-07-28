import { describe, expect, it, vi } from 'vitest';

import { authorizeReleaseEffect } from '../release-run-authorization.js';

const releaseRunId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const mergeSha = 'f'.repeat(40);

function poolWith(row) {
  return { query: vi.fn(async () => ({ rows: row ? [row] : [] })) };
}

describe('server-owned ReleaseRun authorization consumer', () => {
  it.each([
    ['missing release', null],
    ['wrong SHA', { state: 'production_deploying', merge_sha: 'e'.repeat(40), idempotency_key: idempotencyKey }],
    ['wrong state', { state: 'staging_passed', merge_sha: mergeSha, idempotency_key: idempotencyKey }],
    ['wrong token', { state: 'production_deploying', merge_sha: mergeSha, idempotency_key: crypto.randomUUID() }],
  ])('denies production for %s', async (_label, row) => {
    await expect(authorizeReleaseEffect(poolWith(row), {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      release_authorization: idempotencyKey,
      effect_kind: 'production',
    })).rejects.toMatchObject({ code: 'release_effect_unauthorized' });
  });

  it('authorizes only the persisted exact production intent', async () => {
    const pool = poolWith({
      state: 'production_deploying',
      merge_sha: mergeSha,
      idempotency_key: idempotencyKey,
      expected_merge_sha: mergeSha,
      effect_kind: 'production',
    });

    await expect(authorizeReleaseEffect(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      release_authorization: idempotencyKey,
      effect_kind: 'production',
    })).resolves.toEqual({
      authorized: true,
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      effect_kind: 'production',
      idempotency_key: idempotencyKey,
    });
  });

  it('rejects malformed or unknown axes before querying', async () => {
    const pool = poolWith(null);
    await expect(authorizeReleaseEffect(pool, {
      release_run_id: 'bad',
      merge_sha: 'bad',
      release_authorization: 'bad',
      effect_kind: 'unknown',
    })).rejects.toMatchObject({ code: 'release_effect_request_invalid' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
