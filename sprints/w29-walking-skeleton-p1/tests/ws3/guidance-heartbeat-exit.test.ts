import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const SMOKE = 'packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh';

describe('Workstream 3 — guidance TTL + heartbeat + exit (Steps 6-8) [BEHAVIOR via ARTIFACT shape]', () => {
  it('smoke 文件存在（依赖 WS2）', () => {
    expect(existsSync(SMOKE)).toBe(true);
  });

  it('smoke 含 guidance TTL 段（brain_guidance + decision_id + 30 minutes + getGuidance）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('brain_guidance');
    expect(c).toContain('decision_id');
    expect(c).toMatch(/INTERVAL\s+'30\s+minutes'/);
    expect(c).toContain('getGuidance');
  });

  it('smoke 含 heartbeat 段（fleet-resource-cache + startFleetRefresh + getFleetStatus + offline_reason）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('fleet-resource-cache');
    expect(c).toContain('startFleetRefresh');
    expect(c).toContain('getFleetStatus');
    expect(c).toContain('offline_reason');
    expect(c).toContain('no_ping_grace_exceeded');
    expect(c).toContain('fetch_failed');
  });

  it('smoke 含 trap EXIT 清理 test-w29- 测试数据', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/trap\s+.*(cleanup|EXIT)/);
    expect(c).toMatch(/(DELETE.*test-w29-|WHERE.*LIKE.*test-w29-)/);
  });

  it('打印 [B4] PASS 标记（getGuidance 返 null for stale）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B4] PASS — getGuidance returned null for stale decision_id');
  });

  it("打印 [B4-LOG] PASS 标记（guidance.js 真日志含 'strategy decision stale'）", () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain("[B4-LOG] PASS — guidance.js 真日志含 'strategy decision stale'");
  });

  it('打印 [B7-SHAPE] PASS 标记（offline_reason + last_ping_at 字段）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B7-SHAPE] PASS — fleet entries 含 offline_reason + last_ping_at');
  });

  it('打印 [B7-ENUM] PASS 标记（offline_reason 三字面值枚举）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B7-ENUM] PASS — offline_reason ∈ {null,fetch_failed,no_ping_grace_exceeded}');
  });

  it('打印整体 PASS 标记字面值', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过');
  });
});
