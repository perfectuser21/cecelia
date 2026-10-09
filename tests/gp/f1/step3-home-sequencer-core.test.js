// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Brain 内序列器核心（第 80 批）
//
// 三代合流架构（Alex 2026-09-05 拍板）：
//   顺序 = 死代码序列器（本模块，九格 + init/finalize，四档 change_kind 裁剪表内建）
//   判断 = 常驻监工 claude -p --resume（判断力永不写进死代码——Kernel derive.js 1640 行的血训）
//   状态 = 台账；手 = fleet 多 provider 不动
//
// 本模块只写「确定性」的部分：格子表、档位裁剪、裁定词路由、收口摘要蒸馏、
// 监工输出解析。judgment（该 accepted 还是 retry）永远来自监工，
// 本模块只回答「监工说 X 之后棋子挪到哪」——这是机械问题，有唯一正确答案。
//
// 路由判则来源（全部是实战案卷，不是拍脑袋）：
//   evaluate FAIL → 回 generate-fix（r54：#54 金丝雀误进 judge 的纠正）
//   seal blocked → 回 contract（#51/#52 幽灵引用：上游合同有病，重试 seal 无意义）
//   publish 确定性 409 → 终局 blocked（c8 考题：双模型盲区，fojc1r 重放已验证）
//   generate attempt≥4 → 终局 blocked（画布判则 r54 平移）
//
// 真 import 被改模块，不 mock。
import { describe, it, expect } from 'vitest';
import {
  STAGE_ORDER,
  GEAR_STAGE_TABLE,
  stagesForGear,
  routeVerdict,
  buildCheckpointDigest,
  parseCommanderReply,
} from '../../../packages/brain/src/orchestrator/home-sequencer.js';

describe('F1 step3 — 序列器格子表与档位裁剪（第 80 批）', () => {
  it('完整格序 = init + 九格 + finalize，顺序固定', () => {
    expect(STAGE_ORDER).toEqual([
      '__run_init', 'plan', 'contract', 'seal', 'generate',
      'evaluate', 'judge', 'publish', 'merge', 'cleanup', '__run_finalize',
    ]);
  });

  it('四档裁剪表：决策 29ae54ae 四档齐全，没有第五种', () => {
    expect(Object.keys(GEAR_STAGE_TABLE).sort()).toEqual([
      'bugfix', 'capability_change', 'new_capability', 'parameter_only',
    ]);
  });

  it('档① new_capability 走全链；档④ parameter_only 跳 plan/contract 但 evaluate 必留（决策原文：evaluator 保留）', () => {
    expect(stagesForGear('new_capability')).toEqual(STAGE_ORDER);
    const lightest = stagesForGear('parameter_only');
    expect(lightest).not.toContain('plan');
    expect(lightest).not.toContain('contract');
    expect(lightest).toContain('evaluate');
    expect(lightest).toContain('publish');
  });

  it('档③ bugfix 跳 plan、免人审（merge 不在格序里，publish 后走 auto 路径）', () => {
    const s = stagesForGear('bugfix');
    expect(s).not.toContain('plan');
    expect(s).toContain('generate');
    expect(s).toContain('judge');
  });

  it('未知档位 → 明确抛错，不静默降级成全链', () => {
    expect(() => stagesForGear('hotfix_v2')).toThrow(/unknown_gear/);
  });
});

