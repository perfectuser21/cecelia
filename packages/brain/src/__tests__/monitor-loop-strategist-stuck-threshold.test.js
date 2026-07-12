/**
 * monitor-loop-strategist-stuck-threshold.test.js
 *
 * 回归测试：strategist_decision（及 ci_patrol）必须进入 HARNESS_TASK_TYPES 列表，
 * 使用 30 分钟 stuck 阈值而非默认 5 分钟——否则 ~5min 的容器正常运行会被误判为卡住，
 * 触发 RESTART/RETRY，completed 被打回 queued，形成振荡循环。
 *
 * 根因（bug2 次要路径）：HARNESS_TASK_TYPES 未包含 strategist_decision，
 * detectStuckRuns 的 CASE 分支使用 5 分钟阈值，容器刚跑完即被判卡住。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONITOR_LOOP_PATH = resolve(__dirname, '../monitor-loop.js');
const SRC = readFileSync(MONITOR_LOOP_PATH, 'utf8');

describe('monitor-loop.js — HARNESS_TASK_TYPES 包含 strategist_decision（stuck 阈值回归）', () => {
  it('HARNESS_TASK_TYPES 数组包含 strategist_decision', () => {
    expect(SRC).toMatch(/HARNESS_TASK_TYPES\s*=\s*\[[\s\S]*?'strategist_decision'[\s\S]*?\]/);
  });

  it('HARNESS_TASK_TYPES 数组包含 ci_patrol', () => {
    expect(SRC).toMatch(/HARNESS_TASK_TYPES\s*=\s*\[[\s\S]*?'ci_patrol'[\s\S]*?\]/);
  });

  it('HARNESS_STUCK_THRESHOLD_MINUTES 使用 30 分钟', () => {
    expect(SRC).toMatch(/HARNESS_STUCK_THRESHOLD_MINUTES\s*=\s*30/);
  });

  it('detectStuckRuns 对 HARNESS_TASK_TYPES 使用 HARNESS_STUCK_THRESHOLD_MINUTES', () => {
    // detectStuckRuns 内的 CASE 表达式同时引用 HARNESS_TASK_TYPES 和 HARNESS_STUCK_THRESHOLD_MINUTES
    const fnStart = SRC.indexOf('async function detectStuckRuns');
    expect(fnStart, '必须找到 detectStuckRuns 函数').toBeGreaterThan(-1);
    const fnEnd = SRC.indexOf('\nasync function ', fnStart + 1);
    const fnBody = fnEnd > fnStart ? SRC.slice(fnStart, fnEnd) : SRC.slice(fnStart);
    expect(fnBody).toContain('HARNESS_TASK_TYPES');
    expect(fnBody).toContain('HARNESS_STUCK_THRESHOLD_MINUTES');
  });
});
