import { describe, expect, it, vi } from 'vitest';
import {
  createPostgresAuditSink,
  createPostgresBundleChainStore,
  createPostgresNonceConsumer,
  createPostgresPredecessorResolver,
} from '../kernel-equivalence-postgres-runtime.js';
import {
  sha256Canonical,
} from '../kernel-equivalence-receipts.js';
import {
  FIXTURE_ATTEMPT_ID,
  FIXTURE_RUN_ID,
  createTrustFixture,
  fixtureBundle,
  fixtureCell,
  fixtureGrant,
  fixtureReceipt,
} from './kernel-equivalence-test-fixtures.js';

function nonceInput() {
  return {
    grant_id: '33333333-3333-4333-8333-333333333333',
    nonce: '44444444-4444-4444-8444-444444444444',
    cell_id: 'KERNEL-P0-04-CI-MERGE-AUTHORITY::codex::normal',
    run_id: FIXTURE_RUN_ID,
    attempt_id: FIXTURE_ATTEMPT_ID,
    expires_at: '2026-07-28T12:05:00.000Z',
  };
}

function audit() {
  return {
    schema_version: 'kernel-equivalence-denial-audit/v1',
    occurred_at: '2026-07-28T12:02:00.000Z',
    status: 'blocked',
    code: 'grant_nonce_replay',
    stage: 'nonce_consumption',
    cell_id: 'KERNEL-P0-04-CI-MERGE-AUTHORITY::codex::normal',
    behavior_id: 'KERNEL-P0-04-CI-MERGE-AUTHORITY',
    provider: 'codex',
    scenario: 'normal',
    run_id: FIXTURE_RUN_ID,
    attempt_id: FIXTURE_ATTEMPT_ID,
    late_effect_risk: false,
  };
}

function bundleFixture(scenario = 'normal') {
  const keys = createTrustFixture();
  const cell = {
    ...fixtureCell({ scenario }),
    effect_signer_status: 'available',
    effect_key_id: keys.effect.record.key_id,
    blocked_by: null,
  };
  const grant = fixtureGrant(keys, cell);
  const receipt = fixtureReceipt(keys, grant, cell);
  const bundle = fixtureBundle(keys, cell, grant, [receipt]);
  return {
    keys,
    cell,
    grant,
    receipt,
    bundle,
    hash: sha256Canonical(bundle),
  };
}

