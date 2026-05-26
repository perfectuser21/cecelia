import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

describe('WS1 — smoke-verify.sh 冒烟脚本存在并可执行 [BEHAVIOR]', () => {
  it('smoke-verify.sh 文件存在', () => {
    expect(existsSync('sprints/dev-visibility-smoke/smoke-verify.sh')).toBe(true);
  });

  it('smoke-verify.sh 执行退出码为 0（所有检查通过）', () => {
    expect(() =>
      execSync('bash sprints/dev-visibility-smoke/smoke-verify.sh', {
        encoding: 'utf8',
        cwd: process.cwd(),
      })
    ).not.toThrow();
  });
});
