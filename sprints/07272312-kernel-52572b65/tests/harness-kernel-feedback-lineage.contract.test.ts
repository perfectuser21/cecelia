import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseHarnessResult,
  parseTaskBundle,
} from '../../../packages/brain/src/orchestrator/execution-contract.js';
import { mergeGate } from '../../../packages/brain/src/orchestrator/gates.js';
import { createDetachedLauncher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';
const taskId = '33333333-3333-4333-8333-333333333333';
const sha = 'a'.repeat(40);

function result(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'completed',
    summary: 'reviewed',
    artifacts: [],
    checks: [],
    decision: {
      outcome: 'REVISION',
      review: {
        outcome: 'REVISION',
        feedback: [{ id: 'F1', text: 'fix lineage' }],
        rubric: [{ id: 'R1', score: 9, max_score: 10, evidence: 'real route' }],
        binding: { attempt_id: attemptId, run_id: runId, task_id: taskId, round: 1, contract_sha: sha },
        digest: '0'.repeat(64),
      },
    },
    error: null,
    provider_metadata: { provider: 'codex', session_id: 'fresh-1' },
    ...overrides,
  };
}

describe('P0 Kernel Feedback Lineage Recovery 3 business Red', () => {
  it('[B1] external result channel isolation', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kernel-result-red-'));
    const launches: Array<Record<string, any>> = [];
    const launcher = createDetachedLauncher({
      sessionRoot: root,
      attemptStore: { fail: async () => ({ attempt: null }) } as any,
      removeContainer: async () => true,
      spawnDetached: async (input: Record<string, any>) => {
        launches.push(input);
        return { containerId: input.containerId };
      },
    });
    try {
      for (const [id, role] of [
        [attemptId, 'reviewer'],
        ['44444444-4444-4444-8444-444444444444', 'reporter'],
      ]) {
        await launcher.launch({
          attempt: {
            id, run_id: runId, hop: 2, role,
            callbackSecret: 'secret', lease_owner: 'owner', lease_generation: 1,
          },
          bundle: {
            inputs: { task_id: taskId, worktree_path: '/workspace' },
            constraints: { read_only: true },
          },
          spec: { provider: 'codex', env: {}, args: [], stdin: '{}' },
          task: {},
          leaseClaimed: true,
        } as any);
      }
      expect(launches.map((launch) => launch.env.BRAIN_RESULT_FILE)).toHaveLength(2);
      expect(new Set(launches.map((launch) => launch.env.BRAIN_RESULT_FILE)).size).toBe(2);
      expect(launches.every((launch) => launch.readOnlyWorktree === true)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('[B2] bounded HarnessResult v1 review', () => {
    expect(() => parseHarnessResult(result({
      decision: {
        outcome: 'REVISION',
        review: {
          ...((result().decision as Record<string, any>).review),
          feedback: [{ id: 'F1', text: 'x'.repeat(2001) }],
        },
      },
    }), 'reviewer')).toThrow(/invalid_result|2000|feedback/i);
  });

  it('[B3] real callback transaction', () => {
    const parsed = parseHarnessResult(result(), 'reviewer');
    expect((parsed.decision as Record<string, any>).review.digest).not.toBe('0'.repeat(64));
    expect((parsed.decision as Record<string, any>).review.binding.run_id).toBe(runId);
  });

  it('[B4] exact prior_review lineage', () => {
    const bundle = {
      contract_version: '1.0',
      run_id: runId,
      attempt_id: attemptId,
      hop: 3,
      phase: 'gan',
      role: 'proposer',
      objective: 'revise the frozen contract',
      inputs: {
        task_id: taskId,
        sprint_dir: 'sprints/x',
        worktree_path: '/workspace',
        artifacts: [],
        contract_round: 2,
      },
      constraints: { read_only: false, fresh_session: true, timeout_seconds: 60 },
      expected_output: 'harness-result/proposer-v1',
    };
    expect(() => parseTaskBundle(bundle)).toThrow(/prior_review|lineage/i);
  });

  it('[B5] final SHA merge gate', () => {
    expect(mergeGate({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: sha },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: sha },
      prHeadSha: sha,
      reviewRequired: true,
      reviewApproved: true,
    })).toEqual({ allow: false, reason: 'human_approval_binding_missing' });
  });
});
