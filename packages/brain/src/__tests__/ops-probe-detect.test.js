import { describe, it, expect } from 'vitest';
import { detectPostcondition } from '../ops-collector.js';

describe('detectPostcondition — 从 SKILL.md 判断有无探针', () => {
  // 判据来自决策：「固化时强制配探针，无 postcondition 不许入库」。
  // 实证：业务 skill 的 SKILL.md 用「产出契约」段声明 metrics 必填与最小 evidence。
  it('识别「产出契约」段（业务 skill 实际写法）', () => {
    expect(detectPostcondition('## 产出契约（构造 WORKER_RESULT 前逐项自检）\nmetrics 必填…')).toBe(true);
  });
  it('识别英文 postcondition', () => {
    expect(detectPostcondition('### Postconditions\n- output file exists')).toBe(true);
  });
  it('识别中文后置条件', () => {
    expect(detectPostcondition('后置条件：截图存在且含目标文案')).toBe(true);
  });
  it('识别 evidence 硬要求', () => {
    expect(detectPostcondition('真实模式 completed 的最小 evidence：必须是对象数组，空数组不接受')).toBe(true);
  });
  it('只提一句「验证」不算探针——必须是结构化声明', () => {
    expect(detectPostcondition('记得验证一下结果对不对')).toBe(false);
    expect(detectPostcondition('本 skill 用于抓取视频列表')).toBe(false);
  });
  it('空/null 不抛且判 false（未知不等于有）', () => {
    expect(detectPostcondition(null)).toBe(false);
    expect(detectPostcondition('')).toBe(false);
    expect(detectPostcondition(undefined)).toBe(false);
  });
});
