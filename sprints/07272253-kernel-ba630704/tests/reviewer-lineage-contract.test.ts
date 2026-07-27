import { describe, expect, it } from 'vitest';
import * as dispatcher from '../../../packages/brain/src/orchestrator/dispatcher.js';
import {
  parseHarnessResult,
} from '../../../packages/brain/src/orchestrator/execution-contract.js';

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACT_SHA = 'a'.repeat(40);

function reviewerResult(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'review complete',
    artifacts: [],
    checks: [],
    decision: {
      review: {
        outcome: 'REVISION',
        feedback: [{ id: 'fb-1', text: 'missing recovery proof', rubric_id: 'r-1' }],
        rubric: [{ id: 'r-1', score: 6, max_score: 10 }],
        run_id: RUN_ID,
        round: 1,
        contract_sha: CONTRACT_SHA,
        digest: { version: 'v1', value: `sha256:${'0'.repeat(64)}` },
      },
    },
    error: null,
    provider_metadata: { provider: 'codex', session_id: 'fresh-reviewer-session' },
    ...overrides,
  };
}

describe('Reviewer result channel contract — TDD Red', () => {
  it('只读 ACTION_SPECS 动态获得 attempt 隔离 result channel', () => {
    expect(typeof dispatcher.listReadOnlyActionSpecs).toBe('function');
    expect(typeof dispatcher.createAttemptResultChannel).toBe('function');
  });

  it('HarnessResult v1 绑定并重算 canonical digest', () => {
    expect(() => parseHarnessResult(
      reviewerResult(),
      'reviewer',
      'harness-result/reviewer-v1',
      {
        run_id: RUN_ID,
        round: 1,
        contract_sha: CONTRACT_SHA,
        attempt_id: ATTEMPT_ID,
      },
    )).toThrow(/digest/i);
  });
});
