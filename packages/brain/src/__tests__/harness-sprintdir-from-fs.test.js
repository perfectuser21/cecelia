/**
 * resolveSprintDirFromFs — sprint_dir 单一真相源（文件系统锚定）
 *
 * 根因：sprintDir 由 parsePrdNode 一堆启发式（verdict 正则/git-log/readdir 子目录扫描）算出，
 * 这些都受 git commit 时机/round/sprints/tests 子目录污染 → 算成 sprints/tests →
 * 下游所有消费者（defaultReadContractFile/verifyProposer/infer_task_plan）盲信错值 → 连环失败。
 *
 * 修法：sprint-prd.md 是 planner 唯一创建一次的锚点，其文件系统位置就是 sprint 目录的唯一真相。
 * resolveSprintDirFromFs find 它，取最短路径（最接近 sprints/ 根）的 dirname。
 */
import { describe, it, expect } from 'vitest';
import { resolveSprintDirFromFs } from '../workflows/harness-initiative.graph.js';

function fakeExec(findStdout) {
  return async () => ({ stdout: findStdout });
}

describe('resolveSprintDirFromFs', () => {
  it('sprint-prd.md 在 sprints/ 根 → 返回 sprints', async () => {
    const r = await resolveSprintDirFromFs('/wt', {
      execFile: fakeExec('/wt/sprints/sprint-prd.md\n'),
    });
    expect(r).toBe('sprints');
  });

  it('sprint-prd.md 在 sprints/<feature>/ 子目录 → 返回该子目录', async () => {
    const r = await resolveSprintDirFromFs('/wt', {
      execFile: fakeExec('/wt/sprints/clamp-feat/sprint-prd.md\n'),
    });
    expect(r).toBe('sprints/clamp-feat');
  });

  it('多个 sprint-prd.md → 取最短路径（最接近根，排除嵌套污染）', async () => {
    const r = await resolveSprintDirFromFs('/wt', {
      execFile: fakeExec('/wt/sprints/tests/fixtures/sprint-prd.md\n/wt/sprints/sprint-prd.md\n'),
    });
    expect(r).toBe('sprints');
  });

  it('find 无结果 → null（让调用方走 fallback）', async () => {
    const r = await resolveSprintDirFromFs('/wt', { execFile: fakeExec('') });
    expect(r).toBeNull();
  });

  it('find 抛错 → null（不崩）', async () => {
    const r = await resolveSprintDirFromFs('/wt', {
      execFile: async () => { throw new Error('find failed'); },
    });
    expect(r).toBeNull();
  });
});
