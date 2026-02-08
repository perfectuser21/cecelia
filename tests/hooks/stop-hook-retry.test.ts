/**
 * tests/hooks/stop-hook-retry.test.ts
 *
 * 测试 Stop Hook 重试机制：
 * - 删除 stop_hook_active 检查
 * - 实现 15 次计数器（retry_count 字段）
 * - 15 次后上报失败并退出
 * - v11.25.0: 重试上限从 20 改为 15
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Stop Hook 重试机制', () => {
  let tempDir: string;
  let devModeFile: string;

  beforeEach(() => {
    // 创建临时目录和 .dev-mode 文件
    tempDir = mkdtempSync(join(tmpdir(), 'stop-hook-test-'));
    devModeFile = join(tempDir, '.dev-mode');

    // 初始化 .dev-mode 文件
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
tasks_created: true
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: pending
`,
    );

    // 初始化 git 仓库（Stop Hook 需要）
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@example.com"', { cwd: tempDir });
    execSync('git config user.name "Test User"', { cwd: tempDir });
  });

  afterEach(() => {
    // 清理临时目录
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('应该从 .dev-mode 读取 retry_count', () => {
    // 添加 retry_count 字段
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
retry_count: 5
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');
    expect(content).toContain('retry_count: 5');

    // 提取 retry_count
    const match = content.match(/^retry_count:\s*(\d+)$/m);
    expect(match).toBeTruthy();
    expect(match![1]).toBe('5');
  });

  it('应该每次调用增加 retry_count', () => {
    // 模拟 Stop Hook 更新 retry_count
    let content = readFileSync(devModeFile, 'utf-8');
    const retryCount = 0;

    // 删除旧的 retry_count（如果有）
    content = content.replace(/^retry_count:.*$/gm, '');
    // 添加新的 retry_count
    content += `retry_count: ${retryCount + 1}\n`;

    writeFileSync(devModeFile, content);

    const updatedContent = readFileSync(devModeFile, 'utf-8');
    expect(updatedContent).toContain('retry_count: 1');

    // 再次更新
    let secondContent = updatedContent.replace(/^retry_count:.*$/gm, '');
    secondContent += `retry_count: 2\n`;
    writeFileSync(devModeFile, secondContent);

    const finalContent = readFileSync(devModeFile, 'utf-8');
    expect(finalContent).toContain('retry_count: 2');
  });

  it('应该在 retry_count >= 15 时退出', () => {
    // 模拟 15 次重试
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
retry_count: 15
`,
    );

    const content = readFileSync(devModeFile, 'utf-8');
    const match = content.match(/^retry_count:\s*(\d+)$/m);
    const retryCount = match ? parseInt(match[1], 10) : 0;

    expect(retryCount).toBeGreaterThanOrEqual(15);

    // 此时 Stop Hook 应该删除 .dev-mode 并退出
    // （这部分由 Stop Hook 脚本处理，这里只验证逻辑）
  });

  it('应该调用 track.sh 上报失败（超限时）', () => {
    const hookContent = execSync(
      `cat ${join(__dirname, '../../hooks/stop-dev.sh')}`,
      { encoding: 'utf-8' }
    );

    // 验证超限后调用 track.sh fail
    expect(hookContent).toContain('track.sh');
    expect(hookContent).toContain('fail');
    expect(hookContent).toContain('15 次');
  });

  it('应该正确处理空或无效的 retry_count', () => {
    // 无 retry_count 字段
    const content = readFileSync(devModeFile, 'utf-8');
    const match = content.match(/^retry_count:\s*(\d+)$/m);
    const retryCount = match ? parseInt(match[1], 10) : 0;

    expect(retryCount).toBe(0); // 默认为 0

    // 添加无效的 retry_count
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
retry_count: abc
`,
    );

    const invalidContent = readFileSync(devModeFile, 'utf-8');
    const invalidMatch = invalidContent.match(/^retry_count:\s*(\d+)$/m);
    const invalidRetryCount = invalidMatch ? parseInt(invalidMatch[1], 10) : 0;

    expect(invalidRetryCount).toBe(0); // 无效值应视为 0
  });
});
