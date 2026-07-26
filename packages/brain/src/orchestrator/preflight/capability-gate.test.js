import { describe, expect, it } from 'vitest';

import {
  buildCapabilityEvidence,
  classifyExecutionFailure,
  parseCapabilityRequirements,
} from './capability-gate.js';

describe('capability gate stable helpers', () => {
  it('解析冻结 requirements 并递归脱敏结构化 evidence', () => {
    expect(parseCapabilityRequirements({
      contract_requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output'],
      },
    })).toEqual({
      provider_auth: true,
      github: true,
      postgres: true,
      model_capabilities: ['structured_output'],
    });

    expect(buildCapabilityEvidence({
      authorization: 'Bearer secret',
      nested: { token: 'secret-token', signature: 'http_503' },
    })).toEqual({
      authorization: '[REDACTED]',
      nested: { token: '[REDACTED]', signature: 'http_503' },
    });
  });

  it('能力匹配后的产品失败进入 generator-fix', () => {
    expect(classifyExecutionFailure({
      capability_matched: true,
      provider_result: { exit_code: 1 },
    })).toMatchObject({
      failure_class: 'product_failure',
      action: 'generator-fix',
      should_enter_generator_fix: true,
    });
  });
});

