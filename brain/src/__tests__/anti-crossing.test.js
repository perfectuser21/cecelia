/**
 * Anti-Crossing Tests
 * Tests for Feature task collision prevention
 */

import { describe, it, expect } from 'vitest';
import { hashCode } from '../anti-crossing.js';

// Note: Most anti-crossing functions require database access
// These tests cover the utility functions that can be tested without DB

describe('hashCode', () => {
  it('should return a number for any string input', () => {
    expect(typeof hashCode('test')).toBe('number');
    expect(typeof hashCode('')).toBe('number');
    expect(typeof hashCode('uuid-123-456')).toBe('number');
  });

  it('should return consistent hash for same input', () => {
    const input = 'test-feature-id';
    expect(hashCode(input)).toBe(hashCode(input));
  });

  it('should return different hash for different inputs', () => {
    expect(hashCode('feature-1')).not.toBe(hashCode('feature-2'));
  });

  it('should return positive number (absolute value)', () => {
    expect(hashCode('test')).toBeGreaterThanOrEqual(0);
    expect(hashCode('another-test')).toBeGreaterThanOrEqual(0);
    expect(hashCode('negative-check')).toBeGreaterThanOrEqual(0);
  });

  it('should handle unicode strings', () => {
    expect(typeof hashCode('测试')).toBe('number');
    expect(typeof hashCode('テスト')).toBe('number');
  });
});

// Integration tests with mocked DB would go here
// For now, we test the module exports exist

describe('anti-crossing module exports', () => {
  it('should export expected functions', async () => {
    const module = await import('../anti-crossing.js');

    expect(typeof module.checkAntiCrossing).toBe('function');
    expect(typeof module.validateTaskCompletion).toBe('function');
    expect(typeof module.acquireTaskLock).toBe('function');
    expect(typeof module.releaseTaskLock).toBe('function');
    expect(typeof module.getActiveFeaturesWithTasks).toBe('function');
    expect(typeof module.cleanupOrphanedTaskRefs).toBe('function');
    expect(typeof module.hashCode).toBe('function');
  });
});
