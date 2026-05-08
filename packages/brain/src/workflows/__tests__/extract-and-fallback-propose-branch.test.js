import { describe, it, expect } from 'vitest';
import { extractProposeBranch, fallbackProposeBranch } from '../harness-gan.graph.js';

describe('extractProposeBranch [BEHAVIOR]', () => {
  it('命中 SKILL Step 4 模板的 verdict JSON', () => {
    const stdout = '...some logs...\n{"verdict": "PROPOSED", "contract_draft_path": "x", "propose_branch": "cp-harness-propose-r2-49dafaf4", "workstream_count": 1, "test_files_count": 1, "task_plan_path": "y"}\n';
    expect(extractProposeBranch(stdout)).toBe('cp-harness-propose-r2-49dafaf4');
  });

  it('stdout 无 JSON 时返回 null', () => {
    expect(extractProposeBranch('just some logs without json\n')).toBeNull();
    expect(extractProposeBranch('')).toBeNull();
    expect(extractProposeBranch(null)).toBeNull();
  });
});

describe('fallbackProposeBranch [BEHAVIOR]', () => {
  it('返回 cp-harness-propose-r{round}-{taskIdSlice} 格式', () => {
    expect(fallbackProposeBranch('49dafaf4-1d84-4da4-b4a8-4f5b9c56facf', 2)).toBe('cp-harness-propose-r2-49dafaf4');
  });

  it('round 为 undefined / 0 / 负数 时默认 round=1', () => {
    const taskId = '49dafaf4-1d84-4da4-b4a8-4f5b9c56facf';
    expect(fallbackProposeBranch(taskId)).toBe('cp-harness-propose-r1-49dafaf4');
    expect(fallbackProposeBranch(taskId, 0)).toBe('cp-harness-propose-r1-49dafaf4');
    expect(fallbackProposeBranch(taskId, -1)).toBe('cp-harness-propose-r1-49dafaf4');
  });

  it('null / undefined taskId 返回 cp-harness-propose-r{round}-unknown', () => {
    expect(fallbackProposeBranch(null, 3)).toBe('cp-harness-propose-r3-unknown');
    expect(fallbackProposeBranch(undefined, 1)).toBe('cp-harness-propose-r1-unknown');
  });

  it('短 taskId（<8字符）原样使用，不补零', () => {
    expect(fallbackProposeBranch('abc', 1)).toBe('cp-harness-propose-r1-abc');
  });
});