describe('F1 step3 — 裁定词路由（机械问题，唯一正确答案）', () => {
  const ctx = (over = {}) => ({ gear: 'new_capability', attempt: 1, fixRounds: 0, ...over });

  it('accepted → 推进到本档格序的下一格', () => {
    const r = routeVerdict('generate', 'accepted', ctx());
    expect(r).toEqual({ kind: 'advance', target: 'evaluate' });
  });

  it('末格 cleanup accepted → 进 finalize', () => {
    expect(routeVerdict('cleanup', 'accepted', ctx())).toEqual(
      { kind: 'advance', target: '__run_finalize' });
  });

  it('retry → 重派本格 attempt+1', () => {
    const r = routeVerdict('contract', 'retry', ctx({ attempt: 1 }));
    expect(r).toEqual({ kind: 'retry', target: 'contract', attempt: 2 });
  });

  it('r54 判则：evaluate 完成但业务裁决 FAIL → 改道 generate-fix，不进 judge', () => {
    const r = routeVerdict('evaluate', 'retry', ctx({ evaluateVerdict: 'FAIL' }));
    expect(r.kind).toBe('reroute');
    expect(r.target).toBe('generate');
    expect(r.reason).toMatch(/generator/);
  });

  it('#51/#52 判则：seal blocked（上游合同有病）→ 改道 contract，不重试 seal', () => {
    const r = routeVerdict('seal', 'blocked', ctx());
    expect(r.kind).toBe('reroute');
    expect(r.target).toBe('contract');
  });

  it('c8 判则：publish blocked（确定性 409）→ 终局 blocked，绝不 retry', () => {
    const r = routeVerdict('publish', 'blocked', ctx());
    expect(r.kind).toBe('finalize');
    expect(r.status).toBe('blocked');
  });

  it('r54 上限：generate 第 4 次尝试仍 retry → 终局 blocked（打转熔断）', () => {
    const r = routeVerdict('generate', 'retry', ctx({ attempt: 4 }));
    expect(r.kind).toBe('finalize');
    expect(r.status).toBe('blocked');
  });

  it('blocked（非特判格）→ 终局 blocked 升人', () => {
    const r = routeVerdict('plan', 'blocked', ctx());
    expect(r.kind).toBe('finalize');
    expect(r.status).toBe('blocked');
  });

  it('裁定词不在封闭词表 → 抛错（监工输出坏了必须炸，不能猜）', () => {
    expect(() => routeVerdict('plan', 'APPROVED', ctx())).toThrow(/invalid_verdict/);
  });
});

describe('F1 step3 — 收口摘要蒸馏（喂食纪律：监工只吃熟料）', () => {
  it('摘要 ≤1200 字节，含格名/尝试/状态，工人长文被截断', () => {
    const digest = buildCheckpointDigest({
      stage_id: 'generate', stage_attempt: 2, status: 'completed',
      summary: 'x'.repeat(9000),
      evidence: [{ type: 'candidate_coordinates', head_sha: 'a'.repeat(40) }],
    });
    expect(Buffer.byteLength(digest, 'utf8')).toBeLessThanOrEqual(1200);
    expect(digest).toMatch(/generate/);
    expect(digest).toMatch(/第2次/);
  });

  it('交接件坐标必须原样在摘要里（监工要拿它对质，不能被截掉）', () => {
    const sha = 'b'.repeat(40);
    const digest = buildCheckpointDigest({
      stage_id: 'generate', stage_attempt: 1, status: 'completed',
      summary: 'y'.repeat(9000),
      evidence: [{ type: 'candidate_coordinates', head_sha: sha, branch: 'cp-x' }],
    });
    expect(digest).toContain(sha);
  });
});

describe('F1 step3 — 监工回复解析（裁定纪律的机械端）', () => {
  it('标准回复 → 提取裁定词与理由', () => {
    const r = parseCommanderReply('分析：证据自洽，P2 不阻塞。\nVERDICT: accepted');
    expect(r).toEqual({ verdict: 'accepted', reasoning: '分析：证据自洽，P2 不阻塞。' });
  });

  it('裁定词大小写/前后杂文容忍，但词表封闭', () => {
    expect(parseCommanderReply('嗯。\nVERDICT: retry\n（补充）').verdict).toBe('retry');
    expect(parseCommanderReply('没有机器行').verdict).toBeNull();
    expect(parseCommanderReply('VERDICT: maybe').verdict).toBeNull();
  });

  it('多行出现多个 VERDICT → 取最后一个（监工自我修正的惯例）', () => {
    const r = parseCommanderReply('VERDICT: retry\n再想想……\nVERDICT: blocked');
    expect(r.verdict).toBe('blocked');
  });
});
