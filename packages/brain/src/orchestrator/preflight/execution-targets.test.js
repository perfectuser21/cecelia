import { describe, expect, it } from 'vitest';

import {
  isVerifiedExecutionTarget,
  listVerifiedExecutionTargets,
} from './execution-targets.js';

describe('ExecutionTarget matrix', () => {
  it('只放行 18 个已验证 provider/account/machine 组合', () => {
    const targets = listVerifiedExecutionTargets();
    expect(targets).toHaveLength(18);
    expect(targets.every(isVerifiedExecutionTarget)).toBe(true);
    expect(isVerifiedExecutionTarget({
      provider: 'claude',
      account: 'account1',
      machine: 'xian-mac-m4',
    })).toBe(false);
  });
});

