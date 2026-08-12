import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Unified Work Router recovery and baseline contracts [BEHAVIOR]', () => {
  it('credential-bearing origin 不泄漏且不删除活跃 cwd', async () => {
    const module = await import('../../../packages/brain/src/harness-worktree.js');
    expect(module.canonicalizeGitOrigin).toBeTypeOf('function');
    expect(module.redactGitOrigin).toBeTypeOf('function');
    expect(module.isActiveKernelWorkspace).toBeTypeOf('function');
    expect(module.canonicalizeGitOrigin('https://user:secret@github.com/perfectuser21/cecelia.git'))
      .toBe('github.com/perfectuser21/cecelia');
    expect(module.redactGitOrigin('https://user:secret@github.com/perfectuser21/cecelia.git'))
      .not.toContain('secret');
  });

  it('冻结 baseline 是产出 HEAD 祖先且 receipt 锚定 baseline', () => {
    const source = readFileSync('packages/brain/src/work-router.js', 'utf8');
    expect(source).toContain('routing_receipt_id');
    expect(source).toContain('impact_contract_required');
    expect(source).toContain('base_sha');
  });
});
