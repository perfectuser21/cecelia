// 用例③：视觉定位返回 null / 垃圾输出必须 fail-closed —— 不许瞎点
// 依据 09-05 A/B 实测观察 1：执行者自证不可信（A 臂 doneClaimed=true 实际停在桌面）
// fail-closed 是「没探针不许固化」的运行时对偶：判定不了就是失败，不能猜
import { describe, it, expect } from 'vitest';
import { createSkillRuntime } from '../../skill-distillation/src/runtime.mjs';
import { parseJudgeVerdict } from '../../skill-distillation/src/judge.mjs';

function makeRt(visionResult: string | null) {
  const taps: string[] = [];
  const rt = createSkillRuntime({
    tap: (xp: number, yp: number) => { taps.push(`${xp},${yp}`); },
    typeText: () => {},
    key: () => {},
    sleep: () => {},
    screenshot: (tag: string) => `/dev/null/${tag}.png`,
    vision: async () => visionResult,
    regKey: () => 'TEST-MODEL|1.0.0|400',
    registry: { load: () => ({}), save: () => {} },
  });
  return { rt, taps };
}

describe('视觉 null 必 fail-closed', () => {
  it('vision 返回 {"x":null,"y":null} → 技能失败且一次 tap 都不发生', async () => {
    const { rt, taps } = makeRt(JSON.stringify({ x: null, y: null }));
    const result = await rt.runSkill('search_account', { name: 'langzi63485' });
    expect(result.ok).toBe(false);
    expect(result.failedRole).toBe('search_entry');
    expect(taps).toEqual([]);
  });

  it('vision 返回非 JSON 垃圾 → 同样 fail-closed 不许 tap', async () => {
    const { rt, taps } = makeRt('我觉得搜索框大概在右上角');
    const result = await rt.runSkill('search_account', { name: 'langzi63485' });
    expect(result.ok).toBe(false);
    expect(taps).toEqual([]);
  });

  it('vision 网络层返回 null → fail-closed', async () => {
    const { rt, taps } = makeRt(null);
    const result = await rt.runSkill('search_account', { name: 'langzi63485' });
    expect(result.ok).toBe(false);
    expect(taps).toEqual([]);
  });
});

describe('判定器裁决解析 fail-closed', () => {
  it.each([
    ['空字符串', ''],
    ['非 JSON', '这张图看起来像用户列表页'],
    ['JSON 但 ok 非布尔', '{"ok":"yes","why":"looks good"}'],
    ['JSON 缺 ok 字段', '{"why":"no verdict"}'],
    ['null 输入', null],
  ])('%s → ok:false（判定不了=失败，不能猜）', (_name, input) => {
    const v = parseJudgeVerdict(input as any);
    expect(v.ok).toBe(false);
  });

  it('合法 true 裁决正常解析', () => {
    const v = parseJudgeVerdict('{"ok":true,"why":"用户列表页且出现目标账号"}');
    expect(v.ok).toBe(true);
    expect(v.why).toContain('用户列表页');
  });

  it('裁决嵌在多余文本里也能提取（LLM 常见输出形态）', () => {
    const v = parseJudgeVerdict('好的，我的判定是：{"ok":false,"why":"这是手机桌面"}');
    expect(v.ok).toBe(false);
  });
});
