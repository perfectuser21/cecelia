import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  inShortTransaction,
  persistReceiptToDb,
  signedContractFromDb,
} from '../gp-assertion-repository.js';

function receipt() {
  return {
    journey_step_link_id: 'cell-1',
    run_id: 'run-1',
    assertion_revision: 1,
    assertion_ref_snapshot: 'tests/a.test.js',
    assertion_digest: 'a'.repeat(64),
    source_repo: 'github.com/example/cecelia',
    source_sha: 'b'.repeat(40),
    gp_contract_id: 'contract-1',
    gp_contract_hash: 'c'.repeat(64),
    command_argv: ['vitest', 'run', 'tests/a.test.js'],
    scenario_count: 1,
    scenario_evidence: { kind: 'vitest', passed: 1 },
    verdict: 'PASS',
    exit_code: 0,
    started_at: '2026-07-30T00:00:00Z',
    completed_at: '2026-07-30T00:00:01Z',
    machine_id: 'us-mac-m4',
    output_digest: 'd'.repeat(64),
    output_tail: '1 passed',
  };
}

function transactionHarness() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return {
    client,
    pool: { connect: vi.fn().mockResolvedValue(client) },
  };
}

describe('GP assertion repository', () => {
  it('reuses the trusted assertion error factory', async () => {
    const source = await readFile(
      new URL('../gp-assertion-repository.js', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /import\s*{\s*assertionRunnerError\s*}.*gp-assertion-command\.js/,
    );
    expect(source).toMatch(/return assertionRunnerError\(code, message\)/);
  });

  it('commits and releases a successful short transaction', async () => {
    const { client, pool } = transactionHarness();
    const work = vi.fn().mockResolvedValue('receipt');

    await expect(inShortTransaction(
      pool,
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      work,
    )).resolves.toBe('receipt');

    expect(work).toHaveBeenCalledWith(client);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases when short transaction work fails', async () => {
    const { client, pool } = transactionHarness();
    const rootCause = new Error('contract changed');

    await expect(inShortTransaction(
      pool,
      'BEGIN',
      vi.fn().mockRejectedValue(rootCause),
    )).rejects.toBe(rootCause);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed when one journey has multiple Golden Path histories', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'signed-a',
            golden_path_id: 'gp-a',
            content_hash: 'a'.repeat(64),
            status: 'signed',
          },
          {
            id: 'pending-b',
            golden_path_id: 'gp-b',
            content_hash: 'b'.repeat(64),
            status: 'pending_signature',
          },
        ],
      }),
    };

    await expect(
      signedContractFromDb(db, 'journey-1'),
    ).rejects.toMatchObject({ code: 'GP_CONTRACT_AMBIGUOUS' });
  });

  it('share-locks the signed contract during final delivery', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: 'signed-a',
          golden_path_id: 'gp-a',
          content_hash: 'a'.repeat(64),
          status: 'signed',
        }],
      }),
    };

    await signedContractFromDb(db, 'journey-1', { lock: 'share' });

    expect(db.query.mock.calls[0][0]).toMatch(/FOR SHARE OF contract/i);
  });

  it('returns no receipt when the insert CAS observes contract drift', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await expect(persistReceiptToDb(receipt(), db)).resolves.toBeNull();

    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/contract\.status\s*=\s*'signed'/i);
    expect(sql).toMatch(/contract\.content_hash\s*=\s*\$9/i);
    expect(sql).toMatch(/gp\.journey_id\s*=\s*cell\.journey_id/i);
  });

  it('makes the insert CAS reject another GP history for the journey', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await persistReceiptToDb(receipt(), db);

    expect(db.query.mock.calls[0][0]).toMatch(
      /NOT EXISTS[\s\S]+other_contract\.golden_path_id[\s\S]+<> contract\.golden_path_id/i,
    );
  });
});