function transactionPool({ updateRows, readbackBundle, updateError = null }) {
  const calls = [];
  const client = {
    query: vi.fn(async (text, params) => {
      calls.push({ text, params });
      if (/^BEGIN$/i.test(text)) return { rows: [], rowCount: null };
      if (/^ROLLBACK$/i.test(text)) return { rows: [], rowCount: null };
      if (/^COMMIT$/i.test(text)) return { rows: [], rowCount: null };
      if (/set_config\('statement_timeout'/i.test(text)) {
        return { rows: [{}], rowCount: 1 };
      }
      if (/INSERT INTO kernel_equivalence_receipt_bundles/i.test(text)) {
        return { rows: [{ bundle_hash: params[1] }], rowCount: 1 };
      }
      if (/UPDATE kernel_equivalence_bundle_chain_heads/i.test(text)) {
        if (updateError) throw updateError;
        return { rows: updateRows, rowCount: updateRows.length };
      }
      if (/SELECT bundle\s+FROM kernel_equivalence_receipt_bundles/i.test(text)) {
        return {
          rows: readbackBundle == null ? [] : [{ bundle: readbackBundle }],
          rowCount: readbackBundle == null ? 0 : 1,
        };
      }
      throw new Error(`unexpected SQL: ${text}`);
    }),
    release: vi.fn(),
  };
  return {
    pool: {
      connect: vi.fn(async () => client),
      query: vi.fn(async (text, params) => {
        if (/SELECT genesis_hash, head_hash, revision/i.test(text)) {
          return {
            rows: [{
              genesis_hash: null,
              head_hash: null,
              revision: 0,
            }],
            rowCount: 1,
          };
        }
        if (/SELECT bundle\s+FROM kernel_equivalence_receipt_bundles/i.test(text)) {
          return {
            rows: readbackBundle == null
              ? []
              : [{ bundle: readbackBundle }],
            rowCount: readbackBundle == null ? 0 : 1,
          };
        }
        throw new Error(`unexpected pool SQL: ${text} ${params}`);
      }),
    },
    client,
    calls,
  };
}

describe('PostgreSQL Kernel equivalence runtime authorities', () => {
  it('consumes a grant nonce with one conflict-safe INSERT statement', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ grant_id: nonceInput().grant_id }],
        rowCount: 1,
      })),
    };
    const consume = createPostgresNonceConsumer({ pool });

    await expect(consume(nonceInput())).resolves.toEqual({ consumed: true });
    const [text, params] = pool.query.mock.calls[0];
    expect(text).toMatch(/INSERT INTO kernel_equivalence_execution_nonces/i);
    expect(text).toMatch(/ON CONFLICT DO NOTHING/i);
    expect(text).toMatch(/RETURNING grant_id/i);
    expect(text).toMatch(/clock_timestamp\(\)/i);
    expect(params).toHaveLength(6);
  });

  it('returns a replay denial when the atomic INSERT loses its conflict', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    };
    const consume = createPostgresNonceConsumer({ pool });

    await expect(consume(nonceInput())).resolves.toEqual({ consumed: false });
  });

  it('persists only the denial audit allowlist', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ audit_id: '55555555-5555-4555-8555-555555555555' }],
        rowCount: 1,
      })),
    };
    const sink = createPostgresAuditSink({
      pool,
      randomUUID: () => '55555555-5555-4555-8555-555555555555',
    });

    await expect(sink(audit())).resolves.toEqual({
      persisted: true,
      audit_id: '55555555-5555-4555-8555-555555555555',
    });
    expect(pool.query.mock.calls[0][1]).toHaveLength(13);
    await expect(sink({ ...audit(), signature: 'secret' }))
      .rejects.toMatchObject({ code: 'audit_record_invalid' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('commits a bundle and advances the head in one transaction after readback', async () => {
    const value = bundleFixture();
    const checkpoint = {
      genesis_hash: value.hash,
      head_hash: value.hash,
      revision: 1,
    };
    const runtime = transactionPool({
      updateRows: [checkpoint],
      readbackBundle: value.bundle,
    });
    const store = createPostgresBundleChainStore({ pool: runtime.pool });
    await store.getCheckpoint();

    await expect(store.commit({
      bundle: value.bundle,
      bundle_hash: value.hash,
      previous_head_hash: null,
    })).resolves.toEqual({
      committed: true,
      checkpoint: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.hash,
        head_hash: value.hash,
      },
    });
    expect(runtime.calls.map(({ text }) => text.trim().split(/\s+/)[0]))
      .toEqual(['BEGIN', 'SELECT', 'INSERT', 'UPDATE', 'SELECT', 'COMMIT']);
    expect(runtime.calls[1].text).toMatch(/set_config\('statement_timeout'/i);
    expect(runtime.calls[1].text).toMatch(/set_config\('lock_timeout'/i);
    await expect(store.readBundle(value.hash)).resolves.toEqual(value.bundle);
    expect(runtime.calls.find(({ text }) => (
      /UPDATE kernel_equivalence_bundle_chain_heads/i.test(text)
    )).text).toMatch(/revision = \$4/i);
    expect(runtime.client.release).toHaveBeenCalledOnce();
  });

  it('rolls back an inserted loser when compare-and-swap head advancement fails', async () => {
    const value = bundleFixture();
    const runtime = transactionPool({
      updateRows: [],
      readbackBundle: null,
    });
    const store = createPostgresBundleChainStore({ pool: runtime.pool });
    await store.getCheckpoint();

    await expect(store.commit({
      bundle: value.bundle,
      bundle_hash: value.hash,
      previous_head_hash: null,
    })).resolves.toEqual({
      committed: false,
      checkpoint: null,
    });
    expect(runtime.calls.map(({ text }) => text.trim()))
      .toContain('ROLLBACK');
    await expect(store.readBundle(value.hash))
      .rejects.toMatchObject({
        code: 'bundle_chain_read_unavailable',
      });
  });

  it('rolls back when durable readback differs from the canonical bundle', async () => {
    const value = bundleFixture();
    const runtime = transactionPool({
      updateRows: [{
        genesis_hash: value.hash,
        head_hash: value.hash,
        revision: 1,
      }],
      readbackBundle: { tampered: true },
    });
    const store = createPostgresBundleChainStore({ pool: runtime.pool });
    await store.getCheckpoint();

    await expect(store.commit({
      bundle: value.bundle,
      bundle_hash: value.hash,
      previous_head_hash: null,
    })).rejects.toMatchObject({ code: 'bundle_chain_readback_invalid' });
    expect(runtime.calls.map(({ text }) => text.trim()))
      .toContain('ROLLBACK');
  });

  it('rolls back and reports a settled transaction-local timeout', async () => {
    const value = bundleFixture();
    const timeout = new Error('canceling statement due to statement timeout');
    timeout.code = '57014';
    const runtime = transactionPool({
      updateRows: [],
      readbackBundle: null,
      updateError: timeout,
    });
    const store = createPostgresBundleChainStore({ pool: runtime.pool });
    await store.getCheckpoint();

    await expect(store.commit({
      bundle: value.bundle,
      bundle_hash: value.hash,
      previous_head_hash: null,
      timeout_ms: 17,
    })).rejects.toMatchObject({
      code: 'bundle_chain_commit_timeout',
    });
    expect(runtime.calls.map(({ text }) => text.trim())).toContain('ROLLBACK');
    expect(runtime.client.release).toHaveBeenCalledOnce();
  });

  it('reads and canonical-verifies a durable bundle from a fresh store instance', async () => {
    const value = bundleFixture();
    const pool = {
      connect: vi.fn(),
      query: vi.fn(async () => ({
        rows: [{ bundle: value.bundle }],
        rowCount: 1,
      })),
    };
    const freshStore = createPostgresBundleChainStore({ pool });

    await expect(freshStore.readBundle(value.hash)).resolves.toEqual(value.bundle);
    expect(pool.query).toHaveBeenCalledOnce();
    pool.query.mockResolvedValue({
      rows: [{ bundle: { tampered: true } }],
      rowCount: 1,
    });
    await expect(freshStore.readBundle(value.hash)).rejects.toMatchObject({
      code: 'bundle_chain_readback_invalid',
    });
  });

  it('resolves one exact committed violation predecessor and rejects ambiguity', async () => {
    const value = bundleFixture('violation');
    const request = {
      cell_id: value.cell.cell_id,
      behavior_id: value.cell.behavior_id,
      provider: value.cell.provider,
      scenario: 'violation',
      run_id: value.grant.run_id,
      attempt_id: value.grant.attempt_id,
      artifact_sha: value.grant.artifact_sha,
      resource_id: value.grant.resource_id,
      resource_ref: value.grant.resource_ref,
      seam_id: value.cell.seam_id,
      adapter_id: value.cell.adapter_id,
    };
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ bundle_hash: value.hash, bundle: value.bundle }],
      })),
    };
    const resolve = createPostgresPredecessorResolver({ pool });

    await expect(resolve(request)).resolves.toEqual({
      bundle_hash: value.hash,
      bundle: value.bundle,
    });
    expect(pool.query.mock.calls[0][0]).toMatch(/WITH RECURSIVE trusted_chain/i);
    expect(pool.query.mock.calls[0][0])
      .toMatch(/kernel_equivalence_bundle_chain_heads/i);
    expect(pool.query.mock.calls[0][0]).toMatch(/LIMIT 2/i);
    pool.query.mockResolvedValue({
      rows: [
        { bundle_hash: value.hash, bundle: value.bundle },
        { bundle_hash: value.hash, bundle: value.bundle },
      ],
    });
    await expect(resolve(request)).rejects.toMatchObject({
      code: 'recovery_predecessor_ambiguous',
    });
    pool.query.mockResolvedValue({
      rows: [{ bundle_hash: 'f'.repeat(64), bundle: value.bundle }],
    });
    await expect(resolve(request)).rejects.toMatchObject({
      code: 'recovery_predecessor_invalid',
    });
  });
});
