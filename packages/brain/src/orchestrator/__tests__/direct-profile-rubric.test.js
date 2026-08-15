import { describe, expect, it } from 'vitest';

import { parseDirectProfileAssertionRubric } from '../direct-profile-rubric.js';

function artifact(requiredAssertions) {
  return {
    type: 'frozen_contract_test',
    path: 'direct-contracts/receipt-1/tests/impact-contract.md',
    content: [
      '# Frozen impact assertions',
      '',
      '```json',
      JSON.stringify({
        impact_contract_id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        impact_contract_hash: 'a'.repeat(64),
        required_assertions: requiredAssertions,
      }, null, 2),
      '```',
    ].join('\n'),
  };
}

describe('direct profile Judge rubric', () => {
  it('从冻结 impact-contract JSON 为每条 required assertion 生成独立服务端 step', () => {
    const result = parseDirectProfileAssertionRubric([artifact([
      {
        assertion_id: 'A1-save',
        command: 'npm test -- save',
        covers_capability_ids: ['save-api', 'task-state'],
      },
      {
        assertion_id: 'A2-reload',
        command: 'npm test -- reload',
        covers_capability_ids: ['reload-api'],
      },
    ])]);

    expect(result).toEqual({
      matched: true,
      steps: [
        'required_assertion:A1-save | command:npm test -- save | capabilities:save-api,task-state',
        'required_assertion:A2-reload | command:npm test -- reload | capabilities:reload-api',
      ],
    });
  });

  it.each([
    ['没有 fenced JSON', { ...artifact([]), content: '# no json' }],
    ['required_assertions 为空', artifact([])],
    ['断言 ID 重复', artifact([
      { assertion_id: 'A1', command: 'npm test -- a', covers_capability_ids: ['cap-a'] },
      { assertion_id: 'A1', command: 'npm test -- b', covers_capability_ids: ['cap-b'] },
    ])],
    ['capability 为空', artifact([
      { assertion_id: 'A1', command: 'npm test -- a', covers_capability_ids: [] },
    ])],
  ])('direct artifact %s 时 fail-closed', (_label, invalidArtifact) => {
    expect(() => parseDirectProfileAssertionRubric([invalidArtifact])).toThrowError(
      expect.objectContaining({ code: 'DIRECT_PROFILE_JUDGE_RUBRIC_INVALID' }),
    );
  });

  it('普通冻结测试不误识别成 direct profile', () => {
    expect(parseDirectProfileAssertionRubric([{
      type: 'frozen_contract_test',
      path: 'sprints/x/tests/e2e.test.js',
      content: 'test content',
    }])).toEqual({ matched: false, steps: [] });
  });
});
