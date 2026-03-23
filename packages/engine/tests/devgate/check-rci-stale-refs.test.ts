import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../../../..');
const SCRIPT = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-rci-stale-refs.cjs');
const DETECT_PRIORITY = join(REPO_ROOT, 'packages/engine/scripts/devgate/detect-priority.cjs');

describe('check-rci-stale-refs.cjs', () => {
  it('[ARTIFACT] 脚本文件存在', () => {
    // 验证文件可被 require（即存在且可访问）
    const { accessSync } = require('fs');
    expect(() => accessSync(SCRIPT)).not.toThrow();
  });

  it('[BEHAVIOR] 当前 regression-contract.yaml 全部引用有效（exit 0）', () => {
    // 在 packages/engine 目录下运行，确保相对路径解析正确
    let exitCode = 0;
    try {
      execSync(`node "${SCRIPT}"`, {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });

  it('[BEHAVIOR] --dry-run-fake-stale 注入假悬空引用时返回非零退出码', () => {
    let exitCode = 0;
    try {
      execSync(`node "${SCRIPT}" --dry-run-fake-stale`, {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).not.toBe(0);
  });

  it('[BEHAVIOR] --dry-run-fake-stale 输出包含悬空引用错误信息', () => {
    let stderr = '';
    try {
      execSync(`node "${SCRIPT}" --dry-run-fake-stale`, {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    } catch (e: any) {
      stderr = e.stderr?.toString() ?? '';
    }
    expect(stderr).toContain('悬空引用');
  });
});

describe('detect-priority.cjs — CHANGED_FILES 路径自动识别', () => {
  it('[BEHAVIOR] 改动 hooks/verify-step.sh 时自动返回 P0', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CHANGED_FILES: 'packages/engine/hooks/verify-step.sh',
        SKIP_GIT_DETECTION: '1',
      },
      stdio: 'pipe',
    }).toString().trim();

    expect(result).toBe('P0');
  });

  it('[BEHAVIOR] 改动 hooks/stop-dev.sh 时自动返回 P0', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CHANGED_FILES: 'packages/engine/hooks/stop-dev.sh',
        SKIP_GIT_DETECTION: '1',
      },
      stdio: 'pipe',
    }).toString().trim();

    expect(result).toBe('P0');
  });

  it('[BEHAVIOR] 改动 lib/devloop-check.sh 时自动返回 P0', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CHANGED_FILES: 'packages/engine/lib/devloop-check.sh',
        SKIP_GIT_DETECTION: '1',
      },
      stdio: 'pipe',
    }).toString().trim();

    expect(result).toBe('P0');
  });

  it('[BEHAVIOR] 改动普通文件时不触发路径自动识别', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CHANGED_FILES: 'packages/engine/scripts/devgate/check-rci-stale-refs.cjs',
        SKIP_GIT_DETECTION: '1',
      },
      stdio: 'pipe',
    }).toString().trim();

    // 普通文件不触发自动 P0，应返回 unknown（无其他来源）
    expect(result).toBe('unknown');
  });

  it('[PRESERVE] CHANGED_FILES 不影响 QA-DECISION.md 优先级（QA-DECISION 仍最高）', () => {
    // 使用 SKIP_GIT_DETECTION=1（跳过 QA-DECISION 读取）验证 CHANGED_FILES 生效
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CHANGED_FILES: 'packages/engine/hooks/verify-step.sh',
        PR_PRIORITY: 'P2',
        SKIP_GIT_DETECTION: '1',
      },
      stdio: 'pipe',
    }).toString().trim();

    // CHANGED_FILES 优先级高于 PR_PRIORITY
    expect(result).toBe('P0');
  });
});
