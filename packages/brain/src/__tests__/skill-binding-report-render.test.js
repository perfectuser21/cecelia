/**
 * 日报「skill 绑定漂移」板块渲染（链 bf5088a3 棒7，任务 9917a588）：
 * registry 缺映射 → 日报出 🟡 AMBER；无漂移/检测不可用不误报。晨报一行见 morning-cockpit-bark.test.js。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));

import { buildReportText } from '../daily-report-generator.js';

const base = ['2026-09-25', '2026-09-24', { count: 0, keywords: [] }, [], [], 0];

describe('buildReportText 的 skill 绑定漂移板块', () => {
  it('registry 缺映射 → 日报含 🟡 AMBER 与缺失 task_type', () => {
    const text = buildReportText(...base, null, {
      missing: [{ task_type: 'ci_patrol', hardcoded: '/ci-patrol' }], mismatched: [], conflicts: [],
    });
    expect(text).toContain('== skill 绑定漂移 ==');
    expect(text).toMatch(/🟡 AMBER/);
    expect(text).toContain('ci_patrol');
  });

  it('无漂移：出板块但不含 AMBER', () => {
    const text = buildReportText(...base, null, { missing: [], mismatched: [], conflicts: [] });
    expect(text).toContain('== skill 绑定漂移 ==');
    expect(text).not.toMatch(/AMBER/);
  });

  it('检测不可用（null / 省略）：不出该板块，原有板块不受影响', () => {
    expect(buildReportText(...base, null, null)).not.toContain('skill 绑定漂移');
    expect(buildReportText(...base)).not.toContain('skill 绑定漂移');
    expect(buildReportText(...base)).toContain('== 异常告警 ==');
  });
});

describe('generateDailyReport 接线：skill 绑定漂移进入日报正文', () => {
  const run = async (skillQuery) => {
    const { generateDailyReport } = await import('../daily-report-generator.js');
    const saved = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const text = String(sql);
        if (/FROM skill_registry/.test(text)) return skillQuery();
        if (/INSERT INTO working_memory/.test(text)) saved.push(params);
        return { rows: [] };
      }),
    };
    const out = await generateDailyReport(pool, new Date('2026-09-25T01:01:00Z'));
    return { out, report: saved.map((p) => String(p[1])).find((v) => v.includes('ZenithJoy')) ?? '' };
  };

  it('账本缺映射（空表）→ 日报正文含 🟡 AMBER skill 绑定漂移', async () => {
    const { out, report } = await run(() => ({ rows: [] }));
    expect(out.generated).toBe(true);
    expect(report).toContain('skill 绑定漂移');
    expect(report).toMatch(/🟡 AMBER skill 绑定漂移/);
  });

  it('账本查询失败 → 该板块省略，日报照常生成（fail-open）', async () => {
    const { out, report } = await run(() => { throw new Error('column "task_types" does not exist'); });
    expect(out.generated).toBe(true);
    expect(report).not.toContain('skill 绑定漂移');
  });
});
