// Workstream 1 — scripts/v15-dispatch.mjs [BEHAVIOR]
// 目标：派发脚本能正确构造 testing PRD payload；缺关键 env 时抛错。
// Red 阶段：scripts/v15-dispatch.mjs 不存在，import 必失败。

import { describe, it, expect } from 'vitest';

describe('Workstream 1 — v15 dispatch [BEHAVIOR]', () => {
  it('buildPayload returns object with initiative_id (UUID), prd (non-empty), journey_type=autonomous', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-dispatch.mjs');
    const payload = mod.buildPayload();
    expect(payload).toBeTypeOf('object');
    expect(payload.initiative_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(typeof payload.prd).toBe('string');
    expect(payload.prd.length).toBeGreaterThan(50);
    expect(payload.journey_type).toBe('autonomous');
  });

  it('buildTestPrd returns a real PRD text with Golden Path section header', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-dispatch.mjs');
    const prd = mod.buildTestPrd();
    expect(typeof prd).toBe('string');
    expect(prd).toMatch(/Golden Path/);
    expect(prd.length).toBeGreaterThan(100);
  });

  it('buildPayload generates fresh UUID on each call (no static placeholder)', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-dispatch.mjs');
    const a = mod.buildPayload();
    const b = mod.buildPayload();
    expect(a.initiative_id).not.toBe(b.initiative_id);
  });

  it('exported INSERT SQL contains RETURNING id', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-dispatch.mjs');
    expect(mod.INSERT_SQL).toBeTypeOf('string');
    expect(mod.INSERT_SQL).toMatch(/RETURNING\s+id/i);
    expect(mod.INSERT_SQL).toMatch(/harness_initiative/);
  });
});
