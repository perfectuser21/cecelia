/**
 * B44 — runPlannerNode prompt 不应包含要求输出 task-plan.json 的矛盾指令
 * task-plan.json 由 Proposer 写到 propose_branch，Planner 只需输出 sprint_dir verdict JSON
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'harness-initiative.graph.js');

describe('B44 — runPlannerNode prompt 源码契约 [BEHAVIOR]', () => {
  it('runPlannerNode prompt 不含"在 stdout 末尾输出 task-plan.json"', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/在 stdout 末尾输出 task-plan\.json/);
    expect(src).not.toMatch(/task-plan\.json 必须被.*代码块包裹/);
  });

  it('runPlannerNode prompt 包含 sprint_dir verdict JSON 输出要求', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/sprint_dir.*verdict.*DONE/);
  });
});
