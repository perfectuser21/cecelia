import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const DEVLOOP_CHECK = resolve(__dirname, '../../lib/devloop-check.sh');
const ENGINE_ROOT = resolve(__dirname, '../..');

describe('devloop-check.sh — 直接执行入口（会话压缩恢复）', () => {
  it('脚本文件存在', () => {
    expect(existsSync(DEVLOOP_CHECK)).toBe(true);
  });

  it('包含 devloop_check_main 函数定义', () => {
    const content = readFileSync(DEVLOOP_CHECK, 'utf8');
    expect(content).toContain('devloop_check_main');
  });

  it('包含 BASH_SOURCE[0] 直接执行检测', () => {
    const content = readFileSync(DEVLOOP_CHECK, 'utf8');
    expect(content).toContain('BASH_SOURCE[0]');
  });

  it('直接执行时输出 Dev Session Status 标题', () => {
    const result = execSync(`bash "${DEVLOOP_CHECK}" 2>&1 || true`, {
      cwd: ENGINE_ROOT,
      encoding: 'utf8',
    });
    expect(result).toContain('Cecelia Dev Session Status');
  });

  it('无活跃会话时输出 NO_ACTIVE_SESSION', () => {
    // 在临时目录（非 cecelia repo）中执行，确保没有 .dev-mode 文件
    const tmpDir = mkdtempSync(join(ENGINE_ROOT, '.tmp-devloop-test-'));
    try {
      // 初始化临时 git repo（避免 git rev-parse 报错）
      execSync('git init -q', { cwd: tmpDir });
      const result = execSync(`bash "${DEVLOOP_CHECK}" 2>&1 || true`, {
        cwd: tmpDir,
        encoding: 'utf8',
      });
      expect(result).toContain('NO_ACTIVE_SESSION');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('有 .dev-mode 文件时输出 Stage 状态', () => {
    const tmpDir = mkdtempSync(join(ENGINE_ROOT, '.tmp-devloop-test-'));
    try {
      execSync('git init -q', { cwd: tmpDir });
      const branch = 'cp-01010000-test-session-recovery';
      writeFileSync(
        join(tmpDir, `.dev-mode.${branch}`),
        [
          'dev',
          `branch: ${branch}`,
          'step_0_worktree: done',
          'step_1_spec: done',
          'step_2_code: pending',
          'step_3_integrate: pending',
          'step_4_ship: pending',
          'task_track: lite',
        ].join('\n') + '\n'
      );
      const result = execSync(`bash "${DEVLOOP_CHECK}" 2>&1 || true`, {
        cwd: tmpDir,
        encoding: 'utf8',
      });
      expect(result).toContain(branch);
      expect(result).toContain('Stage 状态');
      expect(result).toContain('step_1_spec');
      expect(result).toContain('step_2_code');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
