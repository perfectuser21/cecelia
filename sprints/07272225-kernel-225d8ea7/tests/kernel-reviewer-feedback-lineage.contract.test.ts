import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const RCI = 'scripts/harness/rci-reviewer-feedback-lineage.sh';
const scratch: string[] = [];
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_SHA = 'a'.repeat(40);

function reviewResult() {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'review complete',
    artifacts: [],
    checks: [],
    decision: {
      outcome: 'REVISION',
      reason: 'resolve FB-001',
      review: {
        run_id: RUN_ID,
        round: 1,
        contract_sha: CONTRACT_SHA,
        digest: 'd'.repeat(64),
        feedback: [{ id: 'FB-001', text: 'fix lineage', evidence: 'missing prior review' }],
        rubric: {
          dod_machineability: 8,
          scope_match_prd: 8,
          test_is_red: 8,
          internal_consistency: 8,
          risk_registered: 8,
          verification_oracle_completeness: 8,
          ci_workflow_alignment: 8,
        },
      },
    },
    error: null,
    provider_metadata: { provider: 'codex', session_id: 'fresh-reviewer-r1' },
  };
}

afterEach(async () => {
  const resultChannel = await import(
    '../../../packages/brain/src/orchestrator/result-channel.js'
  ).catch(() => null);
  for (const root of scratch.splice(0)) {
    resultChannel?.cleanupAttemptResultChannel?.({ rootDir: root, ignoreMissing: true });
  }
});

