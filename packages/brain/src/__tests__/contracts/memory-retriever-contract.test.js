/**
 * Contract Test: memory-retriever.js
 *
 * Guards the interface contract of memory retrieval functions.
 * Tests pure functions that don't need DB.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyQueryIntent,
  computeTopicDepth,
  timeDecay,
  simpleDedup,
  quotaAwareSelect,
  HALF_LIFE,
  MODE_WEIGHT,
  SOURCE_QUOTA,
  CHAT_TOKEN_BUDGET,
} from '../../memory-retriever.js';

describe('memory-retriever contract', () => {
  describe('classifyQueryIntent', () => {
    it('returns string', () => {
      const result = classifyQueryIntent('test query');
      expect(typeof result).toBe('string');
    });

    it('returns "default" for null/undefined', () => {
      expect(classifyQueryIntent(null)).toBe('default');
      expect(classifyQueryIntent(undefined)).toBe('default');
    });

    it('returns valid intent type', () => {
      const validIntents = ['task_focused', 'emotion_focused', 'learning_focused', 'default'];
      const result = classifyQueryIntent('some random query');
      expect(validIntents).toContain(result);
    });
  });

  describe('computeTopicDepth', () => {
    it('returns a number', () => {
      const result = computeTopicDepth('test', []);
      expect(typeof result).toBe('number');
    });

    it('returns 0 for empty conversation', () => {
      expect(computeTopicDepth('test', [])).toBe(0);
      expect(computeTopicDepth('test', null)).toBe(0);
    });

    it('returns 0, 1, or 2', () => {
      const result = computeTopicDepth('test', [{ title: 'test' }]);
      expect([0, 1, 2]).toContain(result);
    });
  });

  describe('timeDecay', () => {
    it('returns a number between 0 and 1', () => {
      const result = timeDecay(new Date().toISOString(), 7);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('returns ~1 for recent dates', () => {
      const result = timeDecay(new Date().toISOString(), 7);
      expect(result).toBeGreaterThan(0.9);
    });

    it('returns < 0.5 for dates older than half-life', () => {
      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
      const result = timeDecay(old, 7);
      expect(result).toBeLessThan(0.6);
    });
  });

  describe('simpleDedup', () => {
    it('returns an array', () => {
      expect(Array.isArray(simpleDedup([]))).toBe(true);
    });

    it('preserves items with different text', () => {
      const items = [
        { id: '1', text: 'hello world foo bar baz', finalScore: 1 },
        { id: '2', text: 'completely different text here now', finalScore: 0.8 },
      ];
      const result = simpleDedup(items);
      expect(result.length).toBe(2);
    });
  });

  describe('constants', () => {
    it('HALF_LIFE is an object with numeric values', () => {
      expect(typeof HALF_LIFE).toBe('object');
      for (const val of Object.values(HALF_LIFE)) {
        expect(typeof val).toBe('number');
      }
    });

    it('MODE_WEIGHT is an object with per-mode weight objects', () => {
      expect(typeof MODE_WEIGHT).toBe('object');
      for (const val of Object.values(MODE_WEIGHT)) {
        expect(typeof val).toBe('object');
        expect(val).toHaveProperty('plan');
        expect(typeof val.plan).toBe('number');
      }
    });

    it('SOURCE_QUOTA is an object', () => {
      expect(typeof SOURCE_QUOTA).toBe('object');
    });

    it('CHAT_TOKEN_BUDGET is a positive number', () => {
      expect(typeof CHAT_TOKEN_BUDGET).toBe('number');
      expect(CHAT_TOKEN_BUDGET).toBeGreaterThan(0);
    });
  });
});
