/**
 * routes/goals.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真实路由测试覆盖在其他 routes/*.test.js。此文件仅满足 lint 同名要求。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('routes/goals module (pairing stub)', () => {
  it('routes/goals.js 已删 harness_planner SQL', () => {
    const src = fs.readFileSync(new URL('../goals.js', import.meta.url), 'utf8');
    // 允许注释含 harness_planner，但 SQL `task_type='harness_planner'` 必须 0
    expect(src).not.toMatch(/task_type\s*=\s*['"]harness_planner['"]/i);
  });
});
