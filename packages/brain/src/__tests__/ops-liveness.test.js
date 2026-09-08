import { describe, it, expect } from 'vitest';
import { computeIntervalBaseline, classifyLiveness, summarizeLiveness } from '../ops-liveness.js';

// 判据来自决策「失联判定按各流程自己的历史节奏自动算」：
// 各流程节奏差百倍（通道类 4 秒/次 vs 智能获客 70 分钟/次 vs 编码流水线 2.4 小时/次），
// 统一固定阈值必然两头不讨好——高频流程死透了还显示正常，低频流程天天误报。
describe('computeIntervalBaseline — 从运行历史算正常节奏', () => {
  const t = (s) => new Date(`2026-09-07T10:${s}Z`);

  it('取中位间隔而非平均——平均会被单次长空档带偏', () => {
    // 间隔 60/60/60/600 秒：平均 195，中位 60。真实节奏是 60。
    const runs = [t('00:00'), t('01:00'), t('02:00'), t('03:00'), t('13:00')];
    expect(computeIntervalBaseline(runs)).toBe(60);
  });

  it('输入乱序也能算对（DB 返回顺序不保证）', () => {
    const runs = [t('02:00'), t('00:00'), t('03:00'), t('01:00')];
    expect(computeIntervalBaseline(runs)).toBe(60);
  });

  it('样本不足 2 条 → null（算不出间隔）', () => {
    expect(computeIntervalBaseline([t('00:00')])).toBeNull();
    expect(computeIntervalBaseline([])).toBeNull();
    expect(computeIntervalBaseline(null)).toBeNull();
  });

  it('同一时刻的重复运行不产生 0 间隔基线', () => {
    // 并发触发会产生同秒多条；若不剔除，中位会被 0 拉死，任何静默都判红
    const runs = [t('00:00'), t('00:00'), t('00:00'), t('01:00'), t('02:00')];
    expect(computeIntervalBaseline(runs)).toBe(60);
  });
});

