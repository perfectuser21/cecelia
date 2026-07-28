import { describe, expect, it, vi } from 'vitest';

import {
  createPostgresProductionCaseStore,
} from '../kernel-equivalence-production-case-store.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const OWNER = 'brain.kernel_equivalence.production_cases';
const PREFIX = `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/workspace/`;

function caseInput(overrides = {}) {
  return {
    adapter_id: 'kernel.drill.devgate_tdd_dod.v1',
    artifact_sha: 'a'.repeat(40),
    attempt_id: ATTEMPT_ID,
    behavior_id: 'KERNEL-P1-09-DEVGATE-TDD-DOD',
    brain_version: '1.268.16',
    cell_id: 'KERNEL-P1-09-DEVGATE-TDD-DOD::codex::normal',
    engine_version: '19.7.1',
    expires_at: '2026-07-28T12:10:00.000Z',
    provider: 'codex',
    resource_id: 'workspace-1',
    resource_prefix: PREFIX,
    resource_ref: `${PREFIX}workspace-1`,
    resource_type: 'ephemeral_workspace',
    run_id: RUN_ID,
    scenario: 'normal',
    seam_id: 'kernel.quality.devgate',
    ...overrides,
  };
}

function preparedRow(overrides = {}) {
  const input = caseInput();
  return {
    case_id: CASE_ID,
    owner_id: OWNER,
    generation: 1,
    state: 'prepared',
    resource_id: input.resource_id,
    resource_ref: input.resource_ref,
    evidence_ref:
      `db:kernel-equivalence-production-cases/${CASE_ID}/1/prepared`,
    ...overrides,
  };
}

function transactionPool({
  prepareRow = preparedRow(),
  transitionRow = null,
  deadlineOpen = true,
  commitPromise = null,
} = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (text, params) => {
      calls.push({ text, params });
      if (text === 'BEGIN') return { rows: [], rowCount: null };
      if (text === 'ROLLBACK') return { rows: [], rowCount: null };
      if (text === 'COMMIT') {
        if (commitPromise) return commitPromise;
        return { rows: [], rowCount: null };
      }
      if (/set_config\('transaction_timeout'/i.test(text)) {
        return { rows: [{}], rowCount: 1 };
      }
      if (/AS before_deadline/i.test(text)) {
        return {
          rows: [{ before_deadline: deadlineOpen }],
          rowCount: 1,
        };
      }
      if (/INSERT INTO kernel_equivalence_production_cases/i.test(text)) {
        return {
          rows: prepareRow == null ? [] : [prepareRow],
          rowCount: prepareRow == null ? 0 : 1,
        };
      }
      if (/UPDATE kernel_equivalence_production_case_leases/i.test(text)) {
        return {
          rows: transitionRow == null ? [] : [transitionRow],
          rowCount: transitionRow == null ? 0 : 1,
        };
      }
      throw new Error(`unexpected SQL: ${text}`);
    }),
    release: vi.fn(),
  };
  return {
    calls,
    client,
    pool: {
      connect: vi.fn(async () => client),
      query: vi.fn(),
    },
  };
}

