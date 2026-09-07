import { describe, it, expect } from 'vitest';
import {
  parseEvalScore, inferDiscoStage, rollupAgentMaturity, rollupWorkflowMaturity,
} from '../ops-collector.js';

describe('parseEvalScore — 从 skill_registry.metadata 提分数', () => {
  it('对照式格式：取 with_skill 的分数', () => {
    const s = parseEvalScore('with_skill 16/16 (100%) vs without_skill 6/16 (38%)');
    expect(s.score).toBe(100);
    expect(s.baseline).toBe(38);          // 无 skill 时的对照，用来看提升幅度
    expect(s.raw).toContain('16/16');
  });
  it('单值格式 27/27 (100%)', () => {
    expect(parseEvalScore('27/27 (100%)').score).toBe(100);
  });
  it('非分数文本（如 "EVA v2"）→ score 为 null，禁编造', () => {
    const s = parseEvalScore('EVA v2');
    expect(s.score).toBeNull();
    expect(s.raw).toBe('EVA v2');
  });
  it('空/undefined 不抛', () => {
    expect(parseEvalScore(null).score).toBeNull();
    expect(parseEvalScore('').score).toBeNull();
  });
});

describe('inferDiscoStage — 三档判定（决策：形状重复+变体探明+有探针）', () => {
  // 分档看执行频率与变体收敛度，不看任务复杂度
  it('不可逆写入类 → 永远 code 档（merge/publish/发帖/写库/发钱）', () => {
    expect(inferDiscoStage({ name: 'social-lead-delivery', irreversible: true }).stage).toBe('code');
  });
  it('高频 + 高成功率 + 有探针 → 建议 disco', () => {
    const r = inferDiscoStage({ name: 'x', runs: 200, successRate: 95, hasPostcondition: true });
    expect(r.stage).toBe('disco');
    expect(r.confident).toBe(true);
  });
  it('高频但成功率仍波动 → 停在 software3，且说明缺什么', () => {
    const r = inferDiscoStage({ name: 'x', runs: 200, successRate: 80, hasPostcondition: true });
    expect(r.stage).toBe('software3');
    expect(r.reason).toContain('变体');           // 变体未收敛
  });
  it('无探针 → 绝不升 disco（无 postcondition 不许固化）', () => {
    const r = inferDiscoStage({ name: 'x', runs: 500, successRate: 99, hasPostcondition: false });
    expect(r.stage).toBe('software3');
    expect(r.reason).toContain('探针');
  });
  it('低频 → software3（跑完即弃，不值得固化）', () => {
    expect(inferDiscoStage({ name: 'x', runs: 3, successRate: 100, hasPostcondition: true }).stage).toBe('software3');
  });
  it('数据不全 → confident=false（机器不拍板，等人确认）', () => {
    expect(inferDiscoStage({ name: 'x' }).confident).toBe(false);
  });
});

describe('rollupAgentMaturity — agent 成熟度是算出来的', () => {
  it('取所挂 skill 的最低档（一个还在试错，整体就没固化）', () => {
    const r = rollupAgentMaturity(['a', 'b'], new Map([['a', 'disco'], ['b', 'software3']]));
    expect(r.stage).toBe('software3');
    expect(r.weakest).toBe('b');
  });
  it('全部 disco → disco', () => {
    expect(rollupAgentMaturity(['a', 'b'], new Map([['a', 'disco'], ['b', 'code']])).stage).toBe('disco');
  });
  it('无 skill → null（不编造档位）', () => {
    expect(rollupAgentMaturity([], new Map()).stage).toBeNull();
  });
});

describe('rollupWorkflowMaturity — 木桶效应，且指出卡在哪个阶段', () => {
  it('8 阶段里 1 个还在 software3 → 整条流程 software3，并点名该阶段', () => {
    const stages = [
      { stage: '视频发现', skill: 'a' }, { stage: '线索评分', skill: 'b' },
    ];
    const r = rollupWorkflowMaturity(stages, new Map([['a', 'disco'], ['b', 'software3']]));
    expect(r.stage).toBe('software3');
    expect(r.bottleneck).toBe('线索评分');       // 下一刀该固化谁，一目了然
  });
  it('全 disco → disco 且无瓶颈', () => {
    const r = rollupWorkflowMaturity([{ stage: 's', skill: 'a' }], new Map([['a', 'disco']]));
    expect(r.stage).toBe('disco');
    expect(r.bottleneck).toBeNull();
  });
  it('无阶段 → null', () => {
    expect(rollupWorkflowMaturity([], new Map()).stage).toBeNull();
  });
});
