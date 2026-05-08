import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractProposeBranch, fallbackProposeBranch } from '../harness-gan.graph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

describe('SKILL.md harness-contract-proposer 输出契约 [BEHAVIOR]', () => {
  const SKILL_PATH = resolve(__dirname, '../../../../workflows/skills/harness-contract-proposer/SKILL.md');

  it('SKILL.md 含 verdict JSON 输出契约（含 propose_branch 字段）', () => {
    const c = readFileSync(SKILL_PATH, 'utf8');
    expect(c).toContain('"propose_branch"');
  });

  it('SKILL.md 不含限定词 "GAN APPROVED 后"（v7.2.0+ 改成每轮输出）', () => {
    const c = readFileSync(SKILL_PATH, 'utf8');
    expect(c).not.toContain('GAN APPROVED 后');
  });

  it('SKILL.md 含明示「每轮」输出契约说明', () => {
    const c = readFileSync(SKILL_PATH, 'utf8');
    expect(c).toMatch(/每轮.*verdict|每轮.*propose_branch|每轮.*JSON|每轮.*输出/);
  });
});
