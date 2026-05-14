import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const SPRINT_DIR = 'sprints/w49-b37-validation';

describe('Workstream 1 — B37 git diff sprintDir 验证 [BEHAVIOR]', () => {
  it('git diff --name-only 输出含 sprints/w49-b37-validation/', () => {
    const diffOut = execSync(
      'git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null || true',
      { cwd: REPO_ROOT, encoding: 'utf8' }
    ).trim();
    expect(diffOut).toContain('sprints/w49-b37-validation/');
  });

  it('sprint-prd.md 存在于 sprints/w49-b37-validation/', () => {
    const prdPath = path.join(REPO_ROOT, SPRINT_DIR, 'sprint-prd.md');
    expect(existsSync(prdPath)).toBe(true);
  });

  it('sprint-contract.md 存在于 sprints/w49-b37-validation/（Proposer 写入正确目录）', () => {
    // 此测试在 Red 阶段必然失败（contract 尚不存在）
    // Generator 写入 sprint-contract.md 后 Green
    const contractPath = path.join(REPO_ROOT, SPRINT_DIR, 'sprint-contract.md');
    expect(existsSync(contractPath)).toBe(true);
  });

  it('verify-b37.sh 存在且含 4 个 PASS 标记', () => {
    // 此测试在 Red 阶段必然失败（verify-b37.sh 尚不存在）
    // Generator 创建脚本后 Green
    const scriptPath = path.join(REPO_ROOT, SPRINT_DIR, 'verify-b37.sh');
    expect(existsSync(scriptPath)).toBe(true);
    if (existsSync(scriptPath)) {
      const { readFileSync } = require('fs');
      const content = readFileSync(scriptPath, 'utf8');
      const passCount = (content.match(/✅ PASS/g) || []).length;
      expect(passCount).toBeGreaterThanOrEqual(4);
    }
  });
});
