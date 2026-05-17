/**
 * Memory Router Tests
 */

import { describe, it, expect } from 'vitest';
import { routeMemory, INTENT_TYPES, MEMORY_STRATEGY } from '../memory-router.js';

describe('Memory Router', () => {
  describe('routeMemory()', () => {
    it('R1: 空消息返回 general', () => {
      const { intentType } = routeMemory('');
      expect(intentType).toBe(INTENT_TYPES.GENERAL);
    });

    it('R2: null 消息返回 general', () => {
      const { intentType } = routeMemory(null);
      expect(intentType).toBe(INTENT_TYPES.GENERAL);
    });

    it('R3: 自我反思意图识别', () => {
      const { intentType, strategy } = routeMemory('你最近在想什么？');
      expect(intentType).toBe(INTENT_TYPES.SELF_REFLECTION);
      expect(strategy.episodic).toBe(true);
      expect(strategy.episodicBudget).toBeGreaterThan(0);
    });

    it('R4: 任务查询意图识别', () => {
      const { intentType, strategy } = routeMemory('上次那个任务的进度怎么样？');
      expect(intentType).toBe(INTENT_TYPES.TASK_QUERY);
      expect(strategy.semantic).toBe(true);
    });

    it('R5: 状态检查意图识别', () => {
      const { intentType, strategy } = routeMemory('系统现在状态怎么样？');
      expect(intentType).toBe(INTENT_TYPES.STATUS_CHECK);
      expect(strategy.events).toBe(true);
    });

    it('R6: 无明显关键词返回 general', () => {
      const { intentType, strategy } = routeMemory('你好');
      expect(intentType).toBe(INTENT_TYPES.GENERAL);
      expect(strategy.semantic).toBe(true);
      expect(strategy.episodic).toBe(true);
      expect(strategy.events).toBe(true);
    });

    it('R7: 每种意图都有对应 strategy', () => {
      for (const intentType of Object.values(INTENT_TYPES)) {
        expect(MEMORY_STRATEGY[intentType]).toBeDefined();
        expect(typeof MEMORY_STRATEGY[intentType].episodicBudget).toBe('number');
        expect(typeof MEMORY_STRATEGY[intentType].semanticBudget).toBe('number');
      }
    });

    it('R8: self_reflection strategy 不激活 semantic memory', () => {
      const { strategy } = routeMemory('你有什么感受？');
      expect(strategy.semantic).toBe(false);
    });

    it('R9: status_check strategy 只激活 events', () => {
      const { strategy } = routeMemory('当前系统有没有告警？');
      expect(strategy.events).toBe(true);
      expect(strategy.semantic).toBe(false);
      expect(strategy.episodic).toBe(false);
    });
  });
});
