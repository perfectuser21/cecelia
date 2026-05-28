import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const TICK_RUNNER_PATH = resolve(process.cwd(), 'packages/brain/src/tick-runner.js');

describe('Workstream 5 — tick-runner.js 死任务自动重置 [BEHAVIOR]', () => {
  it('tick-runner.js 含 execution_attempts 扫描条件（WS 未实现时缺失 → FAIL）', () => {
    const content = readFileSync(TICK_RUNNER_PATH, 'utf8');
    // WS5 未实现时此字符串不在死任务上下文中出现 → FAIL（真红）
    expect(content).toContain('execution_attempts');
  });

  it('tick-runner.js 含 10 分钟时间窗口判定', () => {
    const content = readFileSync(TICK_RUNNER_PATH, 'utf8');
    const has10min =
      content.includes('10 minute') ||
      content.includes('10min') ||
      content.includes("'10'") ||
      /INTERVAL.*10/i.test(content);
    expect(has10min).toBe(true);
  });

  it('tick-runner.js 死任务 UPDATE 包含 status queued 重置', () => {
    const content = readFileSync(TICK_RUNNER_PATH, 'utf8');
    const idx = content.indexOf('execution_attempts');
    expect(idx).toBeGreaterThan(-1);
    const segment = content.slice(Math.max(0, idx - 300), idx + 3000);
    expect(segment).toMatch(/'queued'|"queued"/);
  });

  it('tick-runner.js 死任务 UPDATE 含 claimed_by/claimed_at/started_at 清空（防残锁）', () => {
    const content = readFileSync(TICK_RUNNER_PATH, 'utf8');
    const idx = content.indexOf('execution_attempts');
    expect(idx).toBeGreaterThan(-1);
    const segment = content.slice(Math.max(0, idx - 300), idx + 3000);
    expect(segment).toContain('claimed_by');
    expect(segment).toContain('claimed_at');
    expect(segment).toContain('started_at');
  });

  it('tick-runner.js 含死任务日志打印（"dead task" 或 "Reset" 字样）', () => {
    const content = readFileSync(TICK_RUNNER_PATH, 'utf8');
    const hasLog = content.includes('dead task') || content.includes('Reset');
    expect(hasLog).toBe(true);
  });
});
