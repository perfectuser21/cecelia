import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const CONTENT = '# Trusted PRD\n';
const PATH = 'sprints/08150001-recovery/sprint-prd.md';
const CHANGED_FILES = [PATH];
const EVIDENCE = Object.freeze({
  repo: 'perfectuser21/cecelia',
  base_sha: 'a'.repeat(40),
  head_sha: 'b'.repeat(40),
  prd_path: PATH,
  resolved_branch: 'cp-harness-prd-22222222-a4',
  content: CONTENT,
  content_sha256: createHash('sha256').update(Buffer.from(CONTENT)).digest('hex'),
  byte_length: Buffer.byteLength(CONTENT),
  changed_files: CHANGED_FILES,
  changed_files_digest: createHash('sha256')
    .update(JSON.stringify(CHANGED_FILES))
    .digest('hex'),
  verification_method: 'remote_exact_commit_blob',
  verified_at: '2026-08-15T00:00:00.000Z',
});

function terminalAttempt(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    run_id: '11111111-1111-4111-8111-111111111111',
    hop: 4,
    role: 'planner',
    status: 'completed',
    lease_generation: 3,
    execution_transport: 'fleet-worker',
    requested_machine_id: 'xian-mac-m4',
    actual_machine_id: 'xian-mac-m4',
    machine_attestation_status: 'verified',
    result: RESULT,
    task_bundle: {
      inputs: {
        task_id: '33333333-3333-4333-8333-333333333333',
        sprint_dir: 'sprints/08150001-recovery',
        planner_branch: EVIDENCE.resolved_branch,
        workspace_spec: { repo: EVIDENCE.repo, base_sha: EVIDENCE.base_sha },
      },
    },
    ...overrides,
  };
}

const RESULT = {
  status: 'completed',
  server_verification: {
    planner_recovery_receipt: {
      head_sha: EVIDENCE.head_sha,
      content_sha256: EVIDENCE.content_sha256,
      byte_length: EVIDENCE.byte_length,
      changed_files_digest: EVIDENCE.changed_files_digest,
      verification_method: EVIDENCE.verification_method,
    },
  },
};

describe('planner recovery receipt store', () => {
  it('derives every identity from the terminal Attempt and exact evidence', async () => {
    const { persistPlannerRecoveryReceipt } = await import(
      '../planner-recovery-receipt-store.js'
    );
    const expectedRow = {
      id: '44444444-4444-4444-8444-444444444444',
      predecessor_run_id: terminalAttempt().run_id,
      source_task_id: terminalAttempt().task_bundle.inputs.task_id,
      planner_attempt_id: terminalAttempt().id,
      attempt_hop: 4,
      lease_generation: 3,
      ...EVIDENCE,
      changed_files: CHANGED_FILES,
      created_at: '2026-08-15T00:00:01.000Z',
    };
    const client = { query: vi.fn(async () => ({ rows: [expectedRow] })) };

    const row = await persistPlannerRecoveryReceipt(client, {
      terminalAttempt: terminalAttempt(),
      result: RESULT,
      exactEvidence: EVIDENCE,
    });

    expect(row).toEqual(expectedRow);
    expect(client.query).toHaveBeenCalledOnce();
    const [, values] = client.query.mock.calls[0];
    expect(values).toEqual([
      terminalAttempt().run_id,
      terminalAttempt().task_bundle.inputs.task_id,
      terminalAttempt().id,
      4,
      3,
      EVIDENCE.repo,
      EVIDENCE.base_sha,
      EVIDENCE.head_sha,
      EVIDENCE.prd_path,
      EVIDENCE.resolved_branch,
      EVIDENCE.content,
      EVIDENCE.content_sha256,
      EVIDENCE.byte_length,
      JSON.stringify(CHANGED_FILES),
      EVIDENCE.changed_files_digest,
      EVIDENCE.verification_method,
      EVIDENCE.verified_at,
    ]);
  });

  it.each([
    ['non-planner', terminalAttempt({ role: 'generator' }), RESULT],
    ['non-success', terminalAttempt({ status: 'failed' }), { ...RESULT, status: 'failed' }],
    ['local docker', terminalAttempt({ execution_transport: 'local-docker' }), RESULT],
  ])('does not grant a receipt to %s callbacks', async (_label, attempt, result) => {
    const { persistPlannerRecoveryReceipt } = await import(
      '../planner-recovery-receipt-store.js'
    );
    const client = { query: vi.fn() };
    await expect(persistPlannerRecoveryReceipt(client, {
      terminalAttempt: attempt,
      result,
      exactEvidence: EVIDENCE,
    })).resolves.toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('fails closed with the stable 409 code when exact evidence is incomplete', async () => {
    const { persistPlannerRecoveryReceipt } = await import(
      '../planner-recovery-receipt-store.js'
    );
    await expect(persistPlannerRecoveryReceipt({ query: vi.fn() }, {
      terminalAttempt: terminalAttempt(),
      result: RESULT,
      exactEvidence: { ...EVIDENCE, content: undefined },
    })).rejects.toMatchObject({
      code: 'planner_recovery_receipt_evidence_invalid',
      httpStatus: 409,
    });
  });

  it('rejects a recovery receipt whose planner branch contains a slash', async () => {
    const { persistPlannerRecoveryReceipt } = await import(
      '../planner-recovery-receipt-store.js'
    );
    const slashBranch = 'cp-harness/prd';
    const result = structuredClone(RESULT);
    const attempt = terminalAttempt({
      result,
      task_bundle: {
        inputs: {
          ...terminalAttempt().task_bundle.inputs,
          planner_branch: slashBranch,
        },
      },
    });

    await expect(persistPlannerRecoveryReceipt({ query: vi.fn() }, {
      terminalAttempt: attempt,
      result,
      exactEvidence: { ...EVIDENCE, resolved_branch: slashBranch },
    })).rejects.toMatchObject({
      code: 'planner_recovery_receipt_evidence_invalid',
      httpStatus: 409,
    });
  });

  it('accepts an exact retry only when every sealed field is equal', async () => {
    const { persistPlannerRecoveryReceipt } = await import(
      '../planner-recovery-receipt-store.js'
    );
    const sealed = {
      predecessor_run_id: terminalAttempt().run_id,
      source_task_id: terminalAttempt().task_bundle.inputs.task_id,
      planner_attempt_id: terminalAttempt().id,
      attempt_hop: 4,
      lease_generation: 3,
      ...EVIDENCE,
      changed_files: [...CHANGED_FILES],
    };
    const exactClient = { query: vi.fn(async () => ({ rows: [sealed] })) };
    await expect(persistPlannerRecoveryReceipt(exactClient, {
      terminalAttempt: terminalAttempt(),
      result: RESULT,
      exactEvidence: EVIDENCE,
    })).resolves.toEqual(sealed);

    const divergentClient = {
      query: vi.fn(async () => ({ rows: [{ ...sealed, head_sha: 'c'.repeat(40) }] })),
    };
    await expect(persistPlannerRecoveryReceipt(divergentClient, {
      terminalAttempt: terminalAttempt(),
      result: RESULT,
      exactEvidence: EVIDENCE,
    })).rejects.toMatchObject({
      code: 'planner_recovery_receipt_evidence_invalid',
      httpStatus: 409,
    });
  });
});
