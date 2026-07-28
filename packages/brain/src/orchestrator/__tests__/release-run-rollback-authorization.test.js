import { describe, expect, it, vi } from 'vitest';

import {
  assertRollbackExecutionCurrent,
  claimRollbackExecution,
  createRollbackAuthority,
  observeRollbackAuthority,
  renewRollbackClaim,
  settleRollbackExecution,
} from '../release-run-rollback-authorization.js';

const releaseRunId = '44444444-4444-4444-8444-444444444444';
const authorityId = '66666666-6666-4666-8666-666666666666';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';
const mergeSha = 'f'.repeat(40);
const artifacts = [{
  name: 'brain',
  version: '1.268.17',
  digest: `sha256:${'a'.repeat(64)}`,
}];
const targets = [{
  artifact_name: 'brain',
  current_version: '1.268.17',
  current_digest: `sha256:${'a'.repeat(64)}`,
  previous_version: `brain-image:sha256:${'b'.repeat(64)}`,
  previous_digest: `sha256:${'b'.repeat(64)}`,
  rollback_metadata: {
    image_tag: `cecelia-brain:rollback-${'b'.repeat(12)}`,
    image_reference: `sha256:${'b'.repeat(64)}`,
  },
}];

function clientWith(...responses) {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(responses.shift() ?? { rows: [] })
      .mockResolvedValueOnce({ rows: [] }),
    release: vi.fn(),
  };
}

