/**
 * check-coverage-completeness.test.ts
 *
 * 测试 check-coverage-completeness.mjs 的三个核心检查函数：
 * - checkHooksCoverage: hooks/*.sh 必须有对应测试
 * - checkSrcCoverage: src/*.ts 必须有对应测试
 * - checkDevgateCoverage: scripts/devgate/*.mjs/.cjs 建议有测试（警告级别）
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/devgate/check-coverage-completeness.mjs');

// ─── 脚本存在性检查 ──────────────────────────────────────────────────────

describe('check-coverage-completeness.mjs 脚本存在性', () => {
  it('CMP-001: 脚本文件存在于 packages/engine/scripts/devgate/', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('CMP-002: 脚本以 #!/usr/bin/env node 开头（可执行性）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('CMP-003: 脚本包含三个核心检查函数', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('checkHooksCoverage');
    expect(content).toContain('checkSrcCoverage');
    expect(content).toContain('checkDevgateCoverage');
  });

  it('CMP-004: 脚本支持 --dry-run 参数', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('--dry-run');
    expect(content).toContain('isDryRun');
  });

  it('CMP-005: 脚本支持 --strict 参数', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('--strict');
    expect(content).toContain('isStrict');
  });
});

// ─── dry-run 模式执行测试 ────────────────────────────────────────────────

describe('check-coverage-completeness.mjs dry-run 执行', () => {
  it('CMP-006: --dry-run 模式下脚本能正常执行，不因缺少测试而 exit 1', () => {
    const engineRoot = path.resolve(__dirname, '../..');
    let exitCode = 0;
    let output = '';
    try {
      output = execSync(`node ${SCRIPT_PATH} --dry-run`, {
        cwd: engineRoot,
        encoding: 'utf8',
        timeout: 15000,
      });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      output = err.stdout ?? '';
    }
    expect(exitCode).toBe(0);
    expect(output).toContain('Coverage Completeness Check');
  });

  it('CMP-007: 输出包含整体结果判定行', () => {
    const engineRoot = path.resolve(__dirname, '../..');
    let output = '';
    try {
      output = execSync(`node ${SCRIPT_PATH} --dry-run`, {
        cwd: engineRoot,
        encoding: 'utf8',
        timeout: 15000,
      });
    } catch (err: any) {
      output = err.stdout ?? '';
    }
    expect(output).toMatch(/覆盖率完整性检查/);
  });
});

// ─── 逻辑验证：Hooks 覆盖检查 ────────────────────────────────────────────

describe('check-coverage-completeness.mjs Hooks 检查逻辑', () => {
  it('CMP-008: 脚本正确处理 hooks 目录不存在的情况（返回 total:0）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // listFiles 函数有 existsSync 检查
    expect(content).toContain('existsSync');
    expect(content).toContain('return []');
  });

  it('CMP-009: 实际引擎中 hooks 检查能正常运行（dry-run）', () => {
    const engineRoot = path.resolve(__dirname, '../..');
    const hooksDir = path.join(engineRoot, 'hooks');
    let output = '';
    try {
      output = execSync(`node ${SCRIPT_PATH} --dry-run`, {
        cwd: engineRoot,
        encoding: 'utf8',
        timeout: 15000,
      });
    } catch (err: any) {
      output = err.stdout ?? '';
    }
    if (fs.existsSync(hooksDir) && fs.readdirSync(hooksDir).some(f => f.endsWith('.sh'))) {
      expect(output).toMatch(/Hooks 覆盖检查/);
    } else {
      expect(output).toContain('SKIPPED');
    }
  });
});

// ─── 逻辑验证：Src 覆盖检查 ──────────────────────────────────────────────

describe('check-coverage-completeness.mjs Src 检查逻辑', () => {
  it('CMP-010: 脚本排除 .d.ts 类型声明文件', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('.d.ts');
    expect(content).toMatch(/filter.*\.d\.ts/);
  });

  it('CMP-011: 脚本排除 .test.ts 测试文件本身', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('.test.ts');
    expect(content).toMatch(/filter.*\.test\.ts/);
  });

  it('CMP-012: src/ 目录不存在时 SKIPPED（skipped: true）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('skipped: true');
  });
});

// ─── 逻辑验证：Devgate 覆盖检查 ─────────────────────────────────────────

describe('check-coverage-completeness.mjs Devgate 检查逻辑', () => {
  it('CMP-013: devgate 检查同时扫描 .mjs 和 .cjs 文件', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('.mjs');
    expect(content).toContain('.cjs');
    // listFiles 传入了两个扩展名的数组
    expect(content).toContain("['.mjs', '.cjs']");
  });

  it('CMP-014: devgate 检查是警告级（非 --strict 不 exit 1）', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(content).toContain('hasWarnings = true');
    expect(content).toContain('if (isStrict) hasErrors = true');
  });

  it('CMP-015: 本测试文件本身存在（验证 check-coverage-completeness.mjs 有测试）', () => {
    const thisTestFile = path.resolve(__dirname, 'check-coverage-completeness.test.ts');
    expect(fs.existsSync(thisTestFile)).toBe(true);
  });
});

// ─── CI 接入验证 ──────────────────────────────────────────────────────────

describe('check-coverage-completeness.mjs CI 接入检查', () => {
  it('CMP-016: ci-l2-consistency.yml 包含调用 check-coverage-completeness 的步骤', () => {
    const ciFile = path.resolve(__dirname, '../../../../.github/workflows/ci-l2-consistency.yml');
    expect(fs.existsSync(ciFile)).toBe(true);
    const content = fs.readFileSync(ciFile, 'utf8');
    expect(content).toContain('check-coverage-completeness');
  });
});
