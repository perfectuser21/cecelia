import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const LIB = join(process.cwd(), 'lib', 'devloop-check.sh');

describe('devloop-check.sh — CI 失败计数器', () => {
  let tmpDir: string;
  let devModeFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'devloop-ci-'));
    devModeFile = join(tmpDir, '.dev-mode.cp-test');
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  const sourceAndRun = (script: string): string => {
    return execSync(
      `source "${LIB}" && ${script}`,
      { shell: '/bin/bash', encoding: 'utf8' }
    );
  };

  it('_increment_and_check_ci_counter 从无到 1', () => {
    writeFileSync(devModeFile, ['dev', 'branch: cp-test'].join('\n') + '\n');
    sourceAndRun(`_increment_and_check_ci_counter "${devModeFile}"`);
    const content = readFileSync(devModeFile, 'utf8');
    expect(content).toContain('ci_fix_count: 1');
  });

  it('_increment_and_check_ci_counter 从 2 到 3', () => {
    writeFileSync(
      devModeFile,
      ['dev', 'branch: cp-test', 'ci_fix_count: 2'].join('\n') + '\n'
    );
    sourceAndRun(`_increment_and_check_ci_counter "${devModeFile}"`);
    const content = readFileSync(devModeFile, 'utf8');
    expect(content).toContain('ci_fix_count: 3');
    expect(content).not.toContain('ci_fix_count: 2');
  });

  it('_ci_action_for_count 在 count < 3 时返回标准 action', () => {
    writeFileSync(
      devModeFile,
      ['dev', 'branch: cp-test', 'ci_fix_count: 1'].join('\n') + '\n'
    );
    const output = sourceAndRun(`_ci_action_for_count "${devModeFile}"`);
    expect(output).toMatch(/查看日志|修复/);
    expect(output).not.toMatch(/systematic-debugging/);
  });

  it('_ci_action_for_count 在 count >= 3 时切换 systematic-debugging', () => {
    writeFileSync(
      devModeFile,
      ['dev', 'branch: cp-test', 'ci_fix_count: 3'].join('\n') + '\n'
    );
    const output = sourceAndRun(`_ci_action_for_count "${devModeFile}"`);
    expect(output).toMatch(/systematic-debugging/);
    expect(output).toMatch(/停下|根因/);
  });

  it('_ci_action_for_count 在 count=0 时也返回标准 action', () => {
    writeFileSync(devModeFile, ['dev', 'branch: cp-test'].join('\n') + '\n');
    const output = sourceAndRun(`_ci_action_for_count "${devModeFile}"`);
    expect(output).toMatch(/查看日志|修复|CI 失败/);
  });
});
