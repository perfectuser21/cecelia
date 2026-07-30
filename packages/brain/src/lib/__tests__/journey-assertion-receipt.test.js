import { describe, expect, it } from 'vitest';

async function loadReceiptState() {
  return import('../journey-assertion-receipt.js');
}

describe('Golden Path assertion receipt state', () => {
  it('does not verify a green cell without a receipt', async () => {
    const { deriveAssertionVerification } = await loadReceiptState();
    const cell = {
      link_id: 'c1',
      cell_status: 'green',
      assertion_ref: 'tests/a.test.js',
      assertion_revision: 1,
    };

    expect(deriveAssertionVerification(cell, [])).toMatchObject({
      state: 'never_run',
      verified: false,
      last_verified: null,
    });
  });

  it('does not verify a legacy PASS receipt without scenario evidence', async () => {
    const {
      assertionDigest,
      deriveAssertionVerification,
    } = await loadReceiptState();
    const cell = {
      link_id: 'c1',
      assertion_ref: 'tests/a.test.js',
      assertion_revision: 1,
    };
    const legacyPass = {
      id: 'legacy-pass',
      assertion_revision: 1,
      assertion_digest: assertionDigest(cell.assertion_ref),
      verdict: 'PASS',
      completed_at: '2026-07-30T01:00:00Z',
      scenario_count: 0,
      scenario_evidence: {},
    };

    expect(deriveAssertionVerification(cell, [legacyPass])).toMatchObject({
      state: 'never_run',
      verified: false,
      last_verified: null,
    });
  });

  it('latest matching FAIL removes current coverage but preserves historical PASS time', async () => {
    const {
      assertionDigest,
      deriveAssertionVerification,
    } = await loadReceiptState();
    const cell = {
      link_id: 'c1',
      assertion_ref: 'tests/a.test.js',
      assertion_revision: 1,
    };
    const digest = assertionDigest(cell.assertion_ref);
    const receipts = [
      {
        id: 'p1',
        assertion_revision: 1,
        assertion_digest: digest,
        verdict: 'PASS',
        scenario_count: 1,
        scenario_evidence: { kind: 'vitest', passed: 1 },
        completed_at: '2026-07-30T01:00:00Z',
      },
      {
        id: 'f1',
        assertion_revision: 1,
        assertion_digest: digest,
        verdict: 'FAIL',
        completed_at: '2026-07-30T02:00:00Z',
      },
    ];

    expect(deriveAssertionVerification(cell, receipts)).toMatchObject({
      state: 'failed',
      verified: false,
      last_verified: '2026-07-30T01:00:00Z',
    });
  });

  it('excludes semantic and N/A cells from coverage', async () => {
    const { summarizeAssertionCoverage } = await loadReceiptState();
    const summary = summarizeAssertionCoverage([
      {
        runnable: true,
        verification: { verified: true, state: 'verified' },
      },
      {
        runnable: true,
        verification: { verified: false, state: 'never_run' },
      },
      {
        runnable: false,
        assertion_state: 'decision',
        verification: { state: 'not_executable' },
      },
    ]);

    expect(summary).toEqual({
      eligible: 2,
      verified: 1,
      failed: 0,
      never_run: 1,
      percent: 50,
    });
  });

  it('breaks equal timestamps by receipt id with code-point ordering', async () => {
    const {
      assertionDigest,
      deriveAssertionVerification,
    } = await loadReceiptState();
    const cell = {
      link_id: 'c1',
      assertion_ref: 'tests/a.test.js',
      assertion_revision: 1,
    };
    const common = {
      assertion_revision: 1,
      assertion_digest: assertionDigest(cell.assertion_ref),
      completed_at: '2026-07-30T02:00:00Z',
      created_at: '2026-07-30T02:00:01Z',
      verdict: 'PASS',
      scenario_count: 1,
      scenario_evidence: { kind: 'vitest', passed: 1 },
    };

    const verification = deriveAssertionVerification(cell, [
      { ...common, id: 'Z-receipt', run_id: 'run-z' },
      { ...common, id: 'a-receipt', run_id: 'run-a' },
    ]);

    expect(verification).toMatchObject({
      receipt_id: 'a-receipt',
      run_id: 'run-a',
    });
  });
});
