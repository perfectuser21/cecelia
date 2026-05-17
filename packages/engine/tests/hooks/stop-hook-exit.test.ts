/**
 * tests/hooks/stop-hook-exit.test.ts
 *
 * 测试 Stop Hook 退出条件：
 * - 删除 PR 合并后的提前退出
 * - 修复分支不匹配时的 .dev-mode 泄漏
 * - 统一退出条件：只有 cleanup_done: true 或所有 6 步全部完成
 * - v11.25.0: 所有 exit 2 改为 jq -n 输出 JSON + exit 0
 *
 * NOTE: stop-dev.sh v14.0.0+ 使用 per-branch 格式：.dev-mode.{branch}
 * beforeEach 创建分支 cp-test-branch，devModeFile 对应 .dev-mode.cp-test-branch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_BRANCH = 'cp-test-branch';

// TODO(cp-0504185237): Ralph Loop 模式（v21.0.0）协议变了 — exit 2 → decision:block + exit 0。
// 这些测试基于旧三态协议，需要重写。临时整体 skip，由 ralph-loop-mode integration 替代覆盖。
describe.skip('Stop Hook 退出条件（Ralph 模式后待重写）', () => {
  let tempDir: string;
  let devModeFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stop-hook-exit-test-'));
    // per-branch 格式：文件名含分支名后缀
    devModeFile = join(tempDir, `.dev-mode.${TEST_BRANCH}`);

    // 初始化 git 仓库
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@example.com"', { cwd: tempDir });
    execSync('git config user.name "Test User"', { cwd: tempDir });

    // 创建初始提交（需要有 HEAD 才能 checkout -b）
    writeFileSync(join(tempDir, 'README.md'), '# Test');
    execSync('git add README.md', { cwd: tempDir });
    execSync('git commit -m "Initial commit"', { cwd: tempDir });

    // 创建测试分支
    execSync(`git checkout -b ${TEST_BRANCH}`, { cwd: tempDir });
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
branch: ${TEST_BRANCH}
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
cleanup_done: true
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');
    expect(content).toContain('cleanup_done: true');

    // Stop Hook 应该检测到 cleanup_done: true 并删除文件
  });

  it('应该检查所有 6 步是否全部完成', () => {
    writeFileSync(
      devModeFile,
      `dev
branch: ${TEST_BRANCH}
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_0_worktree: done
step_1_taskcard: done
step_2_code: done
step_3_prci: done
step_4_learning: done
step_5_clean: done
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');

    // 检查所有步骤是否为 done
    for (let step = 0; step <= 5; step++) {
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
branch: ${TEST_BRANCH}
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_0_worktree: done
step_1_taskcard: done
step_2_code: pending
step_3_prci: pending
step_4_learning: pending
step_5_clean: pending
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');

    // 检查是否有 pending 的步骤
    let hasPending = false;
    for (let step = 0; step <= 5; step++) {
      const match = content.match(new RegExp(`^step_${step}_\\w+:\\s*(\\w+)$`, 'm'));
      if (match && match[1] !== 'done') {
        hasPending = true;
        break;
      }
    }

    expect(hasPending).toBe(true);
    // Stop Hook 应该阻止退出（JSON API + exit 2）
  });

  describe('JSON API exit behavior', () => {
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

  it('应该在分支不匹配时删除泄漏的 .dev-mode（per-branch 格式）', () => {
    // per-branch 格式中，每个分支有自己的 .dev-mode.{branch} 文件，
    // 分支不匹配场景：.dev-mode.cp-old-branch 文件中记录的 branch 与当前分支不同
    const oldBranchDevMode = join(tempDir, '.dev-mode.cp-old-branch');
    writeFileSync(
      oldBranchDevMode,
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

    expect(currentBranch).toBe(TEST_BRANCH);

    const content = readFileSync(oldBranchDevMode, 'utf-8');
    const branchMatch = content.match(/^branch:\s*(.+)$/m);
    const branchInFile = branchMatch ? branchMatch[1].trim() : '';

    expect(branchInFile).toBe('cp-old-branch');
    expect(branchInFile).not.toBe(currentBranch);

    // Stop Hook 应该检测到分支不匹配，删除 .dev-mode.cp-old-branch 文件
    // （实际删除由 Stop Hook 脚本执行）
  });

  it('应该忽略 PR 合并状态，只检查 cleanup_done', () => {
    // 即使 PR 已合并，如果 cleanup_done 不是 true，也不应退出
    writeFileSync(
      devModeFile,
      `dev
branch: ${TEST_BRANCH}
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
pr_merged: true
step_5_clean: pending
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');
    expect(content).toContain('pr_merged: true');
    expect(content).toContain('step_5_clean: pending');
    expect(content).not.toContain('cleanup_done: true');

    // Stop Hook 应该继续循环，不允许退出
  });
});
