// 用例①：技能体序列固化断言 —— mock 依赖注入，断言动作顺序与契约 sequence 一致
// 依据 09-05 A/B 实测（决策 ca9f3d7b/28ca1f69）：序列固化进代码，定位存 registry
import { describe, it, expect } from 'vitest';
import { createSkillRuntime } from '../../skill-distillation/src/runtime.mjs';
import { SKILLS } from '../../skill-distillation/src/contracts.mjs';

function makeDeps(registry: Record<string, any>) {
  const actions: string[] = [];
  return {
    actions,
    deps: {
      tap: (xp: number, yp: number) => { actions.push(`tap:${xp},${yp}`); },
      typeText: (t: string) => { actions.push(`type:${t}`); },
      key: (k: string) => { actions.push(`key:${k}`); },
      sleep: (_ms: number) => { /* 测试不真等 */ },
      screenshot: (tag: string) => `/dev/null/${tag}.png`,
      vision: async () => { actions.push('vision'); return null; },
      regKey: () => 'TEST-MODEL|1.0.0|400',
      registry: {
        load: () => registry,
        save: (_r: Record<string, any>) => { actions.push('registry:save'); },
      },
    },
  };
}

describe('技能体序列固化', () => {
  it('search_account 热态（registry 全命中）动作序列与契约完全一致', async () => {
    const warm = {
      'TEST-MODEL|1.0.0|400': {
        search_entry: { x: 946, y: 75 },
        tab_users: { x: 256, y: 132 },
      },
    };
    const { actions, deps } = makeDeps(warm);
    const rt = createSkillRuntime(deps);
    const result = await rt.runSkill('search_account', { name: 'langzi63485' });

    expect(result.ok).toBe(true);
    expect(actions).toEqual([
      'tap:946,75',
      'type:langzi63485',
      'key:KEYCODE_ENTER',
      'tap:256,132',
    ]);
  });

  it('契约 sequence 是唯一事实来源：runSkill 拒绝契约外技能名', async () => {
    const { deps } = makeDeps({});
    const rt = createSkillRuntime(deps);
    await expect(rt.runSkill('not_a_skill', {})).rejects.toThrow(/契约|contract|unknown/i);
  });

  it('契约里 search_account 的 sequence 与实测固化版本一致（防漂移）', () => {
    const seq = SKILLS.search_account.sequence.filter((s: any) => s.op !== 'sleep');
    expect(seq).toEqual([
      { op: 'tapRole', role: 'search_entry' },
      { op: 'type', from_arg: 'name' },
      { op: 'key', code: 'KEYCODE_ENTER' },
      { op: 'tapRole', role: 'tab_users' },
    ]);
  });
});
