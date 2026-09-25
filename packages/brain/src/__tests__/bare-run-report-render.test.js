// 晨报裸跑 AMBER 渲染器（Harness 合同 R1-1：需求④ 人可见出口；冻结测试移植）
// 覆盖父路: 独立小路（无父路）—— 链 bf5088a3 第 1 棒 F1 执行基座，无已验收前序 ability
//
// 本文件只测「环境无关的纯逻辑断言」：renderBareRunSection 把 findBareRuns 返回的裸跑
// 列表渲染成日报正文的 🟡 AMBER 板块文本。从仓库根 vitest（sprints/** include）跑，不碰 DB。
//
// 晨报真实接线（generateDailyReport import 并调用 findBareRuns 喂 renderBareRunSection）
// 与真 PG 渲染由 checks/dod-checks.mjs b06 覆盖。

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));
import { renderBareRunSection } from '../daily-report-generator.js';
import { EXECUTOR_SKILL_MAP } from '../lib/task-type-registry.js';

// skill_registry 与硬编码一致的账本行（棒7 起日报也查账本漂移；这里保持无漂移，不让 AMBER 串味）
const consistentSkillRows = () => Object.entries(EXECUTOR_SKILL_MAP)
  .filter(([, cmd]) => cmd)
  .map(([taskType, cmd]) => ({ name: `n-${taskType}`, status: 'active', task_types: [taskType], dispatch_command: cmd }));

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

describe('generateDailyReport — 裸跑检测接线：AMBER 行进入日报正文', () => {
  it('窗口内触发：findBareRuns 的真实返回喂给 renderBareRunSection，存入 working_memory 的正文含 🟡 AMBER 与裸跑 task_id', async () => {
    const { generateDailyReport } = await import('../daily-report-generator.js');
    const saved = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const text = String(sql);
        if (/FROM dispatch_events/.test(text)) {
          return { rows: [{ task_id: 'dddd-4444', dispatched_at: '2026-09-25T00:00:00Z' }] };
        }
        if (/INSERT INTO working_memory/.test(text)) saved.push(params);
        return { rows: [] };
      }),
    };
    const out = await generateDailyReport(pool, new Date('2026-09-25T01:01:00Z'));
    expect(out.generated).toBe(true);
    const report = saved.map((p) => String(p[1])).find((v) => v.includes('裸跑')) ?? '';
    expect(report).toMatch(/🟡\s*AMBER/);
    expect(report).toContain('dddd-4444');
  });

  it('无裸跑：日报有「裸跑检测」板块但不含 AMBER；检测查询失败则整块省略且日报照常生成（fail-open）', async () => {
    const { generateDailyReport } = await import('../daily-report-generator.js');
    const run = async (failBare) => {
      const saved = [];
      const pool = {
        query: vi.fn(async (sql, params) => {
          const text = String(sql);
          if (/FROM dispatch_events/.test(text)) {
            if (failBare) throw new Error('bare query down');
            return { rows: [] };
          }
          if (/FROM skill_registry/.test(text)) return { rows: consistentSkillRows() };
          if (/INSERT INTO working_memory/.test(text)) saved.push(params);
          return { rows: [] };
        }),
      };
      const out = await generateDailyReport(pool, new Date('2026-09-25T01:01:00Z'));
      return { out, report: saved.map((p) => String(p[1])).find((v) => v.includes('ZenithJoy')) ?? '' };
    };
    const clean = await run(false);
    expect(clean.out.generated).toBe(true);
    expect(clean.report).toContain('裸跑检测');
    expect(clean.report).not.toMatch(/AMBER/);
    const broken = await run(true);
    expect(broken.out.generated).toBe(true);
    expect(broken.report).not.toContain('裸跑检测');
  });
});
