// 冻结合同测试（TDD Red）— 晨报裸跑 AMBER 渲染器（R1-1 修复：需求④ 人可见出口）
// 覆盖父路: 独立小路（无父路）—— 链 bf5088a3 第 1 棒 F1 执行基座，无已验收前序 ability
//
// 本文件只测「环境无关的纯逻辑断言」：renderBareRunSection 把 findBareRuns 返回的裸跑
// 列表渲染成日报正文的 🟡 AMBER 板块文本。从仓库根 vitest（sprints/** include）跑，不碰 DB。
// daily-report-generator.js 顶层仅 `new Pool()`（pg 惰性连接，import 不发查询），安全导入。
//
// 现状：packages/brain/src/daily-report-generator.js 尚未导出 renderBareRunSection →
// 该导出为 undefined → 调用即抛错 → 全红（预期 Red）。
// 晨报真实接线（generateDailyReport import 并调用 findBareRuns 喂 renderBareRunSection）
// 与真 PG 渲染由 checks/dod-checks.mjs b06 覆盖。

import { describe, it, expect } from 'vitest';
import { renderBareRunSection } from '../../../packages/brain/src/daily-report-generator.js';

describe('renderBareRunSection — 晨报裸跑 AMBER 渲染（有 dispatch_events 无 task_runs）', () => {
  it('非空裸跑列表渲染出 🟡 AMBER 标记与每个裸跑 task_id', () => {
    const text = renderBareRunSection([
      { task_id: 'aaaa-1111', dispatched_at: '2026-09-25T00:00:00Z' },
      { task_id: 'bbbb-2222', dispatched_at: '2026-09-25T00:01:00Z' },
    ]);
    expect(typeof text).toBe('string');
    expect(text).toMatch(/🟡\s*AMBER/);
    expect(text).toContain('aaaa-1111');
    expect(text).toContain('bbbb-2222');
  });

  it('空裸跑列表不含 AMBER 标记（无裸跑不误报）', () => {
    const text = renderBareRunSection([]);
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/🟡\s*AMBER/);
  });

  it('单条裸跑正常渲染，含该 task_id 与 AMBER 标记', () => {
    const text = renderBareRunSection([{ task_id: 'cccc-3333', dispatched_at: '2026-09-25T00:02:00Z' }]);
    expect(text).toMatch(/🟡\s*AMBER/);
    expect(text).toContain('cccc-3333');
  });
});
