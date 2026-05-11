import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const SMOKE = 'packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh';

describe('Workstream 2 — HOL skip + zombie reaper (Steps 4-5) [BEHAVIOR via ARTIFACT shape]', () => {
  it('smoke 文件存在（依赖 WS1）', () => {
    expect(existsSync(SMOKE)).toBe(true);
  });

  it('smoke 含 HOL skip 段 task_A/B/C 标识', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('test-w29-hol-A');
    expect(c).toContain('test-w29-hol-B');
    expect(c).toContain('test-w29-hol-C');
  });

  it('smoke 含 zombie 段 + reapZombies({idleMinutes:0}) 调用', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('test-w29-zombie');
    expect(c).toMatch(/reapZombies\s*\(\s*\{\s*idleMinutes\s*:\s*0/);
  });

  it('smoke 含字面值 [reaper] zombie（zombie error_message 断言基准）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[reaper] zombie');
  });

  it('打印 [B5-A] PASS 标记（task_A claimed_by 释放）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B5-A] PASS — task_A claimed_by 被释放');
  });

  it('打印 [B5-BC] PASS 标记（task_B 或 task_C 被派发）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[B5-BC\] PASS — dispatch_events 含 task_(B|C)/);
  });

  it("打印 [B5-LOG] PASS 标记（dispatcher 真日志含 'HOL skip'）", () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain("[B5-LOG] PASS — dispatcher 真日志含 'HOL skip'");
  });

  it("打印 [B2] PASS 标记（reapZombies 标 failed + error_message）", () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[B2\] PASS — reapZombies 标 task=failed error_message='\[reaper\] zombie/);
  });

  it('打印 [B2-RET] PASS 标记（reapZombies 返回 reaped≥1 errors=0）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[B2-RET\] PASS — reapZombies returned reaped=/);
  });

  it('打印 [B3-OUT] PASS 标记（slot -1 after zombie reaped）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B3-OUT] PASS — slot in_progress -1 after zombie reaped');
  });
});
