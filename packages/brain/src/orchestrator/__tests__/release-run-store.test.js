import { describe, expect, it, vi } from 'vitest';

import { createPostgresReleaseRunStore } from '../release-run-store.js';
import { createRequiredE2EManifest } from '../release-run-e2e.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RELEASE_ID = '33333333-3333-4333-8333-333333333333';
const INTENT_ID = '44444444-4444-4444-8444-444444444444';
const CONTRACT_ID = '77777777-7777-4777-8777-777777777777';
const MANIFEST_ID = '88888888-8888-4888-8888-888888888888';
const HEAD_SHA = 'a'.repeat(40);
const MERGE_SHA = 'b'.repeat(40);
const APPROVED_AT = '2026-07-28T06:00:00.000Z';
const CONTRACT_CONTENT = '# frozen approved contract';
const artifacts = [
  { name: 'brain', version: '1.268.2', digest: `sha256:${'1'.repeat(64)}` },
];
const e2eAcceptance = {
  scenarios: [{
    name: 'release behavior',
    covered_tasks: [TASK_ID],
    commands: [{ type: 'probe', id: 'brain.health' }],
  }],
};

function identity() {
  return {
    run_id: RUN_ID,
    task_id: TASK_ID,
    merge_intent_id: '55555555-5555-4555-8555-555555555555',
    merge_receipt_id: '66666666-6666-4666-8666-666666666666',
    repository: 'perfectuser21/cecelia',
    pr_number: 4401,
    source_head_sha: HEAD_SHA,
    merge_sha: MERGE_SHA,
    artifact_versions: artifacts,
    policy_version: 'kernel-release/v1',
  };
}

