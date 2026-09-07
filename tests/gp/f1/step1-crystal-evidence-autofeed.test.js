// F1「工厂 · 开发闭环」步骤 1 —— 边：验证证据自动回流判官账本
//
// 断链（2026-09-07 实测）：crystal-verify 跑完只把 verdict 写成本地 JSON 文件，
// 从不 POST 给判官。当天 open_publish 在两台机器上各跑 3 次全 ok，
// 而 crystal_run_evidence 表里一条都没有。
//
// 后果不是「少了点数据」——判官的经济门要求 20 次滚动窗口内 ≥90%，
// 证据不回流就意味着 **promote 这条路径实质是死的**：技能跑得再多再好，
// 账本永远停在 0 条，永远晋升不了。真机跑一次的成本是几十秒 + 真实设备占用，
// 白跑掉的每一次都不可能补回来（verified_at 是过去时刻）。
//
// 两个容易写错的地方，各配一条守卫：
//
// ① has_postcondition 必须从序列真实推导，不能默认填 true。
//    判官的铁律是「无探针不许固化」，这个字段就是那道闸的输入。
//    填死 true 等于把闸拆了——一个没有 postcondition 的序列会被判官当成
//    有探针而放行晋升，那正是这条铁律要防的事。
//
// ② 上报失败必须显式可见，不能静默吞掉。
//    这跟同日修的 registry 路径 bug 是同一类病：静默降级比崩溃贵得多。
//    本地验证已经花掉了真机时间，如果回流悄悄失败，人会以为账本在涨。

import { describe, it, expect, vi } from 'vitest';
import {
  buildEvidencePayload, reportEvidence, averageBaselineTokens,
} from '../../../packages/quality/phone-crystal/evidence-report.mjs';

const VERDICT = {
  sequence: 'open_publish',
  runs: 3,
  passes: 3,
  all_ok: true,
  pure_hot_path: true,
  crystallized: true,
  avg_ms: 8660,
  avg_tokens: 0,
  device: 'MAA-AN00|40.3.0|524',
  verified_at: '2026-09-07T01:11:43.758Z',
};

describe('F1 step1 · 证据 payload 映射', () => {
  it('unit_key 取序列名，核心计数原样带上', () => {
    const p = buildEvidencePayload(VERDICT, { postcondition: { type: 'foreground_activity' } });
    expect(p.unit_key).toBe('open_publish');
    expect(p.runs).toBe(3);
    expect(p.passes).toBe(3);
    expect(p.verified_at).toBe('2026-09-07T01:11:43.758Z');
  });

  it('热路径 token 与设备键带上，供判官算 cost_benefit 和分设备统计', () => {
    const p = buildEvidencePayload(VERDICT, {});
    expect(p.hot_path_tokens).toBe(0);
    expect(p.device).toBe('MAA-AN00|40.3.0|524');
    expect(p.avg_ms).toBe(8660);
  });

  it('序列有 postcondition → has_postcondition 为真', () => {
    const p = buildEvidencePayload(VERDICT, { postcondition: { type: 'vision', describe: 'x' } });
    expect(p.has_postcondition).toBe(true);
  });

  // 这条守着「无探针不许固化」那道闸的输入
  it('序列没有 postcondition → 必须为假，不许默认填真', () => {
    expect(buildEvidencePayload(VERDICT, {}).has_postcondition).toBe(false);
    expect(buildEvidencePayload(VERDICT, { postcondition: null }).has_postcondition).toBe(false);
  });

  it('失败次数按 runs-passes 推导，不靠调用方自觉', () => {
    const p = buildEvidencePayload({ ...VERDICT, passes: 1 }, {});
    expect(p.broken_count).toBe(2);
  });
});

// 判官的经济门要算 cost_benefit = 基线成本 / 热路径成本。
// 没有基线这道门永远过不了 —— 证据回流了却依旧晋升不了，等于白回流。
// 09-07 实测：search_account_v4 回流后仍是 keep_llm，就因为 token_cost=0。
//
// 基线不需要另测：探索阶段本来就是纯 LLM 在跑，那时烧的 token 就是基线。
// 它是序列的固有属性（蒸馏时定下），不是每次验证都要重测的东西。
describe('F1 step1 · 经济账基线', () => {
  it('从探索轨迹取平均 token 作为基线', () => {
    expect(averageBaselineTokens([{ tokens: 2026 }, { tokens: 2040 }, { tokens: 1984 }])).toBe(2017);
  });

  it('没有轨迹 → null，不编造', () => {
    expect(averageBaselineTokens([])).toBeNull();
    expect(averageBaselineTokens(null)).toBeNull();
  });

  it('序列带基线 → 随证据交给判官', () => {
    const p = buildEvidencePayload(VERDICT, { baseline_tokens: 2017, postcondition: {} });
    expect(p.baseline_tokens).toBe(2017);
  });

  // null 和 0 必须分得开：null = 没测过（判官该按数据缺口处理），
  // 0 = 测过且真的不烧 token。填 0 冒充"已知"会让判官算出假的经济账。
  it('序列没基线 → null，不退化成 0', () => {
    const p = buildEvidencePayload(VERDICT, { postcondition: {} });
    expect(p.baseline_tokens).toBeNull();
  });
});

describe('F1 step1 · 回流失败必须可见', () => {
  const SEQ = { postcondition: { type: 'foreground_activity' } };

  it('上报成功 → reported 为真', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"id":1}' }));
    const r = await reportEvidence(VERDICT, SEQ, { url: 'http://brain:5221', fetchFn });
    expect(r.reported).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('服务端拒绝 → reported 为假且带上状态码，不假装成功', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 400, text: async () => '{"error":"missing"}' }));
    const r = await reportEvidence(VERDICT, SEQ, { url: 'http://brain:5221', fetchFn });
    expect(r.reported).toBe(false);
    expect(r.error).toContain('400');
  });

  it('网络不通 → reported 为假且带上原因，不抛出打断本地验证', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const r = await reportEvidence(VERDICT, SEQ, { url: 'http://brain:5221', fetchFn });
    expect(r.reported).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('没配 URL → 明说跳过，不冒充成功也不报错', async () => {
    const fetchFn = vi.fn();
    const r = await reportEvidence(VERDICT, SEQ, { url: '', fetchFn });
    expect(r.reported).toBe(false);
    expect(r.skipped).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
