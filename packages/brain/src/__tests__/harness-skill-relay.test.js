// 历史relay识别与纯工具兼容；真实新启动拒绝及零副作用守卫见
// kernel-runtime-retired.test.js / harness-skill-relay-xian.test.js / harness-skill-relay-spawn-event.test.js。
import { describe, it, expect, beforeAll } from 'vitest';
import { isSkillRelayTask, controllerSkillFor, deriveGear, GEAR_VALUES } from '../harness-skill-relay.js';

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

describe('默认 deps 的 import 来源（N4 run-1 实证 bug：resolveGitHubToken 不在 harness-utils）', () => {

  it('harness-credentials.js 真的导出 resolveGitHubToken（防再猜错模块）', async () => {
    const mod = await import('../harness-credentials.js');
    expect(typeof mod.resolveGitHubToken).toBe('function');
  });
});

describe('deriveReviewRequired(P2-1:新功能人审/非新功能 auto merge)', () => {
  let deriveReviewRequired;
  beforeAll(async () => { ({ deriveReviewRequired } = await import('../harness-skill-relay.js')); });

  it('显式 payload.review_required 永远赢(true/false 都尊重)', () => {
    expect(deriveReviewRequired({ title: 'feat: 新东西', payload: { review_required: false } })).toBe(false);
    expect(deriveReviewRequired({ title: 'fix: 修个小事', payload: { review_required: true } })).toBe(true);
  });

  it('fix/chore/修复/bug 类标题 → false(auto merge)', () => {
    for (const t of ['fix: relay 空指针', 'fix(brain): x', 'chore: 清理', 'hotfix: 紧急', '修复 evaluator 误判', 'bug: 掉线']) {
      expect(deriveReviewRequired({ title: t, payload: {} }), t).toBe(false);
    }
  });

  it('payload.change_kind ∈ {fix,small,thicken} → false(加厚/小改不算新面)', () => {
    for (const k of ['fix', 'small', 'thicken']) {
      expect(deriveReviewRequired({ title: '随便', payload: { change_kind: k } })).toBe(false);
    }
  });

  it('新功能/默认(判定不出) → true(安全方向:宁可多看一眼)', () => {
    expect(deriveReviewRequired({ title: 'feat: 新增导出功能', payload: {} })).toBe(true);
    expect(deriveReviewRequired({ title: '视频批量下载', payload: {} })).toBe(true);
    expect(deriveReviewRequired({ title: '', payload: {} })).toBe(true);
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

describe('controllerSkillFor（GP2/T2：按 task_type 选 controller skill）', () => {
  it('golden_path_proposal → capability-controller', () => {
    expect(controllerSkillFor('golden_path_proposal')).toBe('capability-controller');
  });
  it('harness_initiative / 未知类型 → harness-controller（默认不变）', () => {
    expect(controllerSkillFor('harness_initiative')).toBe('harness-controller');
    expect(controllerSkillFor(undefined)).toBe('harness-controller');
  });
});
