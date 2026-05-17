/**
 * salience-score.test.js
 *
 * 测试改进后的 computeSalience 多维度评分
 */

import { describe, it, expect } from 'vitest';
import { computeSalience } from '../orchestrator-chat.js';

describe('computeSalience — 纠正类（维持 0.9）', () => {
  it('包含"不对"', () => expect(computeSalience('不对，应该是这样')).toBeCloseTo(0.9, 1));
  it('包含"错误"', () => expect(computeSalience('这里有错误')).toBeCloseTo(0.9, 1));
  it('包含"纠正"', () => expect(computeSalience('纠正一下你的说法')).toBeCloseTo(0.9, 1));
});

describe('computeSalience — 决定类（0.85）', () => {
  it('包含"决定"', () => expect(computeSalience('我决定采用这个方案')).toBeGreaterThanOrEqual(0.8));
  it('包含"确认"', () => expect(computeSalience('确认就这样做')).toBeGreaterThanOrEqual(0.8));
});

describe('computeSalience — 洞察类（>= 0.75）', () => {
  it('包含"发现"', () => expect(computeSalience('我发现这里有个规律')).toBeGreaterThanOrEqual(0.75));
  it('包含"原来"', () => expect(computeSalience('原来是这么回事')).toBeGreaterThanOrEqual(0.75));
  it('包含"关键"', () => expect(computeSalience('关键是要先做好基础')).toBeGreaterThanOrEqual(0.75));
  it('包含"理解"', () => expect(computeSalience('我理解了你的意思')).toBeGreaterThanOrEqual(0.75));
});

describe('computeSalience — 计划类（>= 0.65）', () => {
  it('包含"下一步"', () => expect(computeSalience('下一步我们要做什么')).toBeGreaterThanOrEqual(0.65));
  it('包含"计划"', () => expect(computeSalience('我计划这周完成')).toBeGreaterThanOrEqual(0.65));
  it('包含"接下来"', () => expect(computeSalience('接下来应该怎么安排')).toBeGreaterThanOrEqual(0.65));
});

describe('computeSalience — 长消息（>= 0.50）', () => {
  it('50字以上消息', () => {
    const longMsg = '这是一段很长的消息，内容包含了很多细节，需要认真考虑每个方面的情况，我们要确保不遗漏任何重要信息哦。';
    expect(longMsg.length).toBeGreaterThanOrEqual(50);
    expect(computeSalience(longMsg)).toBeGreaterThanOrEqual(0.50);
  });
});

describe('computeSalience — 疑问类（>= 0.5）', () => {
  it('包含问号', () => expect(computeSalience('这个怎么做？')).toBeGreaterThanOrEqual(0.5));
});

describe('computeSalience — 普通消息（0.3）', () => {
  it('空消息', () => expect(computeSalience('')).toBe(0.3));
  it('普通短消息', () => expect(computeSalience('好的')).toBe(0.3));
  it('简单回复', () => expect(computeSalience('嗯')).toBe(0.3));
});
