import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const sprintDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(sprintDir, 'scripts', 'verify-pr4457-evidence.mjs');

function run(phase: string) {
  return spawnSync(process.execPath, [verifier, phase], {
    cwd: path.resolve(sprintDir, '../..'),
    encoding: 'utf8',
  });
}

describe('PR #4457 contract [BEHAVIOR]', () => {
  it('冻结清单精确绑定起点与计数', () => {
    const result = run('freeze');
    expect(result.status, result.stderr).toBe(0);
  });

  it('冲突处置与累计行为证明完整', () => {
    const result = run('conflicts');
    expect(result.status, result.stderr).toBe(0);
  });

  it('77 个 CodeQL 告警逐项收敛', () => {
    const result = run('codeql');
    expect(result.status, result.stderr).toBe(0);
  });

  it('atomic truth 与安全不变量保持', () => {
    const result = run('invariants');
    expect(result.status, result.stderr).toBe(0);
  });

  it('required checks 全部绑定最终 SHA', () => {
    const result = run('exact-head');
    expect(result.status, result.stderr).toBe(0);
  });

  it('evaluator 在同一最终 SHA 真跑', () => {
    const result = run('evaluator');
    expect(result.status, result.stderr).toBe(0);
  });

  it('PR 始终停在 Draft OPEN 人工审阅门', () => {
    const result = run('review-gate');
    expect(result.status, result.stderr).toBe(0);
  });
});

