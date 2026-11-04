/**
 * LiveMonitorPage goals normalize logic unit test
 * 验证 area_kr 类型被正确 normalize 为 kr
 */

import { describe, it, expect } from 'vitest';

import { normalizeLiveGoals as normalizeGoals } from './goal-normalization';

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

it('真实进度优先级保留：手动百分比、分母比例、绝对值及原progress', () => {
  const goals = normalizeGoals([
    {id:'manual',type:'area_kr',progress_pct:'23',current_value:76,target_value:100},
    {id:'ratio',type:'kr',current_value:2,target_value:8},
    {id:'absolute',type:'kr',current_value:3.6},
    {id:'fallback',type:'kr',progress:17},
  ]);
  expect(goals.map(g => g.progress)).toEqual([23,25,4,17]);
});