describe('Kernel reviewer feedback lineage contract [BEHAVIOR]', () => {
  it('attempt-scoped result channel 拒绝逃逸、symlink 与跨 attempt', async () => {
    const channelApi = await import(
      '../../../packages/brain/src/orchestrator/result-channel.js'
    );
    const dispatcher = await import(
      '../../../packages/brain/src/orchestrator/dispatcher.js'
    );
    for (const action of ['spawn:reviewer', 'spawn:canary', 'spawn:judge']) {
      const spec = dispatcher.resolveAction(action);
      expect(spec.readOnly).toBe(true);
      const bundle = dispatcher.__test__.buildBundle(
        action,
        spec,
        {
          runId: RUN_ID,
          hop: 1,
          taskId: ATTEMPT_ID,
          worktreePath: '/workspace',
          decision: { phase: 'gan' },
          observed: {
            proposeBranchRn: 1,
            proposeBranchSha: CONTRACT_SHA,
            task: {
              id: ATTEMPT_ID,
              title: 'result channel contract',
              payload: { sprint_dir: 'sprints/test', worktree_path: '/workspace' },
            },
          },
        },
        ATTEMPT_ID,
        null,
        {
          logicalCycleId: `intent:${RUN_ID}:1`,
          attemptKind: 'initial',
          workstreamKey: 'ws1',
        },
      );
      expect(bundle.constraints).toMatchObject({
        read_only: true,
        result_channel: {
          version: 'attempt-result/v1',
          required: true,
        },
      });
    }
    const rootDir = mkdtempSync(path.join(tmpdir(), 'review-result-channel-'));
    scratch.push(rootDir);
    const own = channelApi.createAttemptResultChannel({
      rootDir,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
    });
    const other = channelApi.createAttemptResultChannel({
      rootDir,
      runId: RUN_ID,
      attemptId: OTHER_ATTEMPT_ID,
    });

    writeFileSync(own.hostFile, JSON.stringify(reviewResult()), { mode: 0o600 });
    expect(await channelApi.consumeAttemptResultChannel({
      channel: own,
      expected: { runId: RUN_ID, attemptId: ATTEMPT_ID },
    })).toMatchObject({ result: { attempt_id: ATTEMPT_ID } });

    symlinkSync(own.hostFile, other.hostFile);
    await expect(channelApi.consumeAttemptResultChannel({
      channel: other,
      expected: { runId: RUN_ID, attemptId: OTHER_ATTEMPT_ID },
    })).rejects.toThrow(/symlink|attempt|channel/i);
    await expect(channelApi.consumeAttemptResultChannel({
      channel: { ...own, hostFile: path.join(rootDir, '..', 'escaped.json') },
      expected: { runId: RUN_ID, attemptId: ATTEMPT_ID },
    })).rejects.toThrow(/escape|path|channel/i);
  });

  it('callback error 返回精确稳定 shape 且不反射 forbidden fields', async () => {
    const errors = await import(
      '../../../packages/brain/src/orchestrator/reviewer-result-errors.js'
    );
    const cases = [
      [400, 'invalid_result', 'REVIEW_RESULT_INVALID'],
      [401, 'unauthorized', 'ATTEMPT_CREDENTIAL_INVALID'],
      [404, 'not_found', 'ATTEMPT_NOT_FOUND'],
      [409, 'attempt_conflict', 'ATTEMPT_SCOPE_MISMATCH'],
      [409, 'lineage_missing', 'PRIOR_REVIEW_MISSING'],
    ] as const;
    for (const [status, key, code] of cases) {
      const formatted = errors.reviewerResultError(status, key, code, {
        secret: 'MUST_NOT_REFLECT',
        transcript: 'MUST_NOT_REFLECT',
        chain_of_thought: 'MUST_NOT_REFLECT',
      });
      expect(formatted).toEqual({
        status,
        body: { ok: false, error: { key, code } },
      });
      expect(JSON.stringify(formatted)).not.toContain('MUST_NOT_REFLECT');
    }
  });

  it('round 2 注入 exact prior_review 与一一对应 resolution_map', async () => {
    const lineageApi = await import(
      '../../../packages/brain/src/orchestrator/feedback-lineage.js'
    );
    const bound = lineageApi.bindReviewerResult(reviewResult(), {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });
    const next = lineageApi.buildNextRoundLineage({
      nextRound: 2,
      priorReview: bound,
      resolutionMap: [{
        feedback_id: 'FB-001',
        status: 'resolved',
        evidence: `${CONTRACT_SHA}:contract-draft.md`,
      }],
    });

    expect(next.proposer.prior_review).toEqual(next.reviewer.prior_review);
    expect(next.proposer.prior_review).toMatchObject({
      state: 'bound',
      source_attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      round: 1,
      contract_sha: CONTRACT_SHA,
    });
    expect(next.reviewer.resolution_map.map((item: { feedback_id: string }) => item.feedback_id))
      .toEqual(['FB-001']);
    expect(lineageApi.noHistory({ round: 1, legacy: false }))
      .toEqual({ state: 'no-history', reason: 'first-round' });
    expect(lineageApi.noHistory({ round: 2, legacy: true }))
      .toEqual({ state: 'no-history', reason: 'legacy-unbound' });
    expect(() => lineageApi.buildNextRoundLineage({
      nextRound: 2,
      priorReview: null,
      resolutionMap: [],
    })).toThrow(/PRIOR_REVIEW_MISSING|lineage/i);
  });

  it('APPROVED 仍由 current-head 人工 authority 阻断 release', async () => {
    const lineageApi = await import(
      '../../../packages/brain/src/orchestrator/feedback-lineage.js'
    );
    const approved = reviewResult();
    approved.decision.outcome = 'APPROVED';
    const bound = lineageApi.bindReviewerResult(approved, {
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      round: 1,
      contractSha: CONTRACT_SHA,
    });

    expect(lineageApi.projectReleaseAuthority({
      review: bound,
      reviewRequired: true,
      currentHeadSha: CONTRACT_SHA,
      humanApproval: null,
    })).toEqual({ merge_allowed: false, deploy_allowed: false });
    expect(lineageApi.projectReleaseAuthority({
      review: bound,
      reviewRequired: true,
      currentHeadSha: CONTRACT_SHA,
      humanApproval: { approved: true, pr_head_sha: 'b'.repeat(40) },
    })).toEqual({ merge_allowed: false, deploy_allowed: false });
  });

  it('Generator 交付的 RCI 先过 bash -n 再真实执行', () => {
    expect(existsSync(RCI), `${RCI} 是 Generator artifact，Red 阶段应因尚未交付而 FAIL`)
      .toBe(true);
    execFileSync('bash', ['-n', RCI], { stdio: 'pipe' });
    const source = readFileSync(RCI, 'utf8');
    for (const token of [
      'TEST_DATABASE_URL',
      'current_database()',
      'inet_server_addr()',
      'RESULT_CHANNEL_PASS',
      'CALLBACK_PASS',
      'LINEAGE_PASS',
      'ISOLATION_PASS',
      'AUTHORITY_PASS',
    ]) {
      expect(source).toContain(token);
    }
    expect(source).not.toMatch(/postgresql:\/\/localhost\/cecelia|DB_URL:-/);
  });
});
