/**
 * tick-runner.test.js — Brain v2 Phase D1.7c-plugin1
 *
 * 源码自省测试：验证 tick-runner.js 已成功 wire 到 4 个 plugin
 * （dept-heartbeat / kr-progress-sync / heartbeat / goal-eval）。
 *
 * 设计：避免真实 import tick-runner.js（其顶层 import 链入 ~30+ 模块、需要
 * 真实 PostgreSQL）。改读源码字符串验证：
 *  - 4 个 plugin namespace 均被 import
 *  - 4 个 plugin .tick() 调用均存在
 *  - 旧 inline 调用（triggerDeptHeartbeats / runHeartbeatInspection 等）已剔除
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TICK_RUNNER_PATH = resolve(__dirname, '../tick-runner.js');
const SRC = readFileSync(TICK_RUNNER_PATH, 'utf8');

describe('tick-runner.js — D1.7c-plugin1 plugin wire-up', () => {
  it('imports deptHeartbeatPlugin namespace', () => {
    expect(SRC).toMatch(/import\s+\*\s+as\s+deptHeartbeatPlugin\s+from\s+['"]\.\/dept-heartbeat\.js['"]/);
  });

  it('imports krProgressSyncPlugin namespace', () => {
    expect(SRC).toMatch(/import\s+\*\s+as\s+krProgressSyncPlugin\s+from\s+['"]\.\/kr-progress-sync-plugin\.js['"]/);
  });

  it('imports heartbeatPlugin namespace', () => {
    expect(SRC).toMatch(/import\s+\*\s+as\s+heartbeatPlugin\s+from\s+['"]\.\/heartbeat-plugin\.js['"]/);
  });

  it('imports goalEvalPlugin namespace', () => {
    expect(SRC).toMatch(/import\s+\*\s+as\s+goalEvalPlugin\s+from\s+['"]\.\/goal-eval-plugin\.js['"]/);
  });

  it('calls deptHeartbeatPlugin.tick(...)', () => {
    expect(SRC).toMatch(/deptHeartbeatPlugin\.tick\s*\(/);
  });

  it('calls krProgressSyncPlugin.tick(...)', () => {
    expect(SRC).toMatch(/krProgressSyncPlugin\.tick\s*\(/);
  });

  it('calls heartbeatPlugin.tick(...)', () => {
    expect(SRC).toMatch(/heartbeatPlugin\.tick\s*\(/);
  });

  it('calls goalEvalPlugin.tick(...)', () => {
    expect(SRC).toMatch(/goalEvalPlugin\.tick\s*\(/);
  });

  it('removes old inline triggerDeptHeartbeats(pool) call', () => {
    // 旧代码：deptHeartbeatResult = await triggerDeptHeartbeats(pool)
    // 新代码：通过 deptHeartbeatPlugin.tick(...) 走
    expect(SRC).not.toMatch(/=\s*await\s+triggerDeptHeartbeats\s*\(/);
  });

  it('removes old inline runHeartbeatInspection(pool) call', () => {
    expect(SRC).not.toMatch(/=\s*await\s+runHeartbeatInspection\s*\(/);
  });

  it('removes old inline evaluateGoalOuterLoop call', () => {
    expect(SRC).not.toMatch(/=\s*await\s+evaluateGoalOuterLoop\s*\(/);
  });

  it('removes old inline runAllVerifiers call', () => {
    expect(SRC).not.toMatch(/=\s*await\s+runAllVerifiers\s*\(/);
  });

  it('removes old inline syncAllKrProgress(pool) call', () => {
    expect(SRC).not.toMatch(/=\s*await\s+syncAllKrProgress\s*\(/);
  });
});
