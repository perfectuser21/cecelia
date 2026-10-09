// lib/invariants.mjs：铁律（Brain decisions category=invariant）加载进链路（审计 P1 #3，对应旧 harness「Invariant 三源加载、
// 合同对每条铁律要么有断言要么写明 N/A」）。01-invariants.md 列全部 active 铁律；02 的 `## 铁律对照` 对相关铁律逐条交代。
import { describe, it, expect } from 'vitest';
import { renderInvariants, invariantIds, invariantErrors, INVARIANTS_FILE } from '../lib/invariants.mjs';

const ROWS = [
  { id: '02d8e749-aaaa-4bbb-8ccc-dddddddddddd', topic: 'coding 链重写不得缩减已拍板设计', decision: 'GAN 无轮数上限……' },
  { id: '96054a8b-1111-4222-8333-444444444444', topic: 'us-vps 零执行', decision: 'us-vps 只做调度'.repeat(80) },
];

describe('renderInvariants / invariantIds', () => {
  it('每条铁律一个 `### INV-<id 前 8 位>` 小节：主题 + 内容（过长截断）', () => {
    const md = renderInvariants(ROWS);
    expect(INVARIANTS_FILE).toBe('01-invariants.md');
    expect(md).toContain('### INV-02d8e749');
    expect(md).toContain('coding 链重写不得缩减已拍板设计');
    expect(md).toContain('### INV-96054a8b');
    expect(md.length).toBeLessThan(2000);
    expect(invariantIds(md)).toEqual(['INV-02d8e749', 'INV-96054a8b']);
  });

  it('没有铁律 → 写明无，id 为空', () => {
    expect(invariantIds(renderInvariants([]))).toEqual([]);
  });
});

describe('invariantErrors（02 的 `## 铁律对照`）', () => {
  const ids = ['INV-02d8e749', 'INV-96054a8b'];
  const spec = (section) => `# spec\n\n### S-1\nx\n\n## QA 场景\n\n### Q-1\n对应: I-1\n操作: a\n期望: b\n\n${section}`;

  it('逐条交代：引用已有 S-n/Q-n，或写不适用并给理由 → 无错', () => {
    const s = spec('## 铁律对照\n\n- INV-02d8e749：S-1、Q-1 覆盖（规格保留了 GAN 无上限）\n- INV-96054a8b：不适用：本改动只在 MMV 跑，不涉及 us-vps 执行\n');
    expect(invariantErrors(s, ids)).toEqual([]);
  });

  it('确实一条都不相关：写「无相关铁律」并给理由 → 无错', () => {
    expect(invariantErrors(spec('## 铁律对照\n\n无相关铁律：本改动只调整 tasks 列表的参数校验，清单里的铁律都不涉及\n'), ids)).toEqual([]);
  });

  it('有铁律清单却没有对照段 → invariants_section_missing；清单为空则不要求', () => {
    expect(invariantErrors(spec(''), ids)).toEqual(['invariants_section_missing']);
    expect(invariantErrors(spec(''), [])).toEqual([]);
  });

  it('引用不存在的铁律、只列不交代、引用不存在的 S/Q、不适用不写理由、「无相关」不写理由 → 逐条报错', () => {
    const s = spec('## 铁律对照\n\n- INV-deadbeef：S-1 覆盖\n- INV-02d8e749：会注意\n- INV-96054a8b：S-9 覆盖\n');
    expect(invariantErrors(s, ids)).toEqual(['INV-deadbeef:unknown', 'INV-02d8e749:unaddressed', 'INV-96054a8b:unaddressed']);
    expect(invariantErrors(spec('## 铁律对照\n\n- INV-02d8e749：不适用\n'), ids)).toEqual(['INV-02d8e749:unaddressed']);
    expect(invariantErrors(spec('## 铁律对照\n\n无相关铁律\n'), ids)).toEqual(['invariants_section_empty']);
  });
});