describe('classifyLiveness — 判活/黄/红', () => {
  const NOW = Date.parse('2026-09-08T12:00:00Z');
  const ago = (sec) => new Date(NOW - sec * 1000);

  it('冷启动：运行次数不足 10 次不告警（基线不可信）', () => {
    const r = classifyLiveness({ lastRunAt: ago(999999), baselineSec: 60, runCount: 3, now: NOW });
    expect(r.liveness).toBe('cold');
  });

  it('没有基线（从未跑过）→ cold，不是 dead', () => {
    const r = classifyLiveness({ lastRunAt: null, baselineSec: null, runCount: 0, now: NOW });
    expect(r.liveness).toBe('cold');
    expect(r.silent_sec).toBeNull();
  });

  it('智能获客：70 分钟基线，停 1 小时正常 / 停 6 小时黄 / 停 24 小时红', () => {
    const base = 70 * 60;
    const at = (sec) => classifyLiveness({ lastRunAt: ago(sec), baselineSec: base, runCount: 200, now: NOW }).liveness;
    expect(at(3600)).toBe('ok');
    expect(at(6 * 3600)).toBe('warn');
    expect(at(24 * 3600)).toBe('dead');
  });

  it('编码流水线：2.4 小时基线，停 12 小时黄 / 停 2 天红', () => {
    const base = 2.4 * 3600;
    const at = (sec) => classifyLiveness({ lastRunAt: ago(sec), baselineSec: base, runCount: 63, now: NOW }).liveness;
    expect(at(4 * 3600)).toBe('ok');
    expect(at(12 * 3600)).toBe('warn');
    expect(at(48 * 3600)).toBe('dead');
  });

  it('高频流程有绝对下限保护——4 秒基线不会因空档 80 秒就判死', () => {
    // 纯倍数下 4s×20=80s 判死，但通道类没任务时空几分钟是正常的。
    // 下限：黄不早于 5 分钟，红不早于 15 分钟。
    const base = 4;
    const at = (sec) => classifyLiveness({ lastRunAt: ago(sec), baselineSec: base, runCount: 1393, now: NOW }).liveness;
    expect(at(80)).toBe('ok');
    expect(at(6 * 60)).toBe('warn');
    expect(at(20 * 60)).toBe('dead');
  });

  it('低频流程有绝对上限——再宽容也不会超过 30 天不报', () => {
    const base = 30 * 86400; // 月更流程，20 倍 = 600 天
    const r = classifyLiveness({ lastRunAt: ago(31 * 86400), baselineSec: base, runCount: 12, now: NOW });
    expect(r.liveness).toBe('dead');
  });

  it('透出判定依据供看板显示（不能只给个颜色让人猜）', () => {
    const r = classifyLiveness({ lastRunAt: ago(3600), baselineSec: 600, runCount: 50, now: NOW });
    expect(r.silent_sec).toBe(3600);
    expect(r.warn_after_sec).toBe(3000);   // 600×5
    expect(r.dead_after_sec).toBe(12000);  // 600×20
    expect(r.liveness).toBe('warn');
  });

  it('本次真实事故可复现：智能获客停 20.4 小时必须离开 ok 态', () => {
    // 09-07 15:18 最后一跑，09-08 12:00 才被人工考古发现，中间 20.4 小时无人察觉。
    // 该流程基线 70 分钟 → 黄 5.8h / 红 23.3h，所以 20.4h 落在黄区而非红区。
    // 这里不为了让本案例变红去调倍数（那会让高频流程误报）——事故的核心诉求是
    // 「不能还显示正常」，黄已足够在看板上炸出来。
    const r = classifyLiveness({ lastRunAt: ago(20.4 * 3600), baselineSec: 70 * 60, runCount: 206, now: NOW });
    expect(r.liveness).not.toBe('ok');
    expect(r.liveness).toBe('warn');
    // 再多停 3 小时就该红
    const later = classifyLiveness({ lastRunAt: ago(24 * 3600), baselineSec: 70 * 60, runCount: 206, now: NOW });
    expect(later.liveness).toBe('dead');
  });
});

describe('summarizeLiveness — 从一条流程的 run 列表直接得出活性（采集器接线用）', () => {
  const NOW = Date.parse('2026-09-08T12:00:00Z');
  const mk = (isoList) => isoList.map((s) => ({ started_at: new Date(s), status: 'success' }));

  it('智能获客真实形态：规律 70 分钟一轮、最后一轮在 20.4 小时前 → 黄且带出基线', () => {
    const runs = [];
    // 从 09-07 15:18 往前推 40 轮，每 70 分钟一轮
    const last = Date.parse('2026-09-07T15:36:00Z');
    for (let i = 0; i < 40; i += 1) runs.push({ started_at: new Date(last - i * 70 * 60000), status: 'success' });
    const r = summarizeLiveness(runs, NOW);
    expect(r.baseline_interval_sec).toBe(4200);
    expect(r.liveness).toBe('warn');
    expect(r.silent_sec).toBeGreaterThan(20 * 3600);
  });

  it('从未跑过的流程（空列表）→ cold，全字段 null 不抛', () => {
    const r = summarizeLiveness([], NOW);
    expect(r.liveness).toBe('cold');
    expect(r.baseline_interval_sec).toBeNull();
    expect(r.silent_sec).toBeNull();
  });

  it('刚跑过的活流程 → ok', () => {
    const runs = [];
    for (let i = 0; i < 30; i += 1) runs.push({ started_at: new Date(NOW - i * 600000), status: 'success' });
    expect(summarizeLiveness(runs, NOW).liveness).toBe('ok');
  });

  it('缺 started_at 的脏数据不参与基线计算也不抛', () => {
    const runs = [...mk(['2026-09-08T11:00:00Z', '2026-09-08T11:10:00Z']), { status: 'error' }];
    expect(() => summarizeLiveness(runs, NOW)).not.toThrow();
  });
});
