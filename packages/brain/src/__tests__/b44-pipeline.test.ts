// B44 — bug regression test: GAN 改回同步，修复 propose_branch 丢失导致 pipeline 全卡 (#3199)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// vitest 从 packages/brain/ 运行，process.cwd() = packages/brain/
const SRC = resolve(process.cwd(), 'src/workflows/harness-gan.graph.js');

describe('B44 — harness pipeline sync regression [BEHAVIOR]', () => {
  it('harness-gan.graph.js 不含 kickoff:true 返回（WS3 async 回退）', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/kickoff:\s*true/);
  });
  it('runGanContractGraph 返回 propose_branch 字段', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/propose_branch:\s*finalState\.proposeBranch/);
  });
});
