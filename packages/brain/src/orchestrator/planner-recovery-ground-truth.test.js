import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { loadPlannerRecoveryPrdAuthority } from './planner-recovery-ground-truth.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

describe('Planner Recovery Ground Truth', () => {
  it('普通 run 不读取 recovery receipt', async () => {
    const pool = { query: vi.fn() };
    await expect(loadPlannerRecoveryPrdAuthority(pool, {
      run: { created_source: 'kernel_dispatch' },
      taskId: '11111111-1111-4111-8111-111111111111',
    })).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('只从 exact receipt 构造 verified Planner artifact', async () => {
    const content = '# Trusted PRD\n';
    const path = 'sprints/08150000-trusted/sprint-prd.md';
    const changedFiles = [path];
    const taskId = '11111111-1111-4111-8111-111111111111';
    const sourceTaskId = '22222222-2222-4222-8222-222222222222';
    const predecessorRunId = '33333333-3333-4333-8333-333333333333';
    const receiptId = '44444444-4444-4444-8444-444444444444';
    const initiativeId = '55555555-5555-4555-8555-555555555555';
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{
        id: receiptId,
        predecessor_run_id: predecessorRunId,
        source_task_id: sourceTaskId,
        successor_task_id: taskId,
        predecessor_task_id: sourceTaskId,
        initiative_id: initiativeId,
        predecessor_phase: 'failed',
        orchestrator_version: 'v2',
        record_trust_status: 'trusted',
        source_task_status: 'failed',
        verification_method: 'remote_exact_commit_blob',
        base_sha: 'a'.repeat(40),
        head_sha: 'b'.repeat(40),
        content,
        byte_length: Buffer.byteLength(content),
        content_sha256: sha256(Buffer.from(content)),
        changed_files: changedFiles,
        changed_files_digest: sha256(JSON.stringify(changedFiles)),
        prd_path: path,
        repo: 'perfectuser21/cecelia',
        resolved_branch: 'cp-trusted-planner',
      }] }),
    };

    const authority = await loadPlannerRecoveryPrdAuthority(pool, {
      run: {
        created_source: 'planner_recovery',
        planner_recovery_receipt_id: receiptId,
        predecessor_run_id: predecessorRunId,
        initiative_id: initiativeId,
      },
      taskId,
    });

    expect(authority.artifact).toMatchObject({
      kind: 'planner_prd',
      path,
      head_sha: 'b'.repeat(40),
      verification_status: 'verified',
    });
    expect(authority.evidence).toMatchObject({
      source: 'planner_recovery_receipt',
      receipt_id: receiptId,
    });
  });
});
