import { describe, expect, it } from 'vitest';

import { createSmokeIdentity } from '../../scripts/smoke/unified-work-router-smoke-identity.mjs';

describe('Unified Work Router smoke identity', () => {
  it('为同一 Git revision 的连续验收生成隔离的入口与 stale-resume 身份', () => {
    const revision = 'a'.repeat(40);
    const first = createSmokeIdentity(revision, 'first-run');
    const second = createSmokeIdentity(revision, 'second-run');

    expect(first.sourceNamespace).not.toBe(second.sourceNamespace);
    expect(first.titlePrefix).not.toBe(second.titlePrefix);
    expect(first.sourceNamespace).toContain(revision);
    expect(second.sourceNamespace).toContain(revision);
  });
});
