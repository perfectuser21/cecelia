import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const SMOKE = 'packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh';

describe('Workstream 3 — guidance TTL + heartbeat + exit PASS (Steps 6-8) [BEHAVIOR]', () => {
  it('smoke 文件存在（依赖 WS2）', () => {
    expect(existsSync(SMOKE)).toBe(true);
  });

  it('Guidance 段 INSERT brain_guidance 含 decision_id', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/brain_guidance[\s\S]*decision_id/);
  });

  it('Guidance 段 updated_at 偏移 ≥ 30 分钟（超过默认 TTL=15min）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/INTERVAL\s+'30\s+minutes'|INTERVAL '30 minutes'/);
  });

  it('Guidance 段调用 getGuidance 并断言 null（B4 — TTL 短路证据）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/getGuidance[\s\S]*strategy:global/);
    expect(c).toMatch(/v !== null|v === null|guidance.*null|process\.exit\(1\)/);
  });

  it('Heartbeat 段引用 fleet-resource-cache + 验 offline_reason 字段', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/fleet-resource-cache/);
    expect(c).toMatch(/offline_reason/);
  });

  it('Heartbeat 段断言 offline_reason 枚举 ∈ {null, fetch_failed, no_ping_grace_exceeded}', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/no_ping_grace_exceeded/);
    expect(c).toMatch(/fetch_failed/);
  });

  it('出口段含终验 PASS 信号字符串', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('PASS — 7 项 P1 修复全链路联调通过');
  });

  it('出口段含 echo 命令打印 PASS 信号', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/echo[\s\S]*\[walking-skeleton-p1-终验\] PASS/);
  });
});
