import { describe, expect, it, vi } from 'vitest';

import {
  appendDispatchOutcome,
  authorizeReleaseEffect,
  claimReleaseEffect,
  claimReleaseVerification,
  renewReleaseEffectClaim,
} from '../release-run-authorization.js';

const releaseRunId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const mergeSha = 'f'.repeat(40);
const artifactVersions = [{
  name: 'brain',
  version: '1.268.6',
  digest: `sha256:${'a'.repeat(64)}`,
}];

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
      artifact_versions: artifactVersions,
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
      artifact_versions: artifactVersions,
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

  it('uses one atomic durable generation claim so crash-before-spawn can recover', async () => {
    const pool = {
      connect: vi.fn(async () => ({
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{
            state: 'production_deploying',
            merge_sha: mergeSha,
            expected_merge_sha: mergeSha,
            effect_kind: 'production',
            idempotency_key: idempotencyKey,
            artifact_versions: artifactVersions,
          }] })
          .mockResolvedValueOnce({
            rows: [{
              id: 10,
              generation: 2,
              lease_expires_at: '2026-07-28T06:10:00.000Z',
              inserted: true,
            }],
            rowCount: 1,
          })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      })),
    };
    await expect(claimReleaseEffect(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      release_authorization: idempotencyKey,
      effect_kind: 'production',
    })).resolves.toMatchObject({
      claimed: true,
      deduped: false,
      dispatch_claim_id: 10,
      generation: 2,
      artifact_versions: artifactVersions,
    });
    const client = await pool.connect.mock.results[0].value;
    const sql = client.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toMatch(/BEGIN[\s\S]+?pg_advisory_xact_lock[\s\S]+?COMMIT/);
    expect(sql).toContain("INTERVAL '15 minutes'");
    expect(sql).toMatch(/effective_lease_expires_at > clock_timestamp\(\)/);
    expect(sql).toMatch(/MAX\(claim\.generation\)/);
  });

  it('returns the active generation as a durable dedupe instead of losing its identity', async () => {
    const active = {
      id: 9,
      generation: 1,
      lease_expires_at: '2026-07-28T06:10:00.000Z',
      inserted: false,
    };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          state: 'staging_running',
          merge_sha: mergeSha,
          expected_merge_sha: mergeSha,
          effect_kind: 'staging',
          idempotency_key: idempotencyKey,
          artifact_versions: artifactVersions,
        }] })
        .mockResolvedValueOnce({ rows: [active], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    await expect(claimReleaseEffect(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      release_authorization: idempotencyKey,
      effect_kind: 'staging',
    })).resolves.toMatchObject({
      claimed: false,
      deduped: true,
      dispatch_claim_id: 9,
      generation: 1,
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('renews only the current live generation and persists the renewal', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ lease_expires_at: '2026-07-28T06:20:00.000Z' }],
        rowCount: 1,
      })),
    };
    await expect(renewReleaseEffectClaim(pool, {
      dispatch_claim_id: 10,
      generation: 2,
    })).resolves.toEqual({
      dispatch_claim_id: 10,
      generation: 2,
      lease_expires_at: '2026-07-28T06:20:00.000Z',
    });
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/claim\.generation = latest\.generation/);
    expect(sql).toMatch(
      /INSERT INTO kernel_release_effect_dispatch_renewals[\s\S]+?effective_lease_expires_at > clock_timestamp\(\)/,
    );
  });

  it('CAS-fences outcomes by exact claim generation and active lease', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 12 }], rowCount: 1 })) };
    await appendDispatchOutcome(pool, 10, 2, 'dispatched', { route: 'brain' });
    expect(pool.query.mock.calls[0][0]).toMatch(
      /INSERT INTO kernel_release_effect_dispatch_outcomes[\s\S]+?claim\.generation = \$2[\s\S]+?effective_lease_expires_at > clock_timestamp\(\)[\s\S]+?ON CONFLICT \(dispatch_claim_id\) DO NOTHING/,
    );
    await expect(appendDispatchOutcome(
      { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
      10,
      1,
      'failed',
    )).rejects.toMatchObject({ code: 'release_dispatch_outcome_fenced' });
  });

  it('creates an observed verification generation for a receipt without replaying the effect', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          state: 'production_deploying',
          merge_sha: mergeSha,
          expected_merge_sha: mergeSha,
          effect_kind: 'production',
          idempotency_key: idempotencyKey,
          artifact_versions: artifactVersions,
        }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 14,
            generation: 4,
            lease_expires_at: '2026-07-28T06:20:00.000Z',
            inserted: true,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ id: 15 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    await expect(claimReleaseVerification(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      release_authorization: idempotencyKey,
      effect_kind: 'production',
    })).resolves.toMatchObject({
      dispatch_claim_id: 14,
      generation: 4,
      outcome: 'observed',
    });
    const sql = client.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(client.query.mock.calls[3][1]).toContain('verification');
    expect(client.query.mock.calls[4][1]).toContain('observed');
    expect(client.query.mock.calls[4][1].some(
      (value) => String(value).includes('server_owned_live_readback'),
    )).toBe(true);
  });
});
