// 历史relay识别与纯工具兼容；真实新启动拒绝及零副作用守卫见
// kernel-runtime-retired.test.js / harness-skill-relay-xian.test.js / harness-skill-relay-spawn-event.test.js。
import { describe, it, expect } from 'vitest';
import { isSkillRelayTask, deriveGear, GEAR_VALUES } from '../harness-skill-relay.js';

const TASK = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111', payload: { orchestrator: 'skill-relay' } };

describe('isSkillRelayTask', () => {
  it('payload.orchestrator=skill-relay → true', () => {
    expect(isSkillRelayTask(TASK)).toBe(true);
  });
  it('flag 缺省/其他值 → false（双轨：走原图路径）', () => {
    expect(isSkillRelayTask({ id: 'x', payload: {} })).toBe(false);
    expect(isSkillRelayTask({ id: 'x', payload: { orchestrator: 'langgraph' } })).toBe(false);
    expect(isSkillRelayTask({ id: 'x' })).toBe(false);
  });
});

describe('deriveGear（harness gear 档位：default/hotfix/segmented）', () => {
  it('payload.gear 缺省/undefined/null → default', () => {
    expect(deriveGear({ payload: {} })).toBe('default');
    expect(deriveGear({ payload: { gear: undefined } })).toBe('default');
    expect(deriveGear({ payload: { gear: null } })).toBe('default');
    expect(deriveGear({})).toBe('default');
  });

  it('payload.gear ∈ GEAR_VALUES → 原值透传', () => {
    for (const g of GEAR_VALUES) {
      expect(deriveGear({ payload: { gear: g } })).toBe(g);
    }
  });

  it('GEAR_VALUES 枚举恰为 default/hotfix/segmented', () => {
    expect(GEAR_VALUES).toEqual(['default', 'hotfix', 'segmented']);
  });

  it('非法值 → throw Error 含 invalid_gear', () => {
    expect(() => deriveGear({ payload: { gear: 'turbo' } })).toThrow(/invalid_gear/);
    expect(() => deriveGear({ payload: { gear: 'turbo' } })).toThrow(/turbo/);
  });
});
