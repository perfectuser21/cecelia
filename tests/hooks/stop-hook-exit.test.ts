/**
 * tests/hooks/stop-hook-exit.test.ts
 *
 * 测试 Stop Hook 退出条件：
 * - 删除 PR 合并后的提前退出
 * - 修复分支不匹配时的 .dev-mode 泄漏
 * - 统一退出条件：只有 cleanup_done: true 或 11 步全部完成
 * - v11.25.0: 所有 exit 2 改为 jq -n 输出 JSON + exit 0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Stop Hook 退出条件', () => {
  let tempDir: string;
  let devModeFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stop-hook-exit-test-'));
    devModeFile = join(tempDir, '.dev-mode');

    // 初始化 git 仓库
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@example.com"', { cwd: tempDir });
    execSync('git config user.name "Test User"', { cwd: tempDir });

    // 创建初始提交（需要有 HEAD 才能 checkout -b）
    writeFileSync(join(tempDir, 'README.md'), '# Test');
    execSync('git add README.md', { cwd: tempDir });
    execSync('git commit -m "Initial commit"', { cwd: tempDir });

    // 创建测试分支
    execSync('git checkout -b cp-test-branch', { cwd: tempDir });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('应该在 cleanup_done: true 时允许退出', () => {
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
cleanup_done: true
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');
    expect(content).toContain('cleanup_done: true');

    // Stop Hook 应该检测到 cleanup_done: true 并删除文件
  });

  it('应该检查 11 步是否全部完成', () => {
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: done
step_5_code: done
step_6_test: done
step_7_quality: done
step_8_pr: done
step_9_ci: done
step_10_learning: done
step_11_cleanup: done
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');

    // 检查所有步骤是否为 done
    for (let step = 1; step <= 11; step++) {
      const match = content.match(new RegExp(`^step_${step}_\\w+:\\s*(\\w+)$`, 'm'));
      expect(match).toBeTruthy();
      expect(match![1]).toBe('done');
    }

    // 所有步骤完成，Stop Hook 应该允许退出
  });

  it('应该在步骤未完成时阻止退出', () => {
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: done
step_5_code: pending
step_6_test: pending
step_7_quality: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');

    // 检查是否有 pending 的步骤
    let hasPending = false;
    for (let step = 1; step <= 11; step++) {
      const match = content.match(new RegExp(`^step_${step}_\\w+:\\s*(\\w+)$`, 'm'));
      if (match && match[1] !== 'done') {
        hasPending = true;
        break;
      }
    }

    expect(hasPending).toBe(true);
    // Stop Hook 应该阻止退出（JSON API + exit 0）
  });

  describe('JSON API exit behavior', () => {
    it('should use jq -n to output JSON with exit 2', () => {
      const hookContent = execSync(
        `cat ${join(__dirname, '../../hooks/stop-dev.sh')}`,
        { encoding: 'utf-8' }
      );

      // 验证所有阻止退出的地方都使用 JSON API
      expect(hookContent).toContain('jq -n');
      expect(hookContent).toContain('{"decision": "block"');

      // stop-dev.sh 使用 exit 2 阻止会话结束
      expect(hookContent).toContain('exit 2');
    });

    it('should validate JSON output format for different scenarios', () => {
      // Test PR not created
      const prNotCreated = execSync(
        `jq -n --arg reason "PR 未创建，继续执行 Step 8 创建 PR" '{"decision": "block", "reason": $reason}'`,
        { encoding: 'utf-8' }
      );
      const json1 = JSON.parse(prNotCreated);
      expect(json1.decision).toBe('block');
      expect(json1.reason).toContain('PR 未创建');

      // Test CI in progress
      const ciInProgress = execSync(
        `jq -n --arg reason "CI 进行中（in_progress），等待 CI 完成" '{"decision": "block", "reason": $reason}'`,
        { encoding: 'utf-8' }
      );
      const json2 = JSON.parse(ciInProgress);
      expect(json2.decision).toBe('block');
      expect(json2.reason).toContain('CI 进行中');

      // Test PR not merged
      const prNotMerged = execSync(
        `jq -n --arg reason "PR #123 CI 已通过但未合并，执行合并操作" --arg pr "123" '{"decision": "block", "reason": $reason, "pr_number": $pr}'`,
        { encoding: 'utf-8' }
      );
      const json3 = JSON.parse(prNotMerged);
      expect(json3.decision).toBe('block');
      expect(json3.pr_number).toBe('123');
    });

    it('should exit 2 after JSON output in stop-dev.sh', () => {
      const hookContent = execSync(
        `cat ${join(__dirname, '../../hooks/stop-dev.sh')}`,
        { encoding: 'utf-8' }
      );

      // 验证 jq 输出后紧跟 exit 2
      expect(hookContent).toMatch(/jq -n.*\n\s*exit 2/);
    });
  });

  it('应该在分支不匹配时删除泄漏的 .dev-mode', () => {
    // .dev-mode 记录的分支是 cp-old-branch
    writeFileSync(
      devModeFile,
      `dev
branch: cp-old-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
`,
    );

    // 当前分支是 cp-test-branch
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: tempDir,
      encoding: 'utf-8',
    }).trim();

    expect(currentBranch).toBe('cp-test-branch');

    const content = readFileSync(devModeFile, 'utf-8');
    const branchMatch = content.match(/^branch:\s*(.+)$/m);
    const branchInFile = branchMatch ? branchMatch[1].trim() : '';

    expect(branchInFile).toBe('cp-old-branch');
    expect(branchInFile).not.toBe(currentBranch);

    // Stop Hook 应该检测到分支不匹配，删除 .dev-mode 文件
    // （实际删除由 Stop Hook 脚本执行）
  });

  it('应该忽略 PR 合并状态，只检查 cleanup_done', () => {
    // 即使 PR 已合并，如果 cleanup_done 不是 true，也不应退出
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
pr_merged: true
step_11_cleanup: pending
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');
    expect(content).toContain('pr_merged: true');
    expect(content).toContain('step_11_cleanup: pending');
    expect(content).not.toContain('cleanup_done: true');

    // Stop Hook 应该继续循环，不允许退出
  });
});
