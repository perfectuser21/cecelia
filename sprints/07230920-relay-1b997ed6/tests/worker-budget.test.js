/**
 * worker-budget.test.js — B-06: worker 预算 min(角色上限, 剩余总预算)
 *
 * TDD 骨架：全红状态。
 * 目标函数：computeWorkerDeadlineSecs(role, runStartedAt, nowAt, totalBudgetMs)
 * 来源：packages/brain/src/orchestrator/gates.js 或 constants.js（待实现）
 *
 * FR-03 要求：
 * - planner/proposer/reviewer/judge 角色上限 = 600 秒（10 分钟）
 * - generator/evaluator 角色上限 = 1800 秒（30 分钟）
 * - 实际超时 = min(角色上限秒数, run 剩余预算秒数)
 * - SUPERVISOR_DEADLINE_SECONDS 不得为 28800
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '../../..');

// TODO: 实现后取消注释
// import { computeWorkerDeadlineSecs, ROLE_BUDGET_SECS } from '../../../packages/brain/src/orchestrator/constants.js';

// Placeholder — 全红骨架
function computeWorkerDeadlineSecs(_role, _runStartedAt, _nowAt, _totalBudgetMs) {
  return undefined; // 未实现
}

const ROLE_BUDGET_SECS = {
  planner: undefined,   // 待实现: 600
  proposer: undefined,  // 待实现: 600
  reviewer: undefined,  // 待实现: 600
  judge: undefined,     // 待实现: 600
  generator: undefined, // 待实现: 1800
  evaluator: undefined, // 待实现: 1800
};

const BASE = new Date('2026-01-01T00:00:00.000Z');
const TOTAL_BUDGET_MS = 120 * 60 * 1000;

function at(offsetMs) { return new Date(BASE.getTime() + offsetMs); }
function minMs(m) { return m * 60 * 1000; }

describe('B-06: 角色预算常量', () => {
  it('planner 角色上限 = 600 秒', () => {
    expect(ROLE_BUDGET_SECS.planner).toBe(600);
  });

  it('proposer 角色上限 = 600 秒', () => {
    expect(ROLE_BUDGET_SECS.proposer).toBe(600);
  });

  it('reviewer 角色上限 = 600 秒', () => {
    expect(ROLE_BUDGET_SECS.reviewer).toBe(600);
  });

  it('judge 角色上限 = 600 秒', () => {
    expect(ROLE_BUDGET_SECS.judge).toBe(600);
  });

  it('generator 角色上限 = 1800 秒', () => {
    expect(ROLE_BUDGET_SECS.generator).toBe(1800);
  });

  it('evaluator 角色上限 = 1800 秒', () => {
    expect(ROLE_BUDGET_SECS.evaluator).toBe(1800);
  });
});

describe('B-06: computeWorkerDeadlineSecs 纯函数', () => {
  it('run 刚开始（剩余 120 分钟）+ planner → min(600, 7200) = 600 秒', () => {
    const result = computeWorkerDeadlineSecs('planner', BASE, BASE, TOTAL_BUDGET_MS);
    expect(result).toBe(600);
  });

  it('run 刚开始 + generator → min(1800, 7200) = 1800 秒', () => {
    const result = computeWorkerDeadlineSecs('generator', BASE, BASE, TOTAL_BUDGET_MS);
    expect(result).toBe(1800);
  });

  it('run 已用 119 分钟（剩余 60 秒）+ generator → min(1800, 60) = 60 秒', () => {
    const nowAt = at(minMs(119));
    const remainingSecs = (TOTAL_BUDGET_MS - minMs(119)) / 1000;
    const result = computeWorkerDeadlineSecs('generator', BASE, nowAt, TOTAL_BUDGET_MS);
    expect(result).toBe(Math.floor(remainingSecs));
    expect(result).toBe(60);
  });

  it('run 已用 118 分钟（剩余 2 分钟）+ judge → min(600, 120) = 120 秒', () => {
    const nowAt = at(minMs(118));
    const result = computeWorkerDeadlineSecs('judge', BASE, nowAt, TOTAL_BUDGET_MS);
    expect(result).toBe(120);
  });

  it('run 已超过 deadline（剩余 ≤0）→ 返回 0 或抛出（不允许负数）', () => {
    const nowAt = at(minMs(121));
    const result = computeWorkerDeadlineSecs('planner', BASE, nowAt, TOTAL_BUDGET_MS);
    expect(result).toBeGreaterThanOrEqual(0);
    // 不允许负数的 deadline 秒数
    expect(result).not.toBeLessThan(0);
  });

  it('未知角色 → 抛出错误（防止 magic fallback）', () => {
    expect(() => computeWorkerDeadlineSecs('unknown_role', BASE, BASE, TOTAL_BUDGET_MS)).toThrow();
  });
});

describe('B-06: SUPERVISOR_DEADLINE_SECONDS 不得硬编码 28800', () => {
  it('codex-supervisor.mjs 不含 28800 默认值', () => {
    const src = readFileSync(join(WORKSPACE_ROOT, 'scripts/codex-supervisor.mjs'), 'utf8');
    // 不得有 '28800' 作为默认值（process.env.X ?? '28800' 形式）
    expect(src).not.toMatch(/'\s*28800\s*'/);
    expect(src).not.toMatch(/"\s*28800\s*"/);
  });

  it('grok-supervisor.mjs 不含 28800 默认值', () => {
    const src = readFileSync(join(WORKSPACE_ROOT, 'scripts/grok-supervisor.mjs'), 'utf8');
    expect(src).not.toMatch(/'\s*28800\s*'/);
    expect(src).not.toMatch(/"\s*28800\s*"/);
  });
});