describe('durable typed rollback authority', () => {
  it('rejects malformed axes without touching the database', async () => {
    const pool = { query: vi.fn() };
    await expect(createRollbackAuthority(pool, {
      release_run_id: 'bad',
      merge_sha: 'bad',
      rollback_authorization: 'bad',
    })).rejects.toMatchObject({ code: 'release_rollback_authority_request_invalid' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('creates only a DB-derived exact production_verified authority', async () => {
    const row = {
      id: authorityId,
      release_run_id: releaseRunId,
      expected_merge_sha: mergeSha,
      idempotency_key: idempotencyKey,
      expected_artifact_versions: artifacts,
      rollback_targets: targets,
    };
    const pool = { query: vi.fn(async () => ({ rows: [row], rowCount: 1 })) };
    await expect(createRollbackAuthority(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      rollback_authorization: idempotencyKey,
      artifact_versions: [{ name: 'forged' }],
    })).resolves.toMatchObject({
      authority_id: authorityId,
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      rollback_authorization: idempotencyKey,
      artifact_versions: artifacts,
      rollback_targets: targets,
    });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO kernel_release_rollback_execution_authorities/);
    expect(sql).toMatch(/kernel_release_transitions/);
    expect(sql).toMatch(/production_verified/);
    expect(sql).toMatch(/kernel_release_effect_receipts/);
    expect(sql).toMatch(/receipt_status = 'confirmed'/);
    expect(sql).toMatch(/newer_receipt\.append_seq > production_receipt\.append_seq/);
    expect(sql).toMatch(/kernel_release_rollback_artifact_receipts/);
    expect(params).toEqual([releaseRunId, mergeSha, idempotencyKey]);
  });

  it('passes an abort signal through a transaction and rolls back before commit', async () => {
    const controller = new AbortController();
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockImplementationOnce(async () => {
          controller.abort();
          return {
            rows: [{
              authority_id: authorityId,
              settlement_status: 'succeeded',
              late_effect_risk: false,
              receipt_id: '77777777-7777-4777-8777-777777777777',
            }],
          };
        })
        .mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    await expect(settleRollbackExecution(pool, {
      claim_id: 71,
      generation: 1,
      status: 'succeeded',
      late_effect_risk: false,
      observed_targets: targets,
      observed_readbacks: [{
        artifact: 'brain',
        observed_digest: targets[0].previous_digest,
      }],
      evidence: { source: 'test' },
      abort_signal: controller.signal,
    })).rejects.toMatchObject({ code: 'release_rollback_aborted' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('records a durable interrupt and never returns succeeded when abort arrives while COMMIT is pending', async () => {
    const controller = new AbortController();
    let releaseCommit;
    const commitPending = new Promise((resolve) => {
      releaseCommit = resolve;
    });
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            authority_id: authorityId,
            settlement_status: 'succeeded',
            late_effect_risk: false,
            receipt_id: '77777777-7777-4777-8777-777777777777',
          }],
        })
        .mockImplementationOnce(async () => commitPending),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => ({ rows: [{ id: 91 }], rowCount: 1 })),
    };
    const running = settleRollbackExecution(pool, {
      claim_id: 71,
      generation: 1,
      status: 'succeeded',
      late_effect_risk: false,
      observed_targets: targets,
      observed_readbacks: [{
        artifact: 'brain',
        observed_digest: targets[0].previous_digest,
      }],
      evidence: { source: 'test' },
      abort_signal: controller.signal,
    });
    await vi.waitFor(() => expect(client.query).toHaveBeenCalledWith('COMMIT'));
    controller.abort();
    releaseCommit({ rows: [] });
    await expect(running).rejects.toMatchObject({ code: 'release_rollback_aborted' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/kernel_release_rollback_execution_interrupts/),
      [71, 1, 'abort_during_commit'],
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('records commit ambiguity through an independent store when the lock client disconnects', async () => {
    const controller = new AbortController();
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            authority_id: authorityId,
            settlement_status: 'succeeded',
            late_effect_risk: false,
            receipt_id: '77777777-7777-4777-8777-777777777777',
          }],
        })
        .mockImplementationOnce(async () => {
          controller.abort();
          throw new Error('connection terminated during COMMIT');
        })
        .mockRejectedValue(new Error('connection unavailable')),
    };
    const interruptStore = {
      query: vi.fn(async () => ({ rows: [{ id: 92 }], rowCount: 1 })),
    };
    await expect(settleRollbackExecution(client, {
      claim_id: 71,
      generation: 1,
      status: 'succeeded',
      late_effect_risk: false,
      observed_targets: targets,
      observed_readbacks: [{
        artifact: 'brain',
        observed_digest: targets[0].previous_digest,
      }],
      evidence: { source: 'test' },
      abort_signal: controller.signal,
      interrupt_store: interruptStore,
    }, { connectionKind: 'client' }))
      .rejects.toThrow('connection terminated during COMMIT');
    expect(interruptStore.query).toHaveBeenCalledWith(
      expect.stringMatching(/kernel_release_rollback_execution_interrupts/),
      [71, 1, 'commit_outcome_unknown'],
    );
  });

  it('uses an explicitly supplied PoolClient without reconnecting it', async () => {
    const client = {
      connect: vi.fn(async () => {
        throw new Error('Client has already been connected');
      }),
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            authority_id: authorityId,
            settlement_status: 'succeeded',
            late_effect_risk: false,
            receipt_id: '77777777-7777-4777-8777-777777777777',
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    await expect(settleRollbackExecution(client, {
      claim_id: 71,
      generation: 1,
      status: 'succeeded',
      late_effect_risk: false,
      observed_targets: targets,
      observed_readbacks: [{
        artifact: 'brain',
        observed_digest: targets[0].previous_digest,
      }],
      evidence: { source: 'test' },
      abort_signal: new AbortController().signal,
      interrupt_store: { query: vi.fn() },
    }, { connectionKind: 'client' })).resolves.toMatchObject({
      status: 'succeeded',
      receipt_id: '77777777-7777-4777-8777-777777777777',
    });
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).not.toHaveBeenCalled();
  });

  it('fails closed when exact evidence is missing or idempotency axes conflict', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    await expect(createRollbackAuthority(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      rollback_authorization: idempotencyKey,
    })).rejects.toMatchObject({ code: 'release_rollback_authority_unavailable' });
  });

  it('claims the exact authority once and returns the active claim as a dedupe', async () => {
    const claim = {
      authority_id: authorityId,
      release_run_id: releaseRunId,
      expected_merge_sha: mergeSha,
      idempotency_key: idempotencyKey,
      expected_artifact_versions: artifacts,
      rollback_targets: targets,
      claim_id: 71,
      generation: 1,
      lease_expires_at: '2026-07-28T08:30:00.000Z',
      inserted: true,
    };
    const client = clientWith({ rows: [claim], rowCount: 1 });
    const pool = { connect: vi.fn(async () => client) };
    await expect(claimRollbackExecution(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      rollback_authorization: idempotencyKey,
    })).resolves.toMatchObject({
      authority_id: authorityId,
      claim_id: 71,
      generation: 1,
      claimed: true,
      deduped: false,
    });
    const sql = client.query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toMatch(/BEGIN[\s\S]+pg_advisory_xact_lock[\s\S]+COMMIT/);
    expect(sql).toMatch(/INSERT INTO kernel_release_rollback_execution_claims/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]+kernel_release_rollback_execution_settlements/);
    expect(sql).not.toMatch(/MAX\(claim\.generation\)\s*\+\s*1/);
  });

  it('never creates a replay claim after terminal or lease expiry', async () => {
    const client = clientWith({ rows: [], rowCount: 0 });
    const pool = { connect: vi.fn(async () => client) };
    await expect(claimRollbackExecution(pool, {
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      rollback_authorization: idempotencyKey,
    })).rejects.toMatchObject({ code: 'release_rollback_claim_unavailable' });
  });

  it('renews only the exact live generation', async () => {
    const pool = { query: vi.fn(async () => ({
      rows: [{ lease_expires_at: '2026-07-28T08:45:00.000Z' }],
      rowCount: 1,
    })) };
    await expect(renewRollbackClaim(pool, {
      claim_id: 71,
      generation: 1,
    })).resolves.toMatchObject({ claim_id: 71, generation: 1 });
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/kernel_release_rollback_execution_renewals/);
    expect(sql).toMatch(/settlement\.id IS NULL/);
    expect(sql).toMatch(/effective_lease_expires_at > clock_timestamp\(\)/);
  });

  it('revalidates latest production evidence and rejects any newer production claim', async () => {
    const pool = { query: vi.fn(async () => ({
      rows: [{ authority_id: authorityId }],
      rowCount: 1,
    })) };
    await expect(assertRollbackExecutionCurrent(pool, {
      claim_id: 71,
      generation: 1,
    })).resolves.toMatchObject({ authority_id: authorityId });
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/newer_receipt\.append_seq > production_receipt\.append_seq/);
    expect(sql).toMatch(
      /newer_receipt_intent\.effect_kind = 'production'/,
    );
    expect(sql).toMatch(/newer_claim\.id > production_receipt\.dispatch_claim_id/);
    expect(sql).toMatch(/newer_intent\.effect_kind = 'production'/);
  });

  it.each([
    ['unknown', true],
    ['aborted', true],
    ['failed', false],
    ['succeeded', false],
  ])('settles %s with explicit late-effect risk and exact CAS fencing', async (
    status,
    lateEffectRisk,
  ) => {
    const pool = { query: vi.fn(async () => ({
      rows: [{
        id: 81,
        authority_id: authorityId,
        settlement_status: status,
        late_effect_risk: lateEffectRisk,
      }],
      rowCount: 1,
    })) };
    await expect(settleRollbackExecution(pool, {
      claim_id: 71,
      generation: 1,
      status,
      late_effect_risk: lateEffectRisk,
      evidence: { reason: 'test' },
      observed_targets: status === 'succeeded' ? targets : undefined,
      observed_readbacks: status === 'succeeded'
        ? [{ artifact: 'brain', observed_digest: targets[0].previous_digest }]
        : undefined,
    })).resolves.toMatchObject({ status, late_effect_risk: lateEffectRisk });
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/kernel_release_rollback_execution_settlements/);
    expect(sql).toMatch(/kernel_release_rollback_execution_receipts/);
    expect(sql).toMatch(/claim\.generation = \$2/);
    expect(sql).not.toMatch(/kernel_release_transitions\s*\(/);
    expect(sql).toMatch(
      /newer_receipt_intent\.effect_kind = 'production'/,
    );
  });

  it('rejects unknown or aborted settlements that hide late-effect risk', async () => {
    await expect(settleRollbackExecution({ query: vi.fn() }, {
      claim_id: 71,
      generation: 1,
      status: 'unknown',
      late_effect_risk: false,
      evidence: {},
    })).rejects.toMatchObject({ code: 'release_rollback_settlement_invalid' });
  });

  it('observes durable state without relying on process memory', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{
      authority_id: authorityId,
      release_run_id: releaseRunId,
      merge_sha: mergeSha,
      artifact_versions: artifacts,
      rollback_targets: targets,
      claim_id: 71,
      generation: 1,
      settlement_status: 'unknown',
      late_effect_risk: true,
      evidence: { reason: 'lease_lost' },
    }] })) };
    await expect(observeRollbackAuthority(pool, authorityId)).resolves.toMatchObject({
      authority_id: authorityId,
      status: 'unknown',
      late_effect_risk: true,
    });
    const sql = pool.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toMatch(/release_rollback_expired_claim_reaper/);
    expect(sql).toMatch(
      /kernel_release_rollback_execution_authorities[\s\S]+kernel_release_rollback_execution_claims[\s\S]+kernel_release_rollback_execution_settlements/,
    );
  });

  it('observes a commit-pending interrupt as unknown late-effect risk', async () => {
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        authority_id: authorityId,
        release_run_id: releaseRunId,
        merge_sha: mergeSha,
        artifact_versions: artifacts,
        rollback_targets: targets,
        claim_id: 71,
        generation: 1,
        settlement_status: 'succeeded',
        late_effect_risk: false,
        evidence: { source: 'readback' },
        receipt_id: '77777777-7777-4777-8777-777777777777',
        interrupt_id: 91,
        interrupt_kind: 'abort_during_commit',
        interrupt_evidence: { error_code: 'release_rollback_aborted' },
      }] }) };
    await expect(observeRollbackAuthority(pool, authorityId)).resolves.toMatchObject({
      status: 'unknown',
      late_effect_risk: true,
      evidence: {
        source: 'readback',
        error_code: 'release_rollback_aborted',
        interrupt_kind: 'abort_during_commit',
      },
    });
  });
});
