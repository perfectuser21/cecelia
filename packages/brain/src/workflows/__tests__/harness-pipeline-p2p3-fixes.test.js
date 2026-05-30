import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAN_SRC = resolve(__dirname, '../harness-gan.graph.js');
const INIT_SRC = resolve(__dirname, '../harness-initiative.graph.js');

describe('harness pipeline P2/P3 修复约定', () => {
  const ganCode = readFileSync(GAN_SRC, 'utf8');
  const initCode = readFileSync(INIT_SRC, 'utf8');

  // Bug 3: PLANNER_BRANCH 不得硬编码为字面量 'main'
  // planner SKILL 推到 cp-MMDDHHM-harness-prd 分支，硬编码 main 导致 git show 每次失败
  it("Bug 3: PLANNER_BRANCH 不得硬编码为字面量 'main'", () => {
    expect(ganCode).not.toContain("PLANNER_BRANCH: 'main'");
  });

  // Bug 7: runSubTaskNode 的 thread_id 必须追加 final_e2e_fix_count
  // final_evaluate FAIL → pick_sub_task 重跑时，同 thread_id 会读到旧 LangGraph checkpoint 状态
  it('Bug 7: runSubTaskNode thread_id 追加 final_e2e_fix_count 保证 retry 用 fresh checkpoint', () => {
    const fnMatch = initCode.match(/export async function runSubTaskNode[\s\S]*?(?=\nexport |\n\/\/ ──)/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch[0];
    expect(fnBody).toMatch(/thread_id.*final_e2e_fix_count/);
  });
});
