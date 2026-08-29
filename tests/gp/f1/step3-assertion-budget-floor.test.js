// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：信任断言 npm 安装预算 ↔ run deadline 钳制
//
// r75/r79/r80/r81 四轮实证（"依赖装失败"病族真根因）：旧公式
// min(1800, deadline 剩余秒)——run 后期重取证（recollect/人审后重派）时 deadline
// 余量常只剩秒级（RED 实测钳到 29s/1s），616 包冷装必被 SIGTERM 超时 →
// evaluator 真实 PASS（合同全绿）被改判 FAIL → 四轮全绿 run 死于此。
//
// 修法（本批）：预算逻辑抽为单一事实源 assertion-budget.mjs（entrypoint 调用），
// 公式 = max(600, min(1800, 余量))——保底 600 秒让 npm 装完。宁可 run 略超
// deadline（validation clock 已有 fix 轮顺延兜底），不杀全绿 run。
// deadline 无效/未设时回落 configured（原语义不变）。
//
// 真 import 被改模块 assertion-budget.mjs（守卫在边上）；另以原文断言盯
// entrypoint.sh 确实调用该单一事实源（shell 边无法 import 的部分）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBudgetSeconds } from '../../../docker/cecelia-runner/assertion-budget.mjs';

const here = dirname(fileURLToPath(import.meta.url));

describe('F1 step3 — assertion npm 预算保底（r75/r79/r80/r81 四杀根治）', () => {
  const now = Date.now();

  it('deadline 只剩 30 秒 → 预算保底 600（不再被钳到秒级）', () => {
    const nearDeadline = new Date(now + 30 * 1000).toISOString();
    expect(computeBudgetSeconds(nearDeadline, '1800', now)).toBe(600);
  });

  it('deadline 已过 → 同样保底 600（重取证仍可完成安装）', () => {
    const pastDeadline = new Date(now - 3600 * 1000).toISOString();
    expect(computeBudgetSeconds(pastDeadline, '1800', now)).toBe(600);
  });

  it('负向：deadline 余量充足（1 小时）→ 钳到上限 1800 语义不变', () => {
    const farDeadline = new Date(now + 3600 * 1000).toISOString();
    expect(computeBudgetSeconds(farDeadline, '1800', now)).toBe(1800);
  });

  it('负向：余量 900 秒（600<x<1800 区间）→ 预算=余量（不被保底顶高也不被钳低）', () => {
    const midDeadline = new Date(now + 900 * 1000).toISOString();
    expect(computeBudgetSeconds(midDeadline, '1800', now)).toBe(900);
  });

  it('负向：deadline 无效 → 回落 configured（原语义不变）', () => {
    expect(computeBudgetSeconds('', '1200', now)).toBe(1200);
  });
});

describe('F1 step3 — entrypoint 调用单一事实源（shell 边原文断言）', () => {
  const sh = readFileSync(join(here, '../../../docker/cecelia-runner/entrypoint.sh'), 'utf8');
  const dockerfile = readFileSync(join(here, '../../../docker/cecelia-runner/Dockerfile'), 'utf8');

  it('runner_assertion_budget_seconds 调用 assertion-budget.mjs（不再 heredoc 内联公式）', () => {
    const seg = sh.split('runner_assertion_budget_seconds()')[1]?.slice(0, 400) ?? '';
    expect(seg).toContain('assertion-budget.mjs');
    expect(seg).not.toContain("<<'NODE'");
  });

  it('Dockerfile COPY assertion-budget.mjs 进镜像', () => {
    expect(dockerfile).toContain('COPY assertion-budget.mjs /usr/local/lib/cecelia/assertion-budget.mjs');
  });
});
