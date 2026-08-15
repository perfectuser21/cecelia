import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { runJudgeGate } from '../harness-judge.js';

const stageFacts = {
  current_stage: 'independent_judge',
  pr_state: 'OPEN',
  pr_merged: false,
  head_sha: 'a'.repeat(40),
  merge_gate_approved: false,
};

function directArtifact(requiredAssertions, contentOverride = null) {
  const content = contentOverride ?? [
    '# Frozen impact assertions',
    '',
    '```json',
    JSON.stringify({
      impact_contract_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      impact_contract_hash: 'b'.repeat(64),
      required_assertions: requiredAssertions,
    }, null, 2),
    '```',
  ].join('\n');
  return {
    type: 'frozen_contract_test',
    path: 'direct-contracts/receipt-1/tests/impact-contract.md',
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    source_sha: 'c'.repeat(40),
  };
}

function evidence() {
  return async () => ({
    contractE2E: '',
    goldenPathSteps: [],
    transcript: 'human exploration completed',
    agentStdout: 'human exploration completed',
    brainResult: {
      verdict: 'PASS',
      behavior_tests: [{ command: 'human exploration', exit_code: 0, log_tail: 'no defect' }],
    },
  });
}

const options = {
  collectEvidence: evidence(),
  mechanicalGateFn: async () => ({ pass: true, reasons: [] }),
  writeFileFn: async () => {},
  listTestFilesFn: async () => ['impact-contract.md'],
};

describe('Direct Profile 独立 Judge 收敛', () => {
  it('逐 required assertion 建 rubric，coverage 少一项即 fail-closed', async () => {
    const artifact = directArtifact([
      {
        assertion_id: 'A1-save',
        command: 'npm test -- save',
        covers_capability_ids: ['save-api'],
      },
      {
        assertion_id: 'A2-reload',
        command: 'npm test -- reload',
        covers_capability_ids: ['reload-api'],
      },
    ]);
    const firstStep = 'required_assertion:A1-save | command:npm test -- save | capabilities:save-api';
    const secondStep = 'required_assertion:A2-reload | command:npm test -- reload | capabilities:reload-api';
    const judgeFn = vi.fn(async () => ({
      verdict: 'PASS',
      coverage: [{
        step: firstStep,
        passed: true,
        deferred: false,
        evidence: 'trusted check A1 exit_code=0',
      }],
      failure_class: null,
      failure_signature: null,
      feedback: null,
    }));

    const result = await runJudgeGate({
      worktreePath: '/tmp/direct-judge',
      instanceLabel: 'direct-judge',
      agentVerdict: 'PASS',
      stageFacts,
      frozenContractArtifacts: [artifact],
    }, { ...options, judgeFn });

    expect(result).toMatchObject({ verdict: 'FAIL', judged: true });
    expect(result.feedback).toContain(secondStep);
    expect(judgeFn).toHaveBeenCalledWith(expect.objectContaining({
      goldenPathSteps: [firstStep, secondStep],
    }), expect.any(Object));
  });

  it('冻结 direct JSON 无法解析时在调用 AI 前按 evidence_invalid 拒绝', async () => {
    const judgeFn = vi.fn();
    const result = await runJudgeGate({
      worktreePath: '/tmp/direct-judge',
      instanceLabel: 'direct-judge',
      agentVerdict: 'PASS',
      stageFacts,
      frozenContractArtifacts: [directArtifact([], '# malformed direct artifact')],
    }, { ...options, judgeFn });

    expect(result).toMatchObject({
      verdict: 'FAIL',
      judged: true,
      failure_class: 'evidence_invalid',
    });
    expect(result.feedback).toContain('Direct Profile rubric');
    expect(judgeFn).not.toHaveBeenCalled();
  });
});
