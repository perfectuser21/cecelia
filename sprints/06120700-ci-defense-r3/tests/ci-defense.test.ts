import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '../../../../..');
const ROUTER_SCRIPT = resolve(REPO, 'packages/brain/scripts/ci/changed-test-router.mjs');
const EXISTENCE_SCRIPT = resolve(REPO, 'packages/brain/scripts/ci/contract-existence-check.mjs');
const BRAIN_CI_YML = resolve(REPO, '.github/workflows/brain-ci.yml');
const SKILL_DIR = resolve(REPO, 'packages/workflows/skills');

describe('守卫 1 — changed-test-router [BEHAVIOR]', () => {
  it('脚本文件存在', () => {
    expect(existsSync(ROUTER_SCRIPT)).toBe(true);
  });

  it('对 evaluator SKILL.md 输出 ≥ 1 条 test ID', () => {
    const result = spawnSync('node', [ROUTER_SCRIPT, '--files', 'packages/workflows/skills/harness-evaluator/SKILL.md'], {
      encoding: 'utf8',
      cwd: REPO,
    });
    expect(result.status).toBe(0);
    const lines = (result.stdout || '').trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it('输出中包含已知依赖 b31-eval-cookie-isolate（PRD 要求覆盖所有 fs 依赖）', () => {
    const result = spawnSync('node', [ROUTER_SCRIPT, '--files', 'packages/workflows/skills/harness-evaluator/SKILL.md'], {
      encoding: 'utf8',
      cwd: REPO,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('b31-eval-cookie-isolate');
  });

  it('不存在的 skill 文件返回空列表（exit 0，不抛错）', () => {
    const result = spawnSync('node', [ROUTER_SCRIPT, '--files', 'packages/workflows/skills/nonexistent/SKILL.md'], {
      encoding: 'utf8',
      cwd: REPO,
    });
    expect(result.status).toBe(0);
  });
});

describe('守卫 4 — contract-existence-check [BEHAVIOR]', () => {
  it('脚本文件存在', () => {
    expect(existsSync(EXISTENCE_SCRIPT)).toBe(true);
  });

  it('缺 contract-draft.md 时返回非零退出并指明缺失路径', () => {
    const fixture = '/tmp/ci-defense-test-missing.txt';
    writeFileSync(fixture,
      'sprints/06120700-ci-defense-r3/task-plan.json\nsprints/06120700-ci-defense-r3/contract-dod.md\n',
      'utf8'
    );
    const result = spawnSync('node', [EXISTENCE_SCRIPT, '--diff-fixture', fixture], {
      encoding: 'utf8',
      cwd: REPO,
    });
    unlinkSync(fixture);
    expect(result.status).not.toBe(0);
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined).toMatch(/contract-draft\.md/);
  });

  it('含 contract-draft.md 时返回零退出', () => {
    const fixture = '/tmp/ci-defense-test-complete.txt';
    writeFileSync(fixture,
      'sprints/06120700-ci-defense-r3/contract-draft.md\nsprints/06120700-ci-defense-r3/task-plan.json\n',
      'utf8'
    );
    const result = spawnSync('node', [EXISTENCE_SCRIPT, '--diff-fixture', fixture], {
      encoding: 'utf8',
      cwd: REPO,
    });
    unlinkSync(fixture);
    expect(result.status).toBe(0);
  });

  it('非 sprints/ 路径变更不触发检查（exit 0）', () => {
    const fixture = '/tmp/ci-defense-test-nonsprints.txt';
    writeFileSync(fixture,
      'packages/brain/src/foo.js\npackages/brain/src/bar.js\n',
      'utf8'
    );
    const result = spawnSync('node', [EXISTENCE_SCRIPT, '--diff-fixture', fixture], {
      encoding: 'utf8',
      cwd: REPO,
    });
    unlinkSync(fixture);
    expect(result.status).toBe(0);
  });
});

describe('守卫 5 — brain-ci.yml [BEHAVIOR]', () => {
  it('brain-ci.yml 文件存在', () => {
    expect(existsSync(BRAIN_CI_YML)).toBe(true);
  });

  it('brain-ci.yml yaml 语法合法', () => {
    const result = spawnSync('node', ['-e',
      "require('js-yaml').load(require('fs').readFileSync('.github/workflows/brain-ci.yml','utf8')); console.log('ok')"
    ], {
      encoding: 'utf8',
      cwd: REPO,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ok');
  });

  it('brain-ci.yml 包含 packages/workflows/skills 触发路径', () => {
    const result = spawnSync('grep', ['-q', 'packages/workflows/skills', '.github/workflows/brain-ci.yml'], {
      encoding: 'utf8',
      cwd: REPO,
    });
    expect(result.status).toBe(0);
  });

  it('brain-ci.yml 引用 changed-test-router 脚本（确认 CI 执行守卫，而非只配 on.paths）', () => {
    const result = spawnSync('grep', ['-q', 'changed-test-router', '.github/workflows/brain-ci.yml'], {
      encoding: 'utf8',
      cwd: REPO,
    });
    expect(result.status).toBe(0);
  });

  it('brain-ci.yml 引用 skill-contract 测试（确认 CI 执行守卫，而非只配 on.paths）', () => {
    const result = spawnSync('grep', ['-q', 'skill-contract', '.github/workflows/brain-ci.yml'], {
      encoding: 'utf8',
      cwd: REPO,
    });
    expect(result.status).toBe(0);
  });
});

describe('守卫 2 — skill 契约测试套件存在 [ARTIFACT]', () => {
  const CONTRACT_TEST = resolve(REPO, 'packages/workflows/skills/__tests__/skill-contract.test.ts');

  it('skill-contract.test.ts 文件存在', () => {
    expect(existsSync(CONTRACT_TEST)).toBe(true);
  });

  it('覆盖 4 个核心 skill', () => {
    const content = readFileSync(CONTRACT_TEST, 'utf8');
    expect(content).toContain('harness-evaluator');
    expect(content).toContain('harness-contract-reviewer');
    expect(content).toContain('harness-generator');
    expect(content).toContain('harness-contract-proposer');
  });

  it('读取 SKILLS_DIR 环境变量（守卫3篡改测试依赖此接口，禁止硬编码路径）', () => {
    const content = readFileSync(CONTRACT_TEST, 'utf8');
    expect(content).toContain('SKILLS_DIR');
  });
});
