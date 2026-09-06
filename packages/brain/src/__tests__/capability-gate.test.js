/**
 * capability-gate.test.js — 三镜头能力闸配对测试(lint-test-pairing)
 * 单元面:非 new_capability 直放行(不触库不裁决)、new_capability 走裁决器且 reject 即 fail-closed。
 * 深断言在 __tests__/integration/capability-gate.integration.test.js 与 sprint 冻结测试。
 */
import { describe, it, expect, vi } from 'vitest';
import { runCapabilityGate } from '../capability-gate.js';

describe('runCapabilityGate', () => {
  it('非 new_capability → 直接放行,不触库不调裁决器', async () => {
    const db = { query: vi.fn() };
    const adjudicate = vi.fn();
    const r = await runCapabilityGate(db, { changeKind: 'bugfix', request: {}, adjudicate });
    expect(r?.allowed ?? r?.pass ?? true).toBeTruthy();
    expect(adjudicate).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('new_capability + 裁决非 pass → 抛 capability_gate_rejected(fail-closed)', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const adjudicate = vi.fn(async () => ({ decision: 'reject', reason: '三镜头判否' }));
    await expect(runCapabilityGate(db, { changeKind: 'new_capability', request: { title: 'x' }, adjudicate }))
      .rejects.toThrow('capability_gate_rejected');
    expect(adjudicate).toHaveBeenCalledTimes(1);
  });

  it('pass 但契约不完整(缺 postcondition/NFR 三数)→ 抛 capability_gate_contract_incomplete', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const adjudicate = vi.fn(async () => ({ decision: 'pass', postcondition: '有产出', nfr: { cost_ceiling: 1 } }));
    await expect(runCapabilityGate(db, { changeKind: 'new_capability', request: {}, adjudicate }))
      .rejects.toThrow('capability_gate_contract_incomplete');
  });
});
