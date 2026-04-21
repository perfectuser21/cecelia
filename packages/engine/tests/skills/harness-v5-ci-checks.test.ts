import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../../../..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/harness-v5-checks.yml');

describe('harness-v5 CI checks 结构', () => {
  it('workflow 文件存在', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : '';

  it('workflow 包含 4 个 job：dod-structure-purity / test-coverage / tdd-commit-order / tests-actually-pass', () => {
    expect(workflow).toMatch(/^\s*dod-structure-purity:/m);
    expect(workflow).toMatch(/^\s*test-coverage-for-behavior:/m);
    expect(workflow).toMatch(/^\s*tdd-commit-order:/m);
    expect(workflow).toMatch(/^\s*tests-actually-pass:/m);
  });

  it('workflow 4 个 job 初始 continue-on-error: true（软门禁，1 周观察期）', () => {
    // v5 初上线软门禁避免误杀
    const softCount = (workflow.match(/continue-on-error:\s*true/g) || []).length;
    expect(softCount).toBeGreaterThanOrEqual(4);
  });

  it('workflow 只在 sprints/ + packages/workflows/skills/harness-contract-* 改动时跑', () => {
    // paths 过滤存在
    expect(workflow).toMatch(/paths:/);
    expect(workflow).toMatch(/sprints\//);
  });

  it('check-dod-purity 脚本存在', () => {
    const p = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-dod-purity.cjs');
    expect(existsSync(p)).toBe(true);
  });

  it('check-test-coverage 脚本存在', () => {
    const p = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-test-coverage.cjs');
    expect(existsSync(p)).toBe(true);
  });

  it('check-tdd-commit-order 脚本存在', () => {
    const p = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-tdd-commit-order.sh');
    expect(existsSync(p)).toBe(true);
  });

  it('check-dod-purity 检测 [BEHAVIOR] 条目', () => {
    const p = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-dod-purity.cjs');
    if (!existsSync(p)) return; // let prior test fail
    const script = readFileSync(p, 'utf8');
    expect(script).toMatch(/\[BEHAVIOR\]/);
    // 必须读 contract-dod-ws*.md
    expect(script).toMatch(/contract-dod-ws/);
    // 失败退出非 0
    expect(script).toMatch(/process\.exit\(1\)|exit\s+1/);
  });

  it('check-tdd-commit-order 验证 commit 1 文件范围', () => {
    const p = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-tdd-commit-order.sh');
    if (!existsSync(p)) return;
    const script = readFileSync(p, 'utf8');
    // 必须用 git log 分析 PR commits
    expect(script).toMatch(/git\s+log|git\s+show/);
    // 必须检测 (Red) / (Green) 标签
    expect(script).toMatch(/\(Red\)/);
    expect(script).toMatch(/\(Green\)/);
    // 必须检测 commit 1 后 tests 文件不变
    expect(script).toMatch(/tests.*\*\.test\.ts|\.test\.ts.*diff|diff.*tests/);
  });

  it('check-test-coverage 验证 Test Contract 表声明的测试文件存在', () => {
    const p = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-test-coverage.cjs');
    if (!existsSync(p)) return;
    const script = readFileSync(p, 'utf8');
    expect(script).toMatch(/Test Contract/);
    expect(script).toMatch(/\.test\.ts/);
  });
});
