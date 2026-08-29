// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：信任断言 npm 安装预算 ↔ run deadline 钳制
//
// r75/r79/r80/r81 四轮实证（"依赖装失败"病族真根因）：entrypoint 的
// runner_assertion_budget_seconds = min(1800, deadline 剩余秒)——run 后期重取证
// （recollect/人审后重派）时 deadline 余量常只剩秒级，616 包冷装必被 SIGTERM
// 超时 → evaluator 真实 PASS（合同全绿）被改判 FAIL → 四轮全绿 run 死于此。
//
// 修法（本批）：预算 = max(600, min(1800, 余量))——保底 600 秒让 npm 装完。
// 宁可 run 略超 deadline（validation clock 已有 fix 轮顺延兜底），不杀全绿 run。
// deadline 无效/未设时回落 configured（原语义不变）。
//
// shell 边测试：真跑 entrypoint 里的 node 预算片段（原文抽取执行，不 mock）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const sh = readFileSync(join(here, '../../../docker/cecelia-runner/entrypoint.sh'), 'utf8');

// 抽取 runner_assertion_budget_seconds() 内嵌的 node heredoc 脚本原文
function extractBudgetNode() {
  const start = sh.indexOf('runner_assertion_budget_seconds()');
  const nodeStart = sh.indexOf("<<'NODE'", start);
  const nodeEnd = sh.indexOf('\nNODE', nodeStart);
  expect(start).toBeGreaterThan(-1);
  expect(nodeStart).toBeGreaterThan(-1);
  expect(nodeEnd).toBeGreaterThan(-1);
  return sh.slice(nodeStart + "<<'NODE'".length, nodeEnd);
}

function runBudget(deadlineArg, configuredArg) {
  const script = extractBudgetNode();
  return Number(execFileSync('node', ['-', deadlineArg, configuredArg], {
    input: script, encoding: 'utf8',
  }));
}

describe('F1 step3 — assertion npm 预算保底（r75/r79/r80/r81 四杀根治）', () => {
  it('deadline 只剩 30 秒 → 预算保底 600（不再被钳到秒级）', () => {
    const nearDeadline = new Date(Date.now() + 30 * 1000).toISOString();
    expect(runBudget(nearDeadline, '1800')).toBe(600);
  });

  it('deadline 已过 → 同样保底 600（重取证仍可完成安装）', () => {
    const pastDeadline = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(runBudget(pastDeadline, '1800')).toBe(600);
  });

  it('负向：deadline 余量充足（1 小时）→ 预算=余量语义不变（约 3600 钳到 1800）', () => {
    const farDeadline = new Date(Date.now() + 3600 * 1000).toISOString();
    expect(runBudget(farDeadline, '1800')).toBe(1800);
  });

  it('负向：余量 900 秒（600<x<1800 区间）→ 预算=余量（不被保底顶高也不被钳低）', () => {
    const midDeadline = new Date(Date.now() + 900 * 1000).toISOString();
    const v = runBudget(midDeadline, '1800');
    expect(v).toBeGreaterThanOrEqual(895);
    expect(v).toBeLessThanOrEqual(900);
  });

  it('负向：deadline 无效 → 回落 configured（原语义不变）', () => {
    expect(runBudget('', '1200')).toBe(1200);
  });
});
