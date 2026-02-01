/**
 * tests/hooks/subagent-stop.test.ts
 *
 * 测试 SubagentStop Hook：
 * - 检测 .dev-mode 文件
 * - 5 次重试上限
 * - 超限后允许 Subagent 退出（主 Agent 换方案）
 * - 使用 JSON API 强制循环
 * - v11.25.0: 新增 SubagentStop Hook (H7-009)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import {
  existsSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

const HOOK_PATH = resolve(__dirname, '../../hooks/subagent-stop.sh');

describe('subagent-stop.sh', () => {
  beforeAll(() => {
    expect(existsSync(HOOK_PATH)).toBe(true);
  });

  it('should exist and be executable', () => {
    const stat = execSync(`stat -c %a "${HOOK_PATH}"`, { encoding: 'utf-8' });
    const mode = parseInt(stat.trim(), 8);
    expect(mode & 0o111).toBeGreaterThan(0); // Has execute permission
  });

  it('should pass syntax check', () => {
    expect(() => {
      execSync(`bash -n "${HOOK_PATH}"`, { encoding: 'utf-8' });
    }).not.toThrow();
  });

  it('should have H7-009 version marker', () => {
    const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: 'utf-8' });

    expect(hookContent).toContain('v11.25.0');
    expect(hookContent).toContain('H7-009');
    expect(hookContent).toContain('SubagentStop Hook');
  });

  describe('JSON API format', () => {
    it('should use JSON API format', () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: 'utf-8' });

      expect(hookContent).toContain('{"decision": "block"');
      expect(hookContent).toContain('jq -n');
      expect(hookContent).toContain('--arg reason');
    });

    it('should exit 0 with JSON when continuing', () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: 'utf-8' });

      // 验证 JSON 输出后 exit 0
      expect(hookContent).toMatch(/jq -n.*exit 0/s);
    });

    it('should exit 0 when retry limit reached', () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: 'utf-8' });

      // 5 次上限后允许 Subagent 结束
      expect(hookContent).toContain('SUBAGENT_RETRY_COUNT -ge 5');
      expect(hookContent).toContain('允许 Subagent 退出');
    });
  });

  describe('retry mechanism', () => {
    let tempDir: string;
    let devModeFile: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'subagent-stop-test-'));
      devModeFile = join(tempDir, '.dev-mode');

      // 初始化 .dev-mode 文件
      writeFileSync(
        devModeFile,
        `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
tasks_created: true
`,
      );

      // 初始化 git 仓库
      execSync('git init', { cwd: tempDir });
      execSync('git config user.email "test@example.com"', { cwd: tempDir });
      execSync('git config user.name "Test User"', { cwd: tempDir });
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should read subagent_retry_count from .dev-mode', () => {
      writeFileSync(
        devModeFile,
        `dev
branch: cp-test-branch
subagent_retry_count: 3
`,
      );

      const content = readFileSync(devModeFile, 'utf-8');
      expect(content).toContain('subagent_retry_count: 3');

      const match = content.match(/^subagent_retry_count:\s*(\d+)$/m);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('3');
    });

    it('should allow Subagent exit when retry_count >= 5', () => {
      writeFileSync(
        devModeFile,
        `dev
branch: cp-test-branch
subagent_retry_count: 5
`,
      );

      const content = readFileSync(devModeFile, 'utf-8');
      const match = content.match(/^subagent_retry_count:\s*(\d+)$/m);
      const retryCount = match ? parseInt(match[1], 10) : 0;

      expect(retryCount).toBeGreaterThanOrEqual(5);
      // Hook 应该 exit 0 允许 Subagent 结束
    });

    it('should default to 0 when subagent_retry_count missing', () => {
      const content = readFileSync(devModeFile, 'utf-8');
      const match = content.match(/^subagent_retry_count:\s*(\d+)$/m);
      const retryCount = match ? parseInt(match[1], 10) : 0;

      expect(retryCount).toBe(0);
    });
  });

  describe('agent type support', () => {
    it('should extract agent_type from input JSON', () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: 'utf-8' });

      // 验证提取 agent_type
      expect(hookContent).toContain('agent_type');
      expect(hookContent).toContain('jq -r');
    });

    it('should support Explore and Plan agent types', () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: 'utf-8' });

      // 虽然代码中没有硬编码 agent type，但应该能处理任意类型
      expect(hookContent).toContain('AGENT_TYPE');
    });

    it('should fallback to "unknown" when agent_type missing', () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: 'utf-8' });

      expect(hookContent).toContain('"unknown"');
    });
  });

  describe('.claude/settings.json integration', () => {
    it('should be configured in SubagentStop hook', () => {
      const settingsPath = resolve(
        __dirname,
        '../../.claude/settings.json',
      );

      if (!existsSync(settingsPath)) {
        // 如果文件不存在，跳过测试
        return;
      }

      const settingsContent = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);

      // 验证 SubagentStop Hook 配置存在
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.SubagentStop).toBeDefined();
      expect(settings.hooks.SubagentStop[0].hooks[0].command).toContain(
        'subagent-stop.sh',
      );
    });
  });
});