describe('PostgreSQL ReleaseRun store', () => {
  it('holds one global session advisory lease across the callback and releases it', async () => {
    const order = [];
    const client = {
      query: vi.fn(async (sql) => {
        if (/pg_advisory_lock/.test(sql)) order.push('lock');
        if (/pg_advisory_unlock/.test(sql)) order.push('unlock');
        return { rows: [{ unlocked: true }] };
      }),
      release: vi.fn(() => order.push('release')),
    };
    const store = createPostgresReleaseRunStore({
      connect: vi.fn(async () => client),
    });

    await store.withReleaseLease(async () => {
      order.push('staging');
      order.push('production');
    });

    expect(order).toEqual(['lock', 'staging', 'production', 'unlock', 'release']);
    expect(client.query.mock.calls[0]).toEqual([
      expect.stringMatching(/pg_advisory_lock/),
      ['kernel-release/global'],
    ]);
  });

  it('releases the session lease and client after callback failure', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const store = createPostgresReleaseRunStore({
      connect: vi.fn(async () => client),
    });

    await expect(store.withReleaseLease(async () => {
      throw new Error('staging transport failed');
    })).rejects.toThrow('staging transport failed');
    expect(client.query.mock.calls.at(-1)[0]).toMatch(/pg_advisory_unlock/);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('loads only a confirmed exact-head merge receipt and merge commit SHA', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [{
        ...identity(),
        artifact_versions: undefined,
        policy_version: undefined,
      }] })),
    };
    const store = createPostgresReleaseRunStore({});

    await expect(store.loadMergeAuthority(client, {
      runId: RUN_ID,
      taskId: TASK_ID,
    })).resolves.toMatchObject({
      run_id: RUN_ID,
      task_id: TASK_ID,
      source_head_sha: HEAD_SHA,
      merge_sha: MERGE_SHA,
    });
    expect(client.query.mock.calls[0][0]).toMatch(
      /kernel_merge_effect_receipts[\s\S]*receipt_status = 'confirmed'[\s\S]*observed_head_sha = intent.requested_head_sha/i,
    );
  });

  it('creates immutable identity and initial merged transition in one transaction', async () => {
    const order = [];
    const row = { id: RELEASE_ID, ...identity() };
    const e2eManifest = createRequiredE2EManifest({
      release_run_id: RELEASE_ID,
      run_id: RUN_ID,
      repository: 'perfectuser21/cecelia',
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      contract: {
        id: CONTRACT_ID,
        version: 3,
        approved_at: APPROVED_AT,
        contract_content: CONTRACT_CONTENT,
        e2e_acceptance: e2eAcceptance,
      },
    });
    const client = {
      query: vi.fn(async (sql) => {
        order.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
        if (/SELECT \* FROM kernel_release_runs/.test(sql)) return { rows: [row] };
        if (/SELECT run\.contract_id/.test(sql)) {
          return {
            rows: [{
              contract_id: CONTRACT_ID,
              contract_version: 3,
              contract_approved_at: APPROVED_AT,
              contract_content: CONTRACT_CONTENT,
              e2e_acceptance: e2eAcceptance,
            }],
          };
        }
        if (/FROM kernel_release_e2e_manifests/.test(sql)) {
          return {
            rows: [{
              id: MANIFEST_ID,
              ...e2eManifest,
            }],
          };
        }
        if (/SELECT transition\.state/.test(sql)) {
          return { rows: [{ state: 'merged', transition_evidence: { merge_sha: MERGE_SHA } }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const store = createPostgresReleaseRunStore({});

    await expect(store.createRelease(client, identity())).resolves.toMatchObject({
      id: RELEASE_ID,
      state: 'merged',
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      e2e_manifest: {
        id: MANIFEST_ID,
        ...e2eManifest,
      },
    });
    expect(order.join('\n')).toMatch(
      /BEGIN[\s\S]*INSERT INTO kernel_release_runs[\s\S]*SELECT \* FROM kernel_release_runs[\s\S]*SELECT run\.contract_id[\s\S]*INSERT INTO kernel_release_e2e_manifests[\s\S]*SELECT id, release_run_id[\s\S]*INSERT INTO kernel_release_transitions[\s\S]*COMMIT/,
    );
  });

  it('fails closed when the run has no approved non-empty contract E2E authority', async () => {
    const row = { id: RELEASE_ID, ...identity() };
    const client = {
      query: vi.fn(async (sql) => {
        if (/SELECT \* FROM kernel_release_runs/.test(sql)) return { rows: [row] };
        if (/SELECT run\.contract_id/.test(sql)) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const store = createPostgresReleaseRunStore({});
    await expect(store.createRelease(client, identity()))
      .rejects.toThrow('release_e2e_manifest_authority_missing');
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  it('persists one exact effect intent before returning it', async () => {
    const intent = {
      id: INTENT_ID,
      release_run_id: RELEASE_ID,
      effect_kind: 'staging',
      idempotency_key: '77777777-7777-4777-8777-777777777777',
      expected_merge_sha: MERGE_SHA,
      expected_artifact_versions: artifacts,
      confirmed_receipt: null,
      last_receipt_status: null,
    };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [intent] }),
    };
    const store = createPostgresReleaseRunStore({});

    await expect(store.findOrCreateIntent(client, {
      releaseRun: {
        id: RELEASE_ID,
        merge_sha: MERGE_SHA,
        artifact_versions: artifacts,
      },
      effectKind: 'staging',
    })).resolves.toEqual(intent);
    expect(client.query.mock.calls[0][0]).toMatch(/INSERT INTO kernel_release_effect_intents/i);
    expect(client.query.mock.calls[0][1]).toEqual([
      RELEASE_ID,
      'staging',
      MERGE_SHA,
      JSON.stringify(artifacts),
    ]);
  });

  it('deduplicates confirmed receipts but appends failed observations', async () => {
    const client = {
      query: vi.fn(async () => ({
        rows: [{ id: crypto.randomUUID() }],
        rowCount: 1,
      })),
    };
    const store = createPostgresReleaseRunStore({});
    const base = {
      intent_id: INTENT_ID,
      observed_merge_sha: MERGE_SHA,
      observed_artifact_versions: artifacts,
      dispatch_claim_id: 21,
      dispatch_generation: 3,
      e2e_manifest_id: MANIFEST_ID,
      e2e_manifest_digest: `sha256:${'e'.repeat(64)}`,
      e2e_scenarios_total: 1,
      e2e_scenarios_passed: 1,
      evidence: { source: 'post_effect_observation' },
    };

    await store.appendReceipt(client, { ...base, receipt_status: 'confirmed' });
    await store.appendReceipt(client, { ...base, receipt_status: 'failed' });

    expect(client.query.mock.calls[0][0]).toMatch(
      /ON CONFLICT \(intent_id\) WHERE receipt_status = 'confirmed' DO NOTHING/i,
    );
    expect(client.query.mock.calls[1][0]).not.toMatch(/ON CONFLICT/i);
    expect(client.query.mock.calls[0][1]).toContain(MANIFEST_ID);
    expect(client.query.mock.calls[0][1]).toContain(21);
    expect(client.query.mock.calls[0][1]).toContain(3);
  });
});
