import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 使用 import.meta.url 计算绝对路径（不受 vitest shard CWD 影响）
const __filename = fileURLToPath(import.meta.url);
// sprints/cecelia-b44-harness-pipeline-fix/tests/b44-pipeline.test.ts → 向上 5 层到 repo root
const REPO_ROOT = resolve(__filename, '..', '..', '..', '..', '..');
const SRC = resolve(REPO_ROOT, 'packages/brain/src/workflows/harness-gan.graph.js');

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
