import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const sprintDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(sprintDir, '../..');
const verifier = path.join(sprintDir, 'scripts', 'verify-pr4457-evidence.mjs');

async function run(phase: string) {
  return await Promise.resolve(spawnSync(process.execPath, [verifier, phase], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, EXPECTED_PR: '4457' },
  }));
}

describe('PR #4457 contract [BEHAVIOR]', () => {
  it('冻结身份与全部 subject 精确匹配', async () => {
    const result = await run('freeze');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('全部 33 个冲突路径完成行为验证', async () => {
    const result = await run('conflicts');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('全部 77 条 CodeQL annotation 收敛', async () => {
    const result = await run('codeql');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('累计 Kernel Harness 行为与 atomic truth 保持', async () => {
    const result = await run('regressions');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('三个 required checks 绑定同一最终 SHA', async () => {
    const result = await run('exact-head');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('evaluator 在同一最终 SHA 真跑', async () => {
    const result = await run('evaluator');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('审计窗内无新 PR 无 merge 无 deploy', async () => {
    const result = await run('review-gate');
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
