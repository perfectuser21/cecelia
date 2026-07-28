import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  checkEvaluator,
  checkReviewer,
  checkGenerator,
  checkProposer,
  REVIEWER_DIMENSIONS,
} from '../skill-contract-check.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
// __tests__ → ci → scripts → brain → packages → repo root
const ROOT = join(__dir, '..', '..', '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const evaluator = read('packages/workflows/skills/harness-evaluator/SKILL.md');
const evaluatorBody = evaluator.slice(evaluator.indexOf('# /harness-evaluator'));
const reviewer = read('packages/workflows/skills/harness-contract-reviewer/SKILL.md');
const generator = read('packages/workflows/skills/harness-generator/SKILL.md');
const proposer = read('packages/workflows/skills/harness-contract-proposer/SKILL.md');
const sharedJs = read('packages/brain/src/harness-shared.js');

describe('skill-contract — 5 类不变量守现网快照', () => {
  it('不变量1: evaluator 正文含 env_missing / B-1.6 / B-1.8 段（B-1.7 已下沉 Contract Gate 代码层，v1.16.0）', () => {
    const r = checkEvaluator(evaluator);
    // 仅看「段缺失」类不变量（排除 ws_id 残留项，由不变量2 单独守）
    expect(r.missing.filter((x) => x !== 'ws_id_residual')).toEqual([]);
  });

  it('不变量2: evaluator 正文（frontmatter 之后）无 ws_id 残留', () => {
    const r = checkEvaluator(evaluator);
    expect(r.missing).not.toContain('ws_id_residual');
    expect(r.ok).toBe(true);
  });

  it('不变量3: reviewer 7 维名与 harness-shared.js ReviewerOutputSchema 逐字一致', () => {
    expect(checkReviewer(reviewer).ok).toBe(true);
    // 7 维名同时必须出现在 schema 来源（逐字一致的比对锚点）
    for (const d of REVIEWER_DIMENSIONS) expect(sharedJs).toContain(d);
  });

  it('不变量4: generator 无可执行 gh pr merge', () => {
    expect(checkGenerator(generator).ok).toBe(true);
  });

  it('不变量5: proposer 含「领域验证规则」段', () => {
    expect(checkProposer(proposer).ok).toBe(true);
  });

  it('不变量6: evaluator 只产证据，不 commit/push PR 分支', () => {
    expect(evaluatorBody).toContain('Evaluator 禁止 commit/push');
    expect(evaluatorBody).not.toMatch(/\bgit\s+commit\b/);
    expect(evaluatorBody).not.toMatch(/\bgit\s+push\b/);
  });

  it('不变量7: reviewer judgment 写入与回读都使用 task-bound authority', () => {
    expect(reviewer).toContain("source_ref: SPRINT_ID");
    expect(reviewer).toContain(
      '/api/brain/strategic-decisions?category=judgment&source_ref=$TASK_ID',
    );
    expect(reviewer).not.toContain('/api/brain/decisions?category=judgment');
  });
});
