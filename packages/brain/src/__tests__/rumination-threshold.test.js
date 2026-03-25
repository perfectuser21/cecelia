/**
 * rumination-threshold.test.js
 *
 * 测试 PR13 — classifySaliencePriority 分桶逻辑
 * 与 PR9 computeSalience 8 维度对齐
 */

import { describe, it, expect } from 'vitest';
import {
  classifySaliencePriority,
  SALIENCE_THRESHOLD_HIGH,
  SALIENCE_THRESHOLD_MID,
  SALIENCE_THRESHOLD_LOW,
} from '../rumination.js';

describe('classifySaliencePriority — 常量值验证', () => {
  it('HIGH 阈值为 0.85', () => expect(SALIENCE_THRESHOLD_HIGH).toBe(0.85));
  it('MID 阈值为 0.75', () => expect(SALIENCE_THRESHOLD_MID).toBe(0.75));
  it('LOW 阈值为 0.55', () => expect(SALIENCE_THRESHOLD_LOW).toBe(0.55));
});

describe('classifySaliencePriority — HIGH 优先级（纠正/决定，0.85+）', () => {
  it('score = 0.9（纠正类）→ HIGH', () => expect(classifySaliencePriority(0.9)).toBe('HIGH'));
  it('score = 0.85（决定类边界）→ HIGH', () => expect(classifySaliencePriority(0.85)).toBe('HIGH'));
  it('score = 1.0（满分）→ HIGH', () => expect(classifySaliencePriority(1.0)).toBe('HIGH'));
});

describe('classifySaliencePriority — MID 优先级（洞察/情绪，0.75-0.84）', () => {
  it('score = 0.80（洞察类）→ MID', () => expect(classifySaliencePriority(0.80)).toBe('MID'));
  it('score = 0.75（情绪类边界）→ MID', () => expect(classifySaliencePriority(0.75)).toBe('MID'));
  it('score = 0.84（HIGH 边界下方）→ MID', () => expect(classifySaliencePriority(0.84)).toBe('MID'));
});

describe('classifySaliencePriority — LOW 优先级（计划/长消息，0.55-0.74）', () => {
  it('score = 0.70（计划类）→ LOW', () => expect(classifySaliencePriority(0.70)).toBe('LOW'));
  it('score = 0.55（长消息/疑问边界）→ LOW', () => expect(classifySaliencePriority(0.55)).toBe('LOW'));
  it('score = 0.74（MID 边界下方）→ LOW', () => expect(classifySaliencePriority(0.74)).toBe('LOW'));
});

describe('classifySaliencePriority — SKIP（疑问/基础，< 0.55）', () => {
  it('score = 0.3（基础分）→ SKIP', () => expect(classifySaliencePriority(0.3)).toBe('SKIP'));
  it('score = 0.54（LOW 边界下方）→ SKIP', () => expect(classifySaliencePriority(0.54)).toBe('SKIP'));
  it('score = 0.0 → SKIP', () => expect(classifySaliencePriority(0.0)).toBe('SKIP'));
});

describe('classifySaliencePriority — 向后兼容（null/undefined 安全降级）', () => {
  it('score = null → SKIP（旧记录无 salience_score）', () => expect(classifySaliencePriority(null)).toBe('SKIP'));
  it('score = undefined → SKIP', () => expect(classifySaliencePriority(undefined)).toBe('SKIP'));
  it('score 缺省调用 → SKIP', () => expect(classifySaliencePriority()).toBe('SKIP'));
});
