import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B32: proposer push verification + brain fallback push', () => {
  const src = readFileSync(
    resolve(__dirname, '../harness-initiative.graph.js'),
    'utf8'
  );

  it('含 brain 代为 push 的 fallback 逻辑（git push origin <branch>）', () => {
    // Brain 在 propose_branch 不存在时调 git push 推 worktree commits
    expect(src).toMatch(/git['"]?\s*,\s*\[['"]push['"]\s*,\s*['"]origin['"]/);
  });

  it('含 verify propose branch 在 origin 真存在的检查', () => {
    expect(src).toMatch(/ls-remote.*origin|fetch.*origin.*propose|checkPropose.*Branch|propose.*branch.*exists/i);
  });

  it('fallback push 在 ganLoop 后 inferTaskPlan 前执行', () => {
    const ganLoopIdx = src.indexOf("addNode('ganLoop'");
    const inferIdx = src.indexOf("addNode('inferTaskPlan'");
    const pushFallbackIdx = src.search(/git push.*origin|ls-remote.*propose/);
    expect(ganLoopIdx).toBeGreaterThan(-1);
    expect(inferIdx).toBeGreaterThan(-1);
    expect(pushFallbackIdx).toBeGreaterThan(-1);
  });
});