describe('PostgreSQL production equivalence case store', () => {
  it('prepares one fully bound case, lease, and event before returning', async () => {
    const runtime = transactionPool();
    const uuids = [CASE_ID, EVENT_ID];
    const store = createPostgresProductionCaseStore({
      pool: runtime.pool,
      randomUUID: () => uuids.shift(),
      now: () => Date.parse('2026-07-28T12:00:00.000Z'),
    });

    await expect(store.prepareCase(caseInput(), {
      timeoutMs: 1_000,
    })).resolves.toEqual({
      case_id: CASE_ID,
      owner_id: OWNER,
      generation: 1,
      state: 'prepared',
      resource_id: 'workspace-1',
      resource_ref: `${PREFIX}workspace-1`,
      evidence_ref:
        `db:kernel-equivalence-production-cases/${CASE_ID}/1/prepared`,
    });

    expect(runtime.calls.map(({ text }) => (
      text.split(/\s+/, 1)[0]
    ))).toEqual(['BEGIN', 'SELECT', 'WITH', 'SELECT', 'COMMIT']);
    const write = runtime.calls[2];
    expect(write.text).toMatch(
      /INSERT INTO kernel_equivalence_production_cases/i,
    );
    expect(write.text).toMatch(
      /INSERT INTO kernel_equivalence_production_case_leases/i,
    );
    expect(write.text).toMatch(
      /INSERT INTO kernel_equivalence_production_case_events/i,
    );
    expect(write.text).toMatch(
      /clock_timestamp\(\)\s*<\s*to_timestamp/i,
    );
    expect(write.params).not.toContain(undefined);
    expect(runtime.client.release).toHaveBeenCalledOnce();
  });

  it.each([
    ['extra field', { caller_secret: 'must-not-enter-db' }],
    ['main resource', {
      resource_prefix: 'refs/heads/main/',
      resource_ref: 'refs/heads/main/case',
    }],
    ['wrong cell axis', { scenario: 'violation' }],
    ['wrong seam', { seam_id: 'caller.seam' }],
    ['expired', { expires_at: '2026-07-28T11:59:59.000Z' }],
  ])('rejects %s before connecting', async (_label, overrides) => {
    const runtime = transactionPool();
    const store = createPostgresProductionCaseStore({
      pool: runtime.pool,
      randomUUID: () => CASE_ID,
      now: () => Date.parse('2026-07-28T12:00:00.000Z'),
    });

    await expect(store.prepareCase(caseInput(overrides)))
      .rejects.toMatchObject({ code: 'production_case_record_invalid' });
    expect(runtime.pool.connect).not.toHaveBeenCalled();
  });

  it('fails closed on conflicting case identity and database deadline', async () => {
    const conflict = transactionPool({ prepareRow: null });
    const conflictStore = createPostgresProductionCaseStore({
      pool: conflict.pool,
      randomUUID: vi.fn()
        .mockReturnValueOnce(CASE_ID)
        .mockReturnValueOnce(EVENT_ID),
      now: () => Date.parse('2026-07-28T12:00:00.000Z'),
    });
    await expect(conflictStore.prepareCase(caseInput()))
      .rejects.toMatchObject({ code: 'production_case_identity_conflict' });

    const expired = transactionPool({ deadlineOpen: false });
    const expiredStore = createPostgresProductionCaseStore({
      pool: expired.pool,
      randomUUID: vi.fn()
        .mockReturnValueOnce(CASE_ID)
        .mockReturnValueOnce(EVENT_ID),
      now: () => Date.parse('2026-07-28T12:00:00.000Z'),
    });
    await expect(expiredStore.prepareCase(caseInput()))
      .rejects.toMatchObject({ code: 'production_case_transaction_timeout' });
  });

  it('reports unknown settlement when abort races an in-flight COMMIT', async () => {
    let resolveCommit;
    const commit = new Promise((resolve) => {
      resolveCommit = resolve;
    });
    const runtime = transactionPool({ commitPromise: commit });
    const controller = new AbortController();
    const store = createPostgresProductionCaseStore({
      pool: runtime.pool,
      randomUUID: vi.fn()
        .mockReturnValueOnce(CASE_ID)
        .mockReturnValueOnce(EVENT_ID),
      now: () => Date.parse('2026-07-28T12:00:00.000Z'),
    });

    const running = store.prepareCase(caseInput(), {
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    await vi.waitFor(() => {
      expect(runtime.client.query).toHaveBeenCalledWith('COMMIT');
    });
    controller.abort();
    resolveCommit({ rows: [], rowCount: null });

    await expect(running).rejects.toMatchObject({
      code: 'production_case_commit_settlement_unknown',
      late_effect_risk: true,
    });
    expect(runtime.client.release).toHaveBeenCalledWith(true);
  });

  it('advances a lease by exact owner, generation, state, and deadline', async () => {
    const transition = {
      case_id: CASE_ID,
      owner_id: OWNER,
      generation: 2,
      state: 'cancelling',
      resource_id: 'workspace-1',
      resource_ref: `${PREFIX}workspace-1`,
      evidence_ref:
        `db:kernel-equivalence-production-cases/${CASE_ID}/2/cancel_requested`,
    };
    const runtime = transactionPool({ transitionRow: transition });
    const store = createPostgresProductionCaseStore({
      pool: runtime.pool,
      randomUUID: () => EVENT_ID,
      now: () => Date.parse('2026-07-28T12:00:00.000Z'),
    });

    await expect(store.transitionCase({
      after_hash: null,
      before_hash: 'b'.repeat(64),
      case_id: CASE_ID,
      event_type: 'cancel_requested',
      evidence_ref: transition.evidence_ref,
      expected_generation: 1,
      from_state: 'prepared',
      late_effect_risk: false,
      lease_expires_at: '2026-07-28T12:05:00.000Z',
      status: 'confirmed',
      to_state: 'cancelling',
    }, { timeoutMs: 1_000 })).resolves.toEqual(transition);

    const write = runtime.calls[2];
    expect(write.text).toMatch(/owner_id\s*=\s*\$\d+/i);
    expect(write.text).toMatch(/generation\s*=\s*\$\d+/i);
    expect(write.text).toMatch(/state\s*=\s*\$\d+/i);
    expect(write.text).toMatch(
      /clock_timestamp\(\)\s*<\s*to_timestamp/i,
    );
  });

  it('distinguishes a stale transition without inventing cleanup', async () => {
    const runtime = transactionPool({ transitionRow: null });
    const store = createPostgresProductionCaseStore({
      pool: runtime.pool,
      randomUUID: () => EVENT_ID,
      now: () => Date.parse('2026-07-28T12:00:00.000Z'),
    });

    await expect(store.transitionCase({
      after_hash: null,
      before_hash: null,
      case_id: CASE_ID,
      event_type: 'cleanup_confirmed',
      evidence_ref:
        `db:kernel-equivalence-production-cases/${CASE_ID}/2/cleanup_confirmed`,
      expected_generation: 1,
      from_state: 'prepared',
      late_effect_risk: false,
      lease_expires_at: null,
      status: 'confirmed',
      to_state: 'cleaned',
    })).rejects.toMatchObject({ code: 'production_case_transition_stale' });
  });
});
