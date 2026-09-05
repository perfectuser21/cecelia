import { describe, it, expect, vi } from 'vitest';
// 冻结 RED 测试 — 目标模块 packages/brain/src/capability-gate.js 尚未实现，
// 本文件 import 即失败 → 全部 RED（可在 propose 阶段无 Postgres 确认）。
// 覆盖三镜头能力级前置门禁的「控制逻辑」：短路 / 拦截 / fail-closed；
// 真实 decisions 落库断言由 E2E(psql) + integration test(真 PG) 覆盖（见 contract-draft ## 禁 mock 边清单）。
import { runCapabilityGate } from '../../../packages/brain/src/capability-gate.js';

const STEP_ID = '11111111-2222-3333-4444-555555555555';

function passVerdict(overrides = {}) {
  return {
    decision: 'pass',
    reason: 'novel capability, scoped, correctly homed',
    postcondition: 'new_capability X 上线后，routeWork 对该能力必经三镜头且门禁产物落 decisions',
    nfr: { cost_ceiling: 2.5, latency_ceiling: 8000, success_floor: 0.9 },
    ...overrides,
  };
}

describe('capability-gate 三镜头前置门禁 [BEHAVIOR]', () => {
  it('非 new_capability 短路：不调 adjudicate 不写 db，路由行为不变', async () => {
    const adjudicate = vi.fn();
    const db = { query: vi.fn(() => { throw new Error('db must not be touched'); }) };
    const result = await runCapabilityGate(db, {
      changeKind: 'bugfix', stepId: STEP_ID, request: { source_id: 'r1' }, adjudicate,
    });
    expect(result).toMatchObject({ triggered: false, released: true });
    expect(adjudicate).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('三镜头判 reject：fail-closed 抛 capability_gate_rejected，拒绝原因可查，不写 nfr', async () => {
    const adjudicate = vi.fn(async () => passVerdict({ decision: 'reject', reason: 'capability_duplicate_of_line04' }));
    const db = { query: vi.fn() };
    await expect(runCapabilityGate(db, {
      changeKind: 'new_capability', stepId: STEP_ID, request: { source_id: 'r2' }, adjudicate,
    })).rejects.toMatchObject({ code: 'capability_gate_rejected', reason: 'capability_duplicate_of_line04' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('postcondition/NFR 三数不完整：fail-closed 抛 capability_gate_contract_incomplete，不写 nfr', async () => {
    const adjudicate = vi.fn(async () => passVerdict({ nfr: { cost_ceiling: 1, latency_ceiling: 100 } })); // 缺 success_floor
    const db = { query: vi.fn() };
    await expect(runCapabilityGate(db, {
      changeKind: 'new_capability', stepId: STEP_ID, request: { source_id: 'r3' }, adjudicate,
    })).rejects.toMatchObject({ code: 'capability_gate_contract_incomplete' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('decisions 落库失败：fail-closed 传播错误，绝不静默放行', async () => {
    const adjudicate = vi.fn(async () => passVerdict());
    const db = { query: vi.fn(async () => { throw new Error('insert failed'); }) };
    await expect(runCapabilityGate(db, {
      changeKind: 'new_capability', stepId: STEP_ID, request: { source_id: 'r4' }, adjudicate,
    })).rejects.toThrow();
  });

  it('过闸：写 decisions(category=nfr, level=step, target_type=journey_step)，返回 released 与门禁产物', async () => {
    const adjudicate = vi.fn(async () => passVerdict());
    const captured = [];
    const db = { query: vi.fn(async (sql, params) => { captured.push({ sql, params }); return { rows: [{ id: 'dec-1' }] }; }) };
    const result = await runCapabilityGate(db, {
      changeKind: 'new_capability', stepId: STEP_ID, request: { source_id: 'r5' }, adjudicate,
    });
    expect(result).toMatchObject({
      triggered: true,
      released: true,
      decision_id: 'dec-1',
      postcondition: expect.stringContaining('三镜头'),
      nfr: { cost_ceiling: 2.5, latency_ceiling: 8000, success_floor: 0.9 },
    });
    const insert = captured.find((c) => /insert\s+into\s+decisions/i.test(c.sql));
    expect(insert, 'gate 必须向 decisions 落库').toBeTruthy();
    expect(insert.sql.toLowerCase()).toContain('decisions');
    const flat = JSON.stringify(insert.params);
    expect(flat).toContain('nfr');
    expect(flat).toContain('step');
    expect(flat).toContain('journey_step');
    expect(flat).toContain(STEP_ID);
  });
});
