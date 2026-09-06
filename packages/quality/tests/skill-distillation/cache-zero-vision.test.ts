// 用例②：registry 缓存命中必须零视觉调用（防成本回归）
// 依据 09-05 A/B 实测：B 臂热态 700 token 全部来自验收，定位环节零 LLM 调用是 24×/54× 成本优势的来源
import { describe, it, expect } from 'vitest';
import { createSkillRuntime } from '../../skill-distillation/src/runtime.mjs';

describe('缓存命中零视觉调用', () => {
  it('registry 全命中时 vision 调用次数必须为 0', async () => {
    let visionCalls = 0;
    const warm = {
      'TEST-MODEL|1.0.0|400': {
        search_entry: { x: 946, y: 75 },
        tab_users: { x: 256, y: 132 },
      },
    };
    const rt = createSkillRuntime({
      tap: () => {},
      typeText: () => {},
      key: () => {},
      sleep: () => {},
      screenshot: (tag: string) => `/dev/null/${tag}.png`,
      vision: async () => { visionCalls++; return JSON.stringify({ x: 1, y: 1 }); },
      regKey: () => 'TEST-MODEL|1.0.0|400',
      registry: { load: () => warm, save: () => {} },
    });

    const result = await rt.runSkill('search_account', { name: 'langzi63485' });
    expect(result.ok).toBe(true);
    expect(visionCalls).toBe(0);
    expect(result.cacheHits).toBe(2);
    expect(result.cacheMisses).toBe(0);
  });

  it('registry 未命中时才允许视觉回源，且回源成功后回写 registry', async () => {
    let visionCalls = 0;
    let saved: any = null;
    const rt = createSkillRuntime({
      tap: () => {},
      typeText: () => {},
      key: () => {},
      sleep: () => {},
      screenshot: (tag: string) => `/dev/null/${tag}.png`,
      vision: async () => { visionCalls++; return JSON.stringify({ x: 500, y: 500 }); },
      regKey: () => 'TEST-MODEL|1.0.0|400',
      registry: { load: () => (saved ?? {}), save: (r: any) => { saved = r; } },
    });

    const result = await rt.runSkill('search_account', { name: 'langzi63485' });
    expect(result.ok).toBe(true);
    expect(visionCalls).toBe(2); // search_entry + tab_users 各回源一次
    expect(saved['TEST-MODEL|1.0.0|400'].search_entry).toMatchObject({ x: 500, y: 500 });
    expect(saved['TEST-MODEL|1.0.0|400'].tab_users).toMatchObject({ x: 500, y: 500 });
  });
});
