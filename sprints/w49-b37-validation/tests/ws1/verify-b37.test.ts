import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const SPRINT_DIR = 'sprints/w49-b37-validation';

describe('Workstream 1 — B37 sprintDir 传递验证 [BEHAVIOR]', () => {
  it('sprint-contract.md 存在于 sprints/w49-b37-validation/（Proposer 写入正确目录，sprintDir 正确传递）', () => {
    // 此测试在 Red 阶段失败：contract-draft.md ≠ sprint-contract.md，后者由 Brain GAN 批准后创建
    // Generator 任务完成后 Green
    const contractPath = path.join(REPO_ROOT, SPRINT_DIR, 'sprint-contract.md');
    expect(existsSync(contractPath)).toBe(true);
  });

  it('verify-b37.sh 存在于 sprints/w49-b37-validation/ 且含 ≥4 个 ✅ PASS 标记', () => {
    // 此测试在 Red 阶段失败：verify-b37.sh 尚不存在
    // Generator 创建脚本后 Green
    const scriptPath = path.join(REPO_ROOT, SPRINT_DIR, 'verify-b37.sh');
    expect(existsSync(scriptPath)).toBe(true);
    const content = readFileSync(scriptPath, 'utf8');
    const passCount = (content.match(/✅ PASS/g) || []).length;
    expect(passCount).toBeGreaterThanOrEqual(4);
  });
});
