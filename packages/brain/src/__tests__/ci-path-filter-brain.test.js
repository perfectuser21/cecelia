/**
 * ci-path-filter-brain.test.js
 *
 * Fidelity-gate 层1 回归（defense-in-depth）：CI `changes` job 原本判
 * `brain= grep '^packages/brain/'`。harness generator 把"brain 功能"只当 test 文件交在
 * sprints/ 下（run 926779b5），diff 无 packages/brain/ → brain=false → brain-unit 全 skip，
 * 那条在 sprints/ 的 Red 测试根本没在 CI 跑。
 *
 * 修法：让 sprints/**\/*.{test,spec}.* 改动也触发 brain=true（这些测试在 brain vitest
 * include 里，必须跑）。本测试守护 path-filter 的正确性 + ci.yml 与逻辑同步。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CI_YML = resolve(__dirname, '../../../../.github/workflows/ci.yml');

// 与 ci.yml `changes` job 的 brain 检测保持一致的正则（单一事实：下方 sync 测试校验 ci.yml 含此 pattern）
const BRAIN_DETECT_RE = /^packages\/brain\/|^sprints\/.*\.(test|spec)\.[cm]?[jt]sx?$/;

function detectsBrain(changedFiles) {
  return changedFiles.some((f) => BRAIN_DETECT_RE.test(f));
}

describe('CI brain path-filter', () => {
  it('真 brain 源码改动 → brain=true', () => {
    expect(detectsBrain(['packages/brain/src/routes/harness.js'])).toBe(true);
  });

  it('sprints/ 下的 test/spec 文件 → brain=true（关键修复：否则 Red 测试不跑）', () => {
    expect(detectsBrain(['sprints/open2-verify-06031535/tests/harness-healthz.test.js'])).toBe(true);
    expect(detectsBrain(['sprints/harness-verify-ping/packages/brain/src/routes/__tests__/harness.ping.test.js'])).toBe(true);
    expect(detectsBrain(['sprints/x/tests/y.spec.ts'])).toBe(true);
  });

  it('sprints/ 下的非测试文件（prd/合同）→ 不触发 brain（避免无谓全跑）', () => {
    expect(detectsBrain(['sprints/x/prep-prd.md'])).toBe(false);
    expect(detectsBrain(['sprints/x/contract-dod.md'])).toBe(false);
    expect(detectsBrain(['sprints/x/task-plan.json'])).toBe(false);
  });

  it('纯前端/无关改动 → brain=false', () => {
    expect(detectsBrain(['apps/dashboard/src/App.tsx', 'docs/x.md'])).toBe(false);
  });

  it('ci.yml 的 brain= 检测行与本测试 pattern 同步（含 sprints test 触发）', () => {
    const yml = readFileSync(CI_YML, 'utf8');
    const brainLine = yml.split('\n').find((l) => l.includes('brain=$(') && l.includes('CHANGED'));
    expect(brainLine, 'ci.yml 应有 brain=$(echo "$CHANGED" ...) 检测行').toBeTruthy();
    // 必须既匹配 packages/brain/ 又匹配 sprints 下的 test/spec
    expect(brainLine).toContain('packages/brain/');
    expect(brainLine).toContain('sprints/');
    expect(brainLine).toMatch(/test\|spec|test,spec|\(test\|spec\)/);
  });
});
