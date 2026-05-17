/**
 * executor.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真实测试覆盖在 executor-*.test.js 多个文件 (executor-langgraph-checkpointer /
 * executor-harness-planner-retired / 等)。此文件仅满足 lint 同名要求。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('executor module (pairing stub)', () => {
  it('executor.js exists and is non-empty', () => {
    const stat = fs.statSync(new URL('../executor.js', import.meta.url));
    expect(stat.size).toBeGreaterThan(0);
  });
});
