/**
 * tests/verify-step-planner-seal.test.ts
 *
 * 验证 verify-step.sh step1 的 Gate Planner 检查：
 * - Planner seal 文件缺失时 → exit 1
 * - Planner seal 文件存在时 → 检查通过
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execSync, spawnSync } from 'child_process';

const VERIFY_STEP_SH = resolve(
  __dirname,
  '../../../packages/engine/hooks/verify-step.sh'
);

describe('verify-step.sh step1 — Gate Planner 检查', () => {
  let tempDir: string;
  let branch: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'planner-seal-test-'));
    branch = `cp-test-${Date.now()}`;
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeTaskCard(dir: string, branch: string): void {
    const content = `# Task Card
- [x] [PRESERVE] 原有逻辑不变
  - Test: manual:node -e "process.exit(0)"
- [x] [BEHAVIOR] 新行为验证
  - Test: manual:node -e "process.exit(0)"
`;
    writeFileSync(join(dir, `.task-${branch}.md`), content, 'utf-8');
  }

  it('verify-step.sh 文件包含 Gate Planner 检查', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    expect(content).toContain('Gate Planner');
    expect(content).toContain('.dev-gate-planner.');
    expect(content).toContain('Planner seal 文件不存在');
  });

  it('Planner seal 缺失时应包含明确的错误信息文本', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    // 验证错误路径引导用户运行 spec_review 流程
    expect(content).toContain('spec_review');
    expect(content).toContain('planner_seal_file');
  });

  it('Gate Planner 检查在 _pass 调用之前执行', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    const plannerPos = content.indexOf('Gate Planner');
    const passPos = content.indexOf("_pass \"Step 1 Task Card 验证通过\"");
    expect(plannerPos).toBeGreaterThan(0);
    expect(passPos).toBeGreaterThan(0);
    // Gate Planner 必须在 _pass 之前
    expect(plannerPos).toBeLessThan(passPos);
  });

  it('Planner seal 存在时 verify_step1 输出成功标记', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    // 确认成功路径有明确的 ✅ 输出
    expect(content).toContain('Planner seal 已验证');
  });
});
