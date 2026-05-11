import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const SMOKE = 'packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh';

describe('Workstream 2 — HOL skip + zombie reaper (Steps 4-5) [BEHAVIOR]', () => {
  it('smoke 文件存在（依赖 WS1）', () => {
    expect(existsSync(SMOKE)).toBe(true);
  });

  it('HOL 段含 task_A / task_B / task_C 三条任务投递', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('test-w29-hol-A');
    expect(c).toContain('test-w29-hol-B');
    expect(c).toContain('test-w29-hol-C');
  });

  it('HOL 段含 task_A 不可派发构造（force_location nonexistent 或等价）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/force_location[^"]*nonexistent|nonexistent-xyz|no_executor|unreachable/);
  });

  it('HOL 段断言 task_A 仍 pending（B5 — 队首不阻塞）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/test-w29-hol-A[\s\S]*pending|A_STATUS[\s\S]*pending|pending[\s\S]*test-w29-hol-A/);
  });

  it('HOL 段断言 task_B 或 task_C 至少 1 个进入 dispatch_events', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/test-w29-hol-B[\s\S]*test-w29-hol-C|task_id IN[\s\S]*test-w29-hol/);
  });

  it('Zombie 段含 test-w29-zombie task 构造', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('test-w29-zombie');
  });

  it('Zombie 段调用 reapZombies 且强制 idleMinutes=0', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/reapZombies[\s\S]*idleMinutes[\s\S]*0|ZOMBIE_REAPER_IDLE_MIN=0/);
  });

  it('Zombie 段断言 error_message 含 `[reaper] zombie`（B2 标记）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[reaper\] zombie/);
  });

  it('Zombie 段断言 tasks.status 变为 failed', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/status\s*=\s*'failed'|"failed"|=\s*failed/);
  });
});
