/**
 * statusBadge 状态徽章纯函数单测
 *
 * [BEHAVIOR] B-D1-04 — active → 蓝色 className + "进行中"
 * [BEHAVIOR] B-D1-05 — resolved → 绿色 className + "已解决"
 * [BEHAVIOR] B-D1-06 — suspended → 黄/amber className + "挂起"
 * [BEHAVIOR] B-D1-07 — 未知状态 → 空文案
 *
 * 被测函数位于：apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx
 * （需导出 statusBadge）
 */

import { describe, it, expect } from 'vitest';
import { statusBadge } from '../../../apps/dashboard/src/pages/warroom/WarRoomLineCommandPage';

describe('statusBadge', () => {
  it('[B-D1-04] active → 蓝色 className + 文案"进行中"', () => {
    const result = statusBadge('active');
    expect(result.label).toBe('进行中');
    expect(result.className).toMatch(/blue/);
  });

  it('[B-D1-05] resolved → 绿色 className + 文案"已解决"', () => {
    const result = statusBadge('resolved');
    expect(result.label).toBe('已解决');
    expect(result.className).toMatch(/green/);
  });

  it('[B-D1-06] suspended → 黄/amber className + 文案"挂起"', () => {
    const result = statusBadge('suspended');
    expect(result.label).toBe('挂起');
    expect(result.className).toMatch(/yellow|amber/);
  });

  it('[B-D1-07] 未知状态 → 空文案（不渲染徽章）', () => {
    const result = statusBadge('archived');
    expect(result.label).toBe('');
  });

  it('[B-D1-07] null → 空文案', () => {
    const result = statusBadge(null as unknown as string);
    expect(result.label).toBe('');
  });
});
