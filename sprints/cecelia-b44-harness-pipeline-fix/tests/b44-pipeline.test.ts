import { describe, it, expect } from 'vitest';

// B44: GAN 改回同步后，runGanContractGraph 必须返回 propose_branch
// 这是 Red commit — propose_branch 还未实现时，检查源码中的 kickoff:true 仍在
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(process.cwd(), 'packages/brain/src/workflows/harness-gan.graph.js');

describe('B44 — harness pipeline sync regression [BEHAVIOR] (Red)', () => {
  it('harness-gan.graph.js 不含 kickoff:true 返回（WS3 async 回退）', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/kickoff:\s*true/);
  });

  it('runGanContractGraph 返回 propose_branch 字段', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/propose_branch:\s*finalState\.proposeBranch/);
  });
});
