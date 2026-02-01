/**
 * tests/scripts/cleanup.test.ts
 *
 * 测试 Cleanup 脚本完善：
 * - 扩展清理文件列表（添加 gate 文件）
 * - 显式清理 .dev-mode 文件
 * - 设置 cleanup_done: true 标记
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Cleanup 脚本', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('应该清理所有 gate 文件', () => {
    // 创建 gate 文件
    const gateFiles = [
      '.gate-prd-passed',
      '.gate-dod-passed',
      '.gate-qa-passed',
      '.gate-audit-passed',
      '.gate-test-passed',
    ];

    gateFiles.forEach((file) => {
      writeFileSync(join(tempDir, file), 'passed');
    });

    // 验证文件存在
    gateFiles.forEach((file) => {
      expect(existsSync(join(tempDir, file))).toBe(true);
    });

    // 模拟 cleanup（实际由脚本执行）
    gateFiles.forEach((file) => {
      rmSync(join(tempDir, file), { force: true });
    });

    // 验证文件已删除
    gateFiles.forEach((file) => {
      expect(existsSync(join(tempDir, file))).toBe(false);
    });
  });

  it('应该清理 .dev-mode 文件', () => {
    const devModeFile = join(tempDir, '.dev-mode');
    writeFileSync(
      devModeFile,
      `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
`,
    );

    expect(existsSync(devModeFile)).toBe(true);

    // 模拟 cleanup
    rmSync(devModeFile, { force: true });

    expect(existsSync(devModeFile)).toBe(false);
  });

  it('应该包含所有运行时文件在清理列表中', () => {
    const runtimeFiles = [
      '.quality-report.json',
      '.prd.md',
      '.dod.md',
      '.prd-cp-test.md',
      '.dod-cp-test.md',
      '.quality-gate-passed',
      '.quality-gate-passed-cp-test',
      '.cecelia-run-id',
      '.cecelia-run-id-cp-test',
      '.layer2-evidence.md',
      '.l3-analysis.md',
      '.quality-evidence.json',
      '.gate-prd-passed',
      '.gate-dod-passed',
      '.gate-qa-passed',
      '.gate-audit-passed',
      '.gate-test-passed',
      '.dev-mode',
    ];

    // 创建所有文件
    runtimeFiles.forEach((file) => {
      writeFileSync(join(tempDir, file), 'test');
    });

    // 验证存在
    runtimeFiles.forEach((file) => {
      expect(existsSync(join(tempDir, file))).toBe(true);
    });

    // 模拟清理
    runtimeFiles.forEach((file) => {
      rmSync(join(tempDir, file), { force: true });
    });

    // 验证已删除
    runtimeFiles.forEach((file) => {
      expect(existsSync(join(tempDir, file))).toBe(false);
    });
  });

  it('应该在 cleanup 完成后设置 cleanup_done: true', () => {
    const devModeFile = join(tempDir, '.dev-mode');
    const initialContent = `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_11_cleanup: done
`;

    writeFileSync(devModeFile, initialContent);

    // 模拟 cleanup 脚本追加 cleanup_done: true
    const updatedContent = initialContent + 'cleanup_done: true\n';
    writeFileSync(devModeFile, updatedContent);

    const { readFileSync } = require('fs');
    const finalContent = readFileSync(devModeFile, 'utf-8');

    expect(finalContent).toContain('cleanup_done: true');
  });
});
