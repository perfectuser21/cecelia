import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../../../..');

describe('changed-test-router.mjs', () => {
  const scriptPath = join(REPO_ROOT, 'packages/brain/scripts/ci/changed-test-router.mjs');

  it('脚本文件存在', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('对 harness-evaluator SKILL.md 输出含 harness-evaluator.test.ts 路径', () => {
    const output = execSync(
      `node ${scriptPath} --files packages/workflows/skills/harness-evaluator/SKILL.md`,
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    expect(output).toContain('harness-evaluator.test.ts');
  });

  it('对非 skill 路径（server.js）输出空清单，退出码 0', () => {
    const output = execSync(
      `node ${scriptPath} --files packages/brain/src/server.js`,
      { cwd: REPO_ROOT, encoding: 'utf8' }
    ).trim();
    expect(output).toBe('');
  });
});

describe('check-contract-exists.mjs', () => {
  const scriptPath = join(REPO_ROOT, 'packages/brain/scripts/ci/check-contract-exists.mjs');

  it('脚本文件存在', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('传入含 contract-draft.md 的文件清单 → 退出码 0', () => {
    const result = execSync(
      `printf 'sprints/06121716-ci-defense-r6/contract-draft.md\\npackages/brain/src/foo.js\\n' | node ${scriptPath}`,
      { cwd: REPO_ROOT, encoding: 'utf8', shell: '/bin/bash' }
    );
    expect(result).toBeDefined();
  });

  it('传入缺 contract-draft.md 的文件清单 → 非零退出 + stderr 含 contract-draft.md', () => {
    let threw = false;
    let errorOutput = '';
    try {
      execSync(
        `printf 'packages/brain/src/foo.js\\npackages/brain/src/bar.js\\n' | node ${scriptPath}`,
        { cwd: REPO_ROOT, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (e: any) {
      threw = true;
      errorOutput = (e.stderr || '') + (e.stdout || '');
    }
    expect(threw).toBe(true);
    expect(errorOutput).toMatch(/contract-draft\.md/);
  });
});

describe('harness-evaluator.test.ts（新建契约测试）', () => {
  const testPath = join(REPO_ROOT, 'packages/engine/tests/skills/harness-evaluator.test.ts');

  it('文件存在', () => {
    expect(existsSync(testPath)).toBe(true);
  });

  it('含 env_missing 不变量断言（B-1.6 核心）', () => {
    const content = readFileSync(testPath, 'utf8');
    expect(content).toContain('env_missing');
  });

  it('含 B-1.6/B-1.7/B-1.8 步骤断言', () => {
    const content = readFileSync(testPath, 'utf8');
    expect(content).toMatch(/B-1\.[6-8]/);
  });

  it('含无 ws_id 残留断言（1.15.0 修复项）', () => {
    const content = readFileSync(testPath, 'utf8');
    expect(content).toContain('ws_id');
  });

  it('使用 it.skipIf(!skillExists) 模式（与 generator/proposer 测试一致）', () => {
    const content = readFileSync(testPath, 'utf8');
    expect(content).toMatch(/skipIf.*skillExists/);
  });
});

describe('harness-contract-reviewer.test.ts 扩展', () => {
  const testPath = join(REPO_ROOT, 'packages/engine/tests/skills/harness-contract-reviewer.test.ts');

  it('含 7 维度名逐字断言（不在 describe.skip 内）', () => {
    const content = readFileSync(testPath, 'utf8');
    const skipBlocks = (content.match(/describe\.skip\([\s\S]*?\}\);/g) || []).join('');
    const activeContent = content.replace(/describe\.skip\([\s\S]*?\}\);/g, '');
    const dims = [
      'dod_machineability',
      'scope_match_prd',
      'test_is_red',
      'internal_consistency',
      'risk_registered',
      'verification_oracle_completeness',
      'ci_workflow_alignment',
    ];
    for (const d of dims) {
      expect(activeContent, `dimension "${d}" missing in active test blocks`).toContain(d);
    }
    void skipBlocks;
  });
});

describe('harness-generator.test.ts 扩展', () => {
  const testPath = join(REPO_ROOT, 'packages/engine/tests/skills/harness-generator.test.ts');

  it('含无可执行 gh pr merge 断言（v7.5.0 红线）', () => {
    const content = readFileSync(testPath, 'utf8');
    expect(content).toContain('gh pr merge');
  });
});

describe('harness-contract-proposer.test.ts 扩展', () => {
  const testPath = join(REPO_ROOT, 'packages/engine/tests/skills/harness-contract-proposer.test.ts');

  it('含领域验证规则段存在性断言（v9.1 强制）', () => {
    const content = readFileSync(testPath, 'utf8');
    expect(content).toMatch(/领域验证/);
  });
});

describe('ci.yml skills 变更触发扩展', () => {
  const ciPath = join(REPO_ROOT, '.github/workflows/ci.yml');

  it('ci.yml 包含 packages/workflows/skills/** 路径过滤触发器', () => {
    const content = readFileSync(ciPath, 'utf8');
    expect(content).toMatch(/workflows\/skills\/\*\*/);
  });

  it('ci.yml 包含 changed-test-router.mjs 调用', () => {
    const content = readFileSync(ciPath, 'utf8');
    expect(content).toContain('changed-test-router.mjs');
  });

  it('ci.yml 包含 check-contract-exists.mjs 调用', () => {
    const content = readFileSync(ciPath, 'utf8');
    expect(content).toContain('check-contract-exists.mjs');
  });
});
