// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：CI 状态判定 ↔ derive merge/fix 路由
//
// 2026-08-21 生产实证（r34 run 00e0d542 / r38 run a12024ee）：PR BEHIND 时 GitHub 的
// mergeStateStatus 非 BLOCKED，mapCiStatus 的「非 BLOCKED ⇒ 红项皆非 required」启发式
// 失真——required 双红（Harness V5 Gate Passed + ci-passed）被判 pass/pending →
// derive 走 4e merge_pr 空转死循环（r34 直接判死主因），fix 路由（3c ci_fail）永远
// 到不了。BEHIND 只说明分支落后 main，required 红照样 merge 不了。
//
// 修法：BEHIND 从非 BLOCKED 豁免中排除，与 BLOCKED 同款严判（有未落定→pending，
// 全落定含红→fail）。0955c884 案卷场景（UNSTABLE：非 required 连挂、required 全绿）
// 的豁免保持不变。
//
// 按产物闸规矩写在边上：真 import mapCiStatus（不 mock 被改模块）。
import { describe, expect, it } from 'vitest';
import { mapCiStatus } from '../../../packages/brain/src/orchestrator/ground-truth.js';

const fail = (name) => ({ name, state: 'FAILURE' });
const pass = (name) => ({ name, state: 'SUCCESS' });
const pending = (name) => ({ name, state: 'IN_PROGRESS' });

describe('mapCiStatus：BEHIND 不豁免 required 红（r34/r38 merge 空转回归）', () => {
  it('r38 形态：BEHIND + 全落定 + 有红 → fail（进 fix 路由）', () => {
    const rows = [fail('Harness V5 Gate Passed'), fail('ci-passed'), pass('Smoke Glob Runner Passed'), pass('eslint')];
    expect(mapCiStatus(rows, 'BEHIND')).toBe('fail');
  });

  it('BEHIND + 有未落定 + 有红 → pending（等落定再裁）', () => {
    const rows = [fail('ci-passed'), pending('brain-unit (1)')];
    expect(mapCiStatus(rows, 'BEHIND')).toBe('pending');
  });

  it('0955c884 豁免保持：UNSTABLE（非 required 红、其余全绿）→ pass', () => {
    const rows = [fail('Deploy Preview Environment'), pass('ci-passed'), pass('Harness V5 Gate Passed')];
    expect(mapCiStatus(rows, 'UNSTABLE')).toBe('pass');
  });

  it('BLOCKED + 全落定 + 有红 → fail（既有行为不变）', () => {
    const rows = [fail('ci-passed'), pass('eslint')];
    expect(mapCiStatus(rows, 'BLOCKED')).toBe('fail');
  });

  it('全绿 → pass；全落定无红 BEHIND → pass（BEHIND 本身不是失败）', () => {
    const rows = [pass('ci-passed'), pass('eslint')];
    expect(mapCiStatus(rows, 'BEHIND')).toBe('pass');
    expect(mapCiStatus(rows, 'CLEAN')).toBe('pass');
  });
});
