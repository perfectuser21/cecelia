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

  it('workflow 包含 4 个核心 job：dod-structure-purity / test-coverage / tdd-commit-order / tests-actually-pass', () => {
    expect(workflow).toMatch(/^\s*dod-structure-purity:/m);
    expect(workflow).toMatch(/^\s*test-coverage-for-behavior:/m);
    expect(workflow).toMatch(/^\s*tdd-commit-order:/m);
    expect(workflow).toMatch(/^\s*tests-actually-pass:/m);
  });

  it('原有 4 个 job 全部硬门禁（cp-0427095721），skeleton-shape-check 在观察期（最多 1 个软门禁）', () => {
    // 原始 4 个 job（dod-structure-purity/test-coverage/tdd-commit-order/tests-actually-pass）全部硬门禁
    // skeleton-shape-check (cp-0506104457) 在观察期，允许 1 个 continue-on-error: true
    const softGates = (workflow.match(/^\s*continue-on-error:\s*true/gm) || []).length;
    expect(softGates).toBeLessThanOrEqual(1);
    // 若有软门禁，必须是 skeleton-shape-check job
    if (softGates === 1) {
      expect(workflow).toMatch(/skeleton-shape-check:/);
    }
  });

  it('workflow 包含 skeleton-shape-check job（Working Skeleton E2E 形状校验）', () => {
    expect(workflow).toMatch(/^\s*skeleton-shape-check:/m);
  });

  it('workflow 通过 changes job 过滤——只在合同相关改动时真跑（required 化后无 workflow 级 paths）', () => {
    // 2026-07-06 required 化（#3565）：workflow 级 paths 过滤移除，
    // 改为 changes job 三点 diff 检测 + 各 job 条件 skip
    expect(workflow).toMatch(/^\s*changes:/m);
    expect(workflow).toMatch(/sprints\//);
    expect(workflow).toMatch(/needs\.changes\.outputs\.contracts == 'true'/);
  });

  it('Sprint Tests 使用隔离 test DB、完整连接参数与 PR base SHA', () => {
    const sprintJob = workflow.match(
      /^\s{2}tests-actually-pass:[\s\S]*?(?=^\s{2}skeleton-shape-check:)/m,
    )?.[0] ?? '';
    const runSprintStep = sprintJob.slice(sprintJob.indexOf('- name: Run sprint tests'));

    // createdb + migrate 两步都锁住（2026-08-04 PR #4598）：cecelia_test 不跑 migrations
    // 会让真 PG 集成型 sprint 测试（TEMP TABLE LIKE public.xxx）42P01 必红
    expect(sprintJob).toMatch(
      /- name: Create isolated sprint test database[\s\S]*?run:\s*\|[\s\S]*?createdb cecelia_test[\s\S]*?DB_NAME=cecelia_test node src\/migrate\.js/,
    );
    expect(runSprintStep).toContain(
      'TEST_DATABASE_URL: postgresql://cecelia:cecelia@localhost:5432/cecelia_test',
    );
    expect(runSprintStep).toContain('DB_HOST: localhost');
    expect(runSprintStep).toContain("DB_PORT: '5432'");
    expect(runSprintStep).toContain('DB_NAME: cecelia_test');
    expect(runSprintStep).toContain('DB_USER: cecelia');
    expect(runSprintStep).toContain('DB_PASSWORD: cecelia');
    expect(runSprintStep).toContain(
      'CONTRACT_BASE_SHA: ${{ github.event.pull_request.base.sha }}',
    );
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

  it('skeleton-shape-check 脚本存在', () => {
    const p = join(REPO_ROOT, 'packages/engine/scripts/devgate/skeleton-shape-check.cjs');
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
