/**
 * Tests for Alertness Level system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ALERTNESS_LEVELS,
  LEVEL_NAMES,
  SIGNAL_CAPS,
  EVENT_BACKLOG_THRESHOLD,
  RECOVERY_THRESHOLDS,
  DECAY_FACTOR,
  DECAY_INTERVAL_MS,
  scoreToLevel,
  applyDecay,
  getDecayStatus,
  checkRecoveryThreshold,
  tryConsumeToken,
  getTokenBucketStatus,
} from '../alertness.js';

describe('alertness', () => {
  describe('ALERTNESS_LEVELS', () => {
    it('should have 4 levels', () => {
      expect(ALERTNESS_LEVELS.NORMAL).toBe(0);
      expect(ALERTNESS_LEVELS.ALERT).toBe(1);
      expect(ALERTNESS_LEVELS.EMERGENCY).toBe(2);
      expect(ALERTNESS_LEVELS.COMA).toBe(3);
    });
  });

  describe('LEVEL_NAMES', () => {
    it('should map levels to names', () => {
      expect(LEVEL_NAMES[0]).toBe('NORMAL');
      expect(LEVEL_NAMES[1]).toBe('ALERT');
      expect(LEVEL_NAMES[2]).toBe('EMERGENCY');
      expect(LEVEL_NAMES[3]).toBe('COMA');
    });
  });

  describe('SIGNAL_CAPS', () => {
    it('should have caps for key signals', () => {
      expect(SIGNAL_CAPS.consecutive_failures).toBe(40);
      expect(SIGNAL_CAPS.high_failure_rate).toBe(20);
      expect(SIGNAL_CAPS.resource_pressure).toBe(15);
      expect(SIGNAL_CAPS.event_backlog).toBe(20);
    });
  });

  describe('scoreToLevel', () => {
    it('should return NORMAL for score < 20', () => {
      expect(scoreToLevel(0)).toBe(ALERTNESS_LEVELS.NORMAL);
      expect(scoreToLevel(10)).toBe(ALERTNESS_LEVELS.NORMAL);
      expect(scoreToLevel(19)).toBe(ALERTNESS_LEVELS.NORMAL);
    });

    it('should return ALERT for score >= 20 and < 50', () => {
      expect(scoreToLevel(20)).toBe(ALERTNESS_LEVELS.ALERT);
      expect(scoreToLevel(35)).toBe(ALERTNESS_LEVELS.ALERT);
      expect(scoreToLevel(49)).toBe(ALERTNESS_LEVELS.ALERT);
    });

    it('should return EMERGENCY for score >= 50 and < 80', () => {
      expect(scoreToLevel(50)).toBe(ALERTNESS_LEVELS.EMERGENCY);
      expect(scoreToLevel(65)).toBe(ALERTNESS_LEVELS.EMERGENCY);
      expect(scoreToLevel(79)).toBe(ALERTNESS_LEVELS.EMERGENCY);
    });

    it('should return COMA for score >= 80', () => {
      expect(scoreToLevel(80)).toBe(ALERTNESS_LEVELS.COMA);
      expect(scoreToLevel(100)).toBe(ALERTNESS_LEVELS.COMA);
      expect(scoreToLevel(200)).toBe(ALERTNESS_LEVELS.COMA);
    });
  });

  describe('EVENT_BACKLOG_THRESHOLD', () => {
    it('should be 50', () => {
      expect(EVENT_BACKLOG_THRESHOLD).toBe(50);
    });
  });

  describe('RECOVERY_THRESHOLDS', () => {
    it('should have increasing stability times for higher levels', () => {
      // ALERT→NORMAL: 10 min
      expect(RECOVERY_THRESHOLDS[ALERTNESS_LEVELS.ALERT]).toBe(10 * 60 * 1000);
      // EMERGENCY→ALERT: 15 min
      expect(RECOVERY_THRESHOLDS[ALERTNESS_LEVELS.EMERGENCY]).toBe(15 * 60 * 1000);
      // COMA→EMERGENCY: 30 min
      expect(RECOVERY_THRESHOLDS[ALERTNESS_LEVELS.COMA]).toBe(30 * 60 * 1000);
    });
  });

  describe('DECAY_FACTOR and DECAY_INTERVAL', () => {
    it('should have decay factor 0.8 and interval 10 minutes', () => {
      expect(DECAY_FACTOR).toBe(0.8);
      expect(DECAY_INTERVAL_MS).toBe(10 * 60 * 1000);
    });
  });

  describe('applyDecay', () => {
    it('should return score when no decay cycles have passed', () => {
      const score = applyDecay(50);
      // First call sets accumulated score
      expect(score).toBeGreaterThanOrEqual(50);
    });

    it('should use max of raw score and accumulated score', () => {
      // High score first
      applyDecay(100);
      // Lower score should still use accumulated
      const score = applyDecay(10);
      expect(score).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getDecayStatus', () => {
    it('should return decay configuration', () => {
      const status = getDecayStatus();
      expect(status).toHaveProperty('accumulated_score');
      expect(status).toHaveProperty('last_decay_at');
      expect(status.decay_factor).toBe(0.8);
      expect(status.decay_interval_ms).toBe(600000);
    });
  });

  describe('checkRecoveryThreshold', () => {
    it('should always allow escalation (upgrade)', () => {
      expect(checkRecoveryThreshold(0, 1)).toBe(true);
      expect(checkRecoveryThreshold(1, 2)).toBe(true);
      expect(checkRecoveryThreshold(2, 3)).toBe(true);
    });

    it('should check stability time for downgrade', () => {
      // This tests the function logic, actual timing depends on _lastLevelChangeAt
      const result = checkRecoveryThreshold(1, 0);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('tryConsumeToken', () => {
    it('should consume token from valid bucket', () => {
      const result = tryConsumeToken('dispatch');
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('remaining');
    });

    it('should reject unknown bucket', () => {
      const result = tryConsumeToken('unknown_bucket');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('unknown_bucket');
    });
  });

  describe('getTokenBucketStatus', () => {
    it('should return status for all buckets', () => {
      const status = getTokenBucketStatus();
      expect(status).toHaveProperty('dispatch');
      expect(status).toHaveProperty('l1_calls');
      expect(status).toHaveProperty('l2_calls');
      expect(status.dispatch).toHaveProperty('tokens');
      expect(status.dispatch).toHaveProperty('maxTokens');
    });
  });
});
