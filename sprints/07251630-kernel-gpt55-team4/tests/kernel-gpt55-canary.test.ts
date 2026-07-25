import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const docPath = resolve(repoRoot, 'docs/fire-drills/kernel-v1-gpt55-team4-20260725.md');

function readDoc(): string {
  expect(existsSync(docPath), 'fire-drill doc must exist before content checks').toBe(true);
  return readFileSync(docPath, 'utf8');
}

describe('Kernel v1 GPT-5.5 team4 canary fire-drill doc [BEHAVIOR]', () => {
  it('fire-drill 文档存在并记录 task/run/model/roles', () => {
    const doc = readDoc();
    for (const required of [
      '6449cebb-8f6f-4561-ba5f-350691bd6cec',
      'ee037a92-8061-4729-a67b-cc9fc7d9db56',
      'gpt-5.5',
      'planner',
      'proposer',
      'reviewer',
      'generator',
      'evaluator',
      'provider=codex',
      'account=team4',
    ]) {
      expect(doc).toContain(required);
    }
  });

  it('fire-drill 文档记录 PR URL 与 verdict 字段', () => {
    const doc = readDoc();
    expect(doc).toMatch(/PR URL/i);
    expect(doc).toMatch(/https:\/\/github\.com\/.+\/pull\/\d+/);
    expect(doc).toMatch(/evaluator/i);
    expect(doc).toMatch(/judge/i);
    expect(doc).toContain('deepseek-v4-flash');
  });

  it('fire-drill 文档不得泄露 secret', () => {
    const doc = readDoc();
    expect(doc).not.toMatch(/ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghs_[A-Za-z0-9]+|github_pat_|sk-[A-Za-z0-9]{20,}/);
  });
});
