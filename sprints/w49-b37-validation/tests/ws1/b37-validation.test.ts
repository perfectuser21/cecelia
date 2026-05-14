import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const SPRINT_DIR = 'sprints/w49-b37-validation';

describe('Workstream 1 — B37 verify-b37.sh [BEHAVIOR]', () => {
  it('verify-b37.sh 存在于 sprints/w49-b37-validation/', () => {
    // Red：Generator 运行前此文件不存在
    const scriptPath = path.join(REPO_ROOT, SPRINT_DIR, 'verify-b37.sh');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('verify-b37.sh 含 ≥4 条 ✅ PASS 标记', () => {
    // Red：文件不存在时 readFileSync 抛出
    const scriptPath = path.join(REPO_ROOT, SPRINT_DIR, 'verify-b37.sh');
    const content = readFileSync(scriptPath, 'utf8');
    const passCount = (content.match(/✅ PASS/g) || []).length;
    expect(passCount).toBeGreaterThanOrEqual(4);
  });

  it('bash verify-b37.sh exit 0 且输出含 "B37 验证全部通过"', () => {
    // Red：文件不存在时 execSync 抛出
    const scriptPath = path.join(REPO_ROOT, SPRINT_DIR, 'verify-b37.sh');
    let output: string;
    expect(() => {
      output = execSync(`bash ${scriptPath}`, { encoding: 'utf8', cwd: REPO_ROOT });
    }).not.toThrow();
    expect(output!).toContain('B37 验证全部通过');
  });
});
