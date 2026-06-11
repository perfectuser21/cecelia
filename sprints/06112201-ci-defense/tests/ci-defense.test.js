import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// sprints/06112201-ci-defense/tests/ → 3 levels up → workspace root
const REPO_ROOT = resolve(__dirname, '../../..');

describe('CI 防线四文件存在性 [BEHAVIOR] — TDD Red', () => {
  it('changed-test-router.mjs 存在于 packages/brain/scripts/ci/', () => {
    const p = resolve(REPO_ROOT, 'packages/brain/scripts/ci/changed-test-router.mjs');
    expect(existsSync(p)).toBe(true);
  });

  it('contract-existence-check.mjs 存在于 packages/brain/scripts/ci/', () => {
    const p = resolve(REPO_ROOT, 'packages/brain/scripts/ci/contract-existence-check.mjs');
    expect(existsSync(p)).toBe(true);
  });

  it('skill-contract.test.js 存在于 packages/brain/src/__tests__/', () => {
    const p = resolve(REPO_ROOT, 'packages/brain/src/__tests__/skill-contract.test.js');
    expect(existsSync(p)).toBe(true);
  });

  it('skill-contract.test.js 含显式 toBe(false) 反向断言（不得用隐式 truthy 检查）', () => {
    const p = resolve(REPO_ROOT, 'packages/brain/src/__tests__/skill-contract.test.js');
    // 文件不存在时 readFileSync 抛出，test 自然 FAIL（TDD Red 阶段正确行为）
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('toBe(false)');
  });

  it('skill-ci.yml 存在于 .github/workflows/ 且含 packages/workflows/skills/** path 触发', () => {
    const p = resolve(REPO_ROOT, '.github/workflows/skill-ci.yml');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf8');
    const lines = content.split('\n').filter(l => !/^\s*#/.test(l));
    const hasPathTrigger = lines.some(l => /^\s+- ['"]?packages\/workflows\/skills\/\*\*['"]?\s*$/.test(l));
    expect(hasPathTrigger).toBe(true);
  });
});
