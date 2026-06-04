/**
 * detectSprintDirFromGitLog — 修 sprint_dir 误检测（验证线实证 bug）
 *
 * Bug：parsePrdNode 用 /sprints\/([^/\n]+)\// 匹配 git log 新增文件，取最后一个子目录名。
 * 当 Planner 把测试放 sprints/tests/clamp.test.js（正确做法），检测把 tests 当成 sprint 目录
 * → sprintDir='sprints/tests' → Proposer 去 sprints/tests/contract-draft.md 找合同 → ENOENT → 失败。
 *
 * 修法：锚定合同标记文件（sprint-prd.md/contract-*.md）所在目录，而非猜子目录名；
 * 次选子目录时排除 tests/ 等已知非-sprint 目录。
 */
import { describe, it, expect } from 'vitest';
import { detectSprintDirFromGitLog } from '../workflows/harness-initiative.graph.js';

describe('detectSprintDirFromGitLog', () => {
  it('合同文件直接在 sprints/ + 测试在 sprints/tests/ → 返回 sprints（不被 tests 误导）', () => {
    const log = [
      'sprints/contract-dod.md',
      'sprints/contract-draft.md',
      'sprints/task-plan.json',
      'sprints/sprint-prd.md',
      'sprints/tests/clamp.test.js',
    ].join('\n');
    expect(detectSprintDirFromGitLog(log)).toBe('sprints');
  });

  it('Planner 用 sprints/<feature>/ 子目录放合同 → 返回该子目录', () => {
    const log = [
      'sprints/clamp-feature/sprint-prd.md',
      'sprints/clamp-feature/contract-draft.md',
      'sprints/clamp-feature/tests/clamp.test.js',
    ].join('\n');
    expect(detectSprintDirFromGitLog(log)).toBe('sprints/clamp-feature');
  });

  it('只有 tests/ 子目录、无合同标记 → 不把 tests 当 sprint 目录（返回 null 让调用方 fallback）', () => {
    const log = 'sprints/tests/clamp.test.js\nsprints/tests/helper.js';
    expect(detectSprintDirFromGitLog(log)).toBeNull();
  });

  it('空 log → null', () => {
    expect(detectSprintDirFromGitLog('')).toBeNull();
    expect(detectSprintDirFromGitLog('   ')).toBeNull();
  });

  it('合同标记优先于子目录：即便有 sprints/tests/ 也认 sprint-prd.md 所在目录', () => {
    const log = 'sprints/tests/x.test.js\nsprints/sprint-prd.md';
    expect(detectSprintDirFromGitLog(log)).toBe('sprints');
  });
});
