/**
 * lib/recurring-schedule.js —— 定时引擎纯计算（任务 3d0db274）：到点判定 planTemplate 与实例标题。
 * 引擎执行侧见 src/__tests__/recurring-engine.test.js。一律用 UTC ISO 断言，与机器时区无关。
 */
import { describe, it, expect } from 'vitest';
import { planTemplate, instanceTitle, validateSchedule } from '../recurring-schedule.js';

const daily22 = (over = {}) => ({ recurrence_type: 'cron', cron_expression: '0 22 * * *', template: {}, ...over });
const iso = (d) => (d ? d.toISOString() : d);

describe('planTemplate', () => {
  it('next_run_at 为空 → baseline（下一个北京 22:00），不 run', () => {
    const p = planTemplate(daily22({ next_run_at: null }), new Date('2026-09-29T14:00:00Z'));
    expect(p.action).toBe('baseline');
    expect(iso(p.nextRunAt)).toBe('2026-09-30T14:00:00.000Z');
  });

  it('未到点 → wait', () => {
    expect(planTemplate(daily22({ next_run_at: '2026-09-29T14:00:00Z' }), new Date('2026-09-29T13:59:59Z')).action).toBe('wait');
  });

  it('到点且在默认 30 分钟窗口内 → run，slot=时间点', () => {
    const p = planTemplate(daily22({ next_run_at: '2026-09-29T14:00:00Z' }), new Date('2026-09-29T14:29:00Z'));
    expect(p).toMatchObject({ action: 'run' });
    expect(iso(p.slot)).toBe('2026-09-29T14:00:00.000Z');
    expect(iso(p.nextRunAt)).toBe('2026-09-30T14:00:00.000Z');
  });

  it('超出窗口 → missed，推进到 now 之后的下一个时间点', () => {
    const p = planTemplate(daily22({ next_run_at: '2026-09-29T14:00:00Z' }), new Date('2026-09-29T14:31:00Z'));
    expect(p.action).toBe('missed');
    expect(iso(p.nextRunAt)).toBe('2026-09-30T14:00:00.000Z');
  });

  it('catchup_minutes=0：只有恰在时间点那一分钟内才 run', () => {
    const rt = daily22({ next_run_at: '2026-09-29T14:00:00Z', template: { catchup_minutes: 0 } });
    expect(planTemplate(rt, new Date('2026-09-29T14:00:00Z')).action).toBe('run');
    expect(planTemplate(rt, new Date('2026-09-29T14:01:00Z')).action).toBe('missed');
  });

  it('interval：错过多个间隔只取最近一个，下一个=最近一个+间隔', () => {
    const rt = { recurrence_type: 'interval', cron_expression: '60', template: {}, next_run_at: '2026-09-29T10:00:00Z' };
    const p = planTemplate(rt, new Date('2026-09-29T13:10:00Z'));
    expect(p.action).toBe('run');
    expect(iso(p.slot)).toBe('2026-09-29T13:00:00.000Z');
    expect(iso(p.nextRunAt)).toBe('2026-09-29T14:00:00.000Z');
  });
});

describe('instanceTitle', () => {
  it('模板标题后缀模板时区下的时间点，同模板不同天标题不同', () => {
    expect(instanceTitle('晚间复盘', new Date('2026-09-29T14:00:00Z'), 'Asia/Shanghai')).toBe('晚间复盘 · 2026-09-29 22:00');
    expect(instanceTitle('晚间复盘', new Date('2026-09-30T14:00:00Z'), 'Asia/Shanghai')).toBe('晚间复盘 · 2026-09-30 22:00');
  });

  it('超长标题截断到 255 以内，后缀保留', () => {
    const t = instanceTitle('长'.repeat(400), new Date('2026-09-29T14:00:00Z'), 'Asia/Shanghai');
    expect(t.length).toBeLessThanOrEqual(255);
    expect(t.endsWith(' · 2026-09-29 22:00')).toBe(true);
  });
});

describe('validateSchedule', () => {
  it('interval 要求正整数分钟；cron 要求 5 段；template 必须是对象', () => {
    expect(validateSchedule({ recurrence_type: 'interval', cron_expression: '30' })).toBeNull();
    expect(validateSchedule({ recurrence_type: 'interval', cron_expression: '0 22 * * *' })).toMatch(/interval/);
    expect(validateSchedule({ recurrence_type: 'cron', cron_expression: '0 22 * * *' })).toBeNull();
    expect(validateSchedule({ template: ['x'] })).toMatch(/template/);
  });
});
