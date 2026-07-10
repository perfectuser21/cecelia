/**
 * ci-path-filter-brain.test.js
 *
 * Fidelity-gate 层1 回归（defense-in-depth）：CI `changes` job 判 `brain=`。
 *
 * 历史（run 926779b5）：harness generator 曾把"brain 功能"只当 test 文件交在 sprints/ 下，
 * 那时 brain vitest include 含 sprints/**，故让 sprints/**\/*.{test,spec}.* 也触发 brain=true，
 * 否则那条 Red 测试不在 CI 跑。
 *
 * 07-10 断源后（测试资产大扫除）：sprints/** 已从 brain vitest include 移除——sprints/ 下的
 * 测试不再被 brain-unit 收集，守活功能测试已升格进 src/__tests__/。因此 sprints/ 测试改动
 * 不应再触发 brain-unit（无测试可跑，纯空转）。harness 在飞 sprint 的 Red 测试改由
 * harness-v5-checks.yml 的 "Sprint Tests 实跑" job（diff-scoped + 真 Postgres）覆盖，
 * 不再依赖 brain-unit。本测试守护 path-filter 与 ci.yml 逻辑同步（断源后语义）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CI_YML = resolve(__dirname, '../../../../.github/workflows/ci.yml');

// 与 ci.yml `changes` job 的 brain 检测保持一致的正则（断源后：只认 packages/brain/）
const BRAIN_DETECT_RE = /^packages\/brain\//;

function detectsBrain(changedFiles) {
  return changedFiles.some((f) => BRAIN_DETECT_RE.test(f));
}

describe('CI brain path-filter', () => {
  it('真 brain 源码改动 → brain=true', () => {
    expect(detectsBrain(['packages/brain/src/routes/harness.js'])).toBe(true);
  });

  it('sprints/ 下的 test/spec 文件 → brain=false（断源：sprints 不再进 brain-unit，改由 Sprint Tests 实跑 job 覆盖）', () => {
    expect(detectsBrain(['sprints/open2-verify-06031535/tests/harness-healthz.test.js'])).toBe(false);
    expect(detectsBrain(['sprints/x/tests/y.spec.ts'])).toBe(false);
  });

  it('sprints/ 下的非测试文件（prd/合同）→ 不触发 brain', () => {
    expect(detectsBrain(['sprints/x/prep-prd.md'])).toBe(false);
    expect(detectsBrain(['sprints/x/contract-dod.md'])).toBe(false);
    expect(detectsBrain(['sprints/x/task-plan.json'])).toBe(false);
  });

  it('纯前端/无关改动 → brain=false', () => {
    expect(detectsBrain(['apps/dashboard/src/App.tsx', 'docs/x.md'])).toBe(false);
  });

  it('ci.yml 的 brain= 检测行与本测试 pattern 同步（断源后只认 packages/brain/，不含 sprints）', () => {
    const yml = readFileSync(CI_YML, 'utf8');
    const brainLine = yml.split('\n').find((l) => l.includes('brain=$(') && l.includes('CHANGED'));
    expect(brainLine, 'ci.yml 应有 brain=$(echo "$CHANGED" ...) 检测行').toBeTruthy();
    // 断源后：必须匹配 packages/brain/，且不再含 sprints 触发（避免空转）
    expect(brainLine).toContain('packages/brain/');
    expect(brainLine).not.toContain('sprints/');
  });
});
