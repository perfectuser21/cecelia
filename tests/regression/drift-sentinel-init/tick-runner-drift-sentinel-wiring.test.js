/**
 * tick-runner-drift-sentinel-wiring.test.js — G2 哑火修复回归测试
 *
 * 根因：G2 PR (#4006) 把 drift sentinel 接入了已废弃的 executeTick
 * （Wave 2 起从不被调用），正确接入点是 scheduler-jobs.js JOBS。
 * 本测试用源码自省验证：不烧 LLM、不接真实 DB。
 *
 * TDD Red: 以下断言在修复前全部失败。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 毕业搬家修正（5167ef48 顺手清雷）：sprints/<x>/tests/ 时代是 4 级，tests/regression/<x>/ 是 3 级
const BRAIN_SRC = resolve(__dirname, '../../../packages/brain/src');

const SCHEDULER_JOBS_SRC = readFileSync(resolve(BRAIN_SRC, 'scheduler-jobs.js'), 'utf8');
const DRIFT_SENTINEL_SRC = readFileSync(resolve(BRAIN_SRC, 'cron/drift-sentinel.js'), 'utf8');
const TICK_RUNNER_SRC = readFileSync(resolve(BRAIN_SRC, 'tick-runner.js'), 'utf8');

describe('G2 drift-sentinel 接线修复（scheduler-jobs 路径）', () => {
  // ─── scheduler-jobs.js 接线 ───────────────────────────────────────────────

  it('scheduler-jobs.js 导入 runDriftSentinel', () => {
    // G2 PR (#4006) 把 drift sentinel 只挂在 executeTick（已废弃），
    // 必须改为从 scheduler-jobs.js 正式调度
    expect(SCHEDULER_JOBS_SRC).toMatch(/import.*runDriftSentinel.*drift-sentinel/);
  });

  it('scheduler-jobs.js JOBS 数组含 drift-sentinel 条目', () => {
    expect(SCHEDULER_JOBS_SRC).toMatch(/name:\s*['"]drift-sentinel['"]/);
  });

  it('drift-sentinel JOBS 条目使用 runDriftSentinel 作为 handler', () => {
    // handler: runDriftSentinel
    expect(SCHEDULER_JOBS_SRC).toMatch(/handler:\s*runDriftSentinel/);
  });

  // ─── drift-sentinel.js 内置 30min gate ───────────────────────────────────

  it('drift-sentinel.js 有模块级 lastRunAt = 0 内置间隔门控', () => {
    // 模块自 gate 模式（同 launchd-patrol.js）：
    // let lastRunAt = 0；每次调用先检查时间间隔，未到 30min 直接 return skipped
    expect(DRIFT_SENTINEL_SRC).toMatch(/let\s+lastRunAt\s*=\s*0/);
  });

  it('drift-sentinel.js runDriftSentinel 导出测试用 _resetLastRunAt', () => {
    // 测试隔离钩子，与 tick-state.js 的 _resetLastXxxTime 模式一致
    expect(DRIFT_SENTINEL_SRC).toMatch(/export function _resetLastRunAt/);
  });

  it('drift-sentinel.js runDriftSentinel 内置 30min 跳过逻辑（两次调用间隔短则 skip）', () => {
    // 函数内有 lastRunAt 检查，保证 scheduler-jobs 60s 轮询下只有每 30min 才真跑
    expect(DRIFT_SENTINEL_SRC).toMatch(/lastRunAt.*DRIFT_SENTINEL_INTERVAL_MS|DRIFT_SENTINEL_INTERVAL_MS.*lastRunAt/s);
  });

  // ─── tick-runner.js 10.25 段防御性读守 ──────────────────────────────────

  it('tick-runner.js 10.25 段使用 ||0 防 NaN 守卫', () => {
    // (tickState.lastDriftSentinelTime||0) 防止 undefined 导致 NaN 比较恒假
    // 即便 executeTick 已废弃，此行保留作为若将来复活的双保险
    expect(TICK_RUNNER_SRC).toMatch(/\(tickState\.lastDriftSentinelTime\s*\|\|\s*0\)/);
  });
});
