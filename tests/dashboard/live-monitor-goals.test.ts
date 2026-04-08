/**
 * LiveMonitorPage goals normalize logic unit test
 * 验证 area_kr 类型被正确 normalize 为 kr
 */

import { describe, it, expect } from 'vitest';

// 复制 LiveMonitorPage 中的 normalize 逻辑（不 import 组件，避免 DOM 依赖）
function normalizeGoals(raw: Array<Record<string, unknown>>) {
  return raw
    .filter((g) => ['area_okr', 'global_okr', 'kr', 'area_kr'].includes(g.type as string))
    .map((g) => (g.type === 'area_kr' ? { ...g, type: 'kr' } : g));
}

describe('LiveMonitorPage goals normalize', () => {
  it('area_kr 被 normalize 为 kr', () => {
    const raw = [
      { id: '1', type: 'area_kr', title: 'KR5: Dashboard', current_value: '76' },
      { id: '2', type: 'area_okr', title: 'ZenithJoy OKR' },
      { id: '3', type: 'other', title: '应被过滤' },
    ];
    const result = normalizeGoals(raw);
    expect(result).toHaveLength(2);
    expect(result.find((g) => g.id === '1')?.type).toBe('kr');
    expect(result.find((g) => g.id === '2')?.type).toBe('area_okr');
  });

  it('area_kr normalize 后 KR 过滤能找到 KR', () => {
    const raw = [
      { id: 'kr1', type: 'area_kr', title: 'KR1', parent_id: 'okr1' },
      { id: 'okr1', type: 'area_okr', title: 'OKR1', parent_id: null },
    ];
    const goals = normalizeGoals(raw);
    const krs = goals.filter((g) => g.type === 'kr');
    expect(krs).toHaveLength(1);
    expect(krs[0].title).toBe('KR1');
  });

  it('空数组返回空数组', () => {
    expect(normalizeGoals([])).toEqual([]);
  });

  it('不含 area_kr 的数据不受影响', () => {
    const raw = [
      { id: '1', type: 'area_okr', title: 'OKR' },
      { id: '2', type: 'global_okr', title: 'Global OKR' },
    ];
    const result = normalizeGoals(raw);
    expect(result).toHaveLength(2);
    expect(result.every((g) => g.type !== 'kr')).toBe(true);
  });
});
