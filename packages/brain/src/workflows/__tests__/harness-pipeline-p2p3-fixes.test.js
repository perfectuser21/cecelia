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
  // （06-12 重构：thread_id 抽成 threadId 变量并追加合同后缀，仍含 final_e2e_fix_count）
  it('Bug 7: runSubTaskNode thread_id 追加 final_e2e_fix_count 保证 retry 用 fresh checkpoint', () => {
    const fnMatch = initCode.match(/export async function runSubTaskNode[\s\S]*?(?=\nexport |\n\/\/ ──)/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch[0];
    // 2026-06-27 审计：thread_id 公式收口进 buildTaskThreadId SSOT。
    // final_e2e_fix_count 作为 fixRound 入参传入（buildTaskThreadId 单测保证它进 thread_id）。
    expect(fnBody).toMatch(/const\s+threadId\s*=\s*buildTaskThreadId\([\s\S]*?final_e2e_fix_count/);
    expect(fnBody).toMatch(/thread_id:\s*threadId/);
  });

  // 06-12 死线程修复: thread_id 还须绑定合同版本（contractBranch）→ 合同重新收敛用 fresh 线程
  it('死线程修复: runSubTaskNode thread_id 经 buildTaskThreadId 绑定 contractBranchForThread(合同版本)', () => {
    const fnMatch = initCode.match(/export async function runSubTaskNode[\s\S]*?(?=\nexport |\n\/\/ ──)/);
    const fnBody = fnMatch[0];
    // buildTaskThreadId 第 4 入参 = contractBranch；SSOT 内部追加合同后缀（见 harness-build-task-thread-id.test.js）
    expect(fnBody).toMatch(/buildTaskThreadId\([\s\S]*?contractBranchForThread/);
  });
});
