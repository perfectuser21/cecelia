/**
 * Workstream 5 — F0 7 step E2E smoke BEHAVIOR 测试（合同阶段）
 *
 * 这里跑的是合同阶段对 E2E 文件本身的 BEHAVIOR 校验：
 * - 测试文件 tests/e2e/mj1-skeleton-smoke.spec.ts 必须存在
 * - 必须出现 7 处 step 标识（step 1: ... step 7:）
 * - 必须 import 至少一个 brain 模块（不是空壳）
 * - 必须含 KR before/after +1 的断言文本
 * - 必须含 LiveMonitor / WebSocket 状态变化的断言文本
 * - 必须含 worktree 文件系统真实存在的断言
 * - 必须含 /dev mock / runDevMock 调用计数断言
 * - 必须含 callback-processor 接收 callback 的断言
 *
 * 红阶段：spec 文件不存在 → readFileSync 抛错 → 全红
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SPEC_PATH = resolve(__dirname, '../../../tests/e2e/mj1-skeleton-smoke.spec.ts');

function readSpec(): string {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(`E2E spec not found at ${SPEC_PATH}`);
  }
  return readFileSync(SPEC_PATH, 'utf8');
}

describe('Workstream 5 — F0 E2E smoke contract [BEHAVIOR]', () => {
  it('skeleton E2E covers 7 step path with step labels 1..7', () => {
    const c = readSpec();
    for (let n = 1; n <= 7; n++) {
      const re = new RegExp(`step\\s*${n}\\s*:`, 'i');
      expect(re.test(c), `missing step ${n}: label`).toBe(true);
    }
  });

  it('step 1: Dashboard 任务列表行有 start-dev-button testid', () => {
    const c = readSpec();
    expect(/start-dev-button/.test(c)).toBe(true);
  });

  it('step 2: POST /tasks/:id/start-dev → 200 + {worktree_path, branch}', () => {
    const c = readSpec();
    expect(/\/tasks\/[^'"]*\/start-dev/.test(c)).toBe(true);
    expect(/worktree_path/.test(c)).toBe(true);
    expect(/branch/.test(c)).toBe(true);
  });

  it('step 3: worktree 路径在文件系统上真实存在', () => {
    const c = readSpec();
    expect(/existsSync\s*\(|fs\.access|statSync\s*\(/.test(c)).toBe(true);
  });

  it('step 4: /dev mock 简化版被调用一次（runDevMock 调用计数 === 1）', () => {
    const c = readSpec();
    expect(/runDevMock|devMock|mockDev/.test(c)).toBe(true);
    expect(/toHaveBeenCalledTimes\s*\(\s*1\s*\)|callCount\s*===\s*1|calls\.length\s*===\s*1/.test(c)).toBe(true);
  });

  it('step 5: callback-processor 接收到 task=completed + pr_url 的 callback', () => {
    const c = readSpec();
    expect(/callback-processor|processExecutionCallback/.test(c)).toBe(true);
    expect(/pr_url/.test(c)).toBe(true);
    expect(/completed/.test(c)).toBe(true);
  });

  it('step 6: KR progress 从 X 升至 X+1', () => {
    const c = readSpec();
    expect(/before\s*\+\s*1|after\s*===\s*before\s*\+\s*1|after.*===.*before.*\+\s*1/.test(c)).toBe(true);
  });

  it('step 7: LiveMonitor WebSocket 收到至少一条 status 变化事件', () => {
    const c = readSpec();
    expect(/LiveMonitor|WebSocket|TASK_DISPATCHED|task:dispatched|broadcast/.test(c)).toBe(true);
  });
});
