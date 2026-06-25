import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getTaskLocation } from '../task-router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────────────────────────────────────
// Slice 1：staging_e2e 路由——必须留在 US 本机走 Brain 内部 handler，
// 不能被误送到西安 codex / 不能被当作未知 task_type 拒绝。
// ──────────────────────────────────────────────────────────────────────────

describe('staging_e2e task_type 路由', () => {
  it('staging_e2e 是合法 task_type（不被 invalid 拒绝）', () => {
    const src = readFileSync(resolve(__dirname, '../task-router.js'), 'utf8');
    expect(src).toMatch(/'staging_e2e'/);
  });

  it("staging_e2e location=us（不送西安 codex）", () => {
    expect(getTaskLocation('staging_e2e')).toBe('us');
  });

  it('executor triggerCeceliaRun 有 staging_e2e 内部 handler 分支（在 retired 块之前）', () => {
    const src = readFileSync(resolve(__dirname, '../executor.js'), 'utf8');
    const stagingIdx = src.indexOf("task.task_type === 'staging_e2e'");
    // retired 短路块（if 守卫，非顶部 override 排除）：staging_e2e 分支必须在它之前
    const retiredGuardIdx = src.indexOf('if (_RETIRED_HARNESS_TYPES.has(task.task_type)) {');
    expect(stagingIdx).toBeGreaterThan(-1);
    expect(retiredGuardIdx).toBeGreaterThan(-1);
    expect(stagingIdx).toBeLessThan(retiredGuardIdx);
  });

  it('staging_e2e handler 用 runStagingE2e（复用 runner，不内联实现）', () => {
    const src = readFileSync(resolve(__dirname, '../executor.js'), 'utf8');
    expect(src).toMatch(/runStagingE2e/);
  });
});
