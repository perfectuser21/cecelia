import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../task-system/db.js', () => ({
  default: { query: vi.fn() }
}));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn()
}));

import {
  getState, isAllowed, recordSuccess, recordFailure, reset,
  getAllStates, FAILURE_THRESHOLD, OPEN_DURATION_MS
} from '../circuit-breaker.js';
import { emit } from '../event-bus.js';

describe('Circuit Breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset('test');
    reset('default');
  });

  describe('initial state', () => {
    it('starts CLOSED with 0 failures', () => {
      const s = getState('fresh-key');
      expect(s.state).toBe('CLOSED');
      expect(s.failures).toBe(0);
      expect(s.lastFailureAt).toBeNull();
      expect(s.openedAt).toBeNull();
    });
  });

  describe('CLOSED → OPEN after threshold failures', () => {
    it('opens after 3 consecutive failures', async () => {
      expect(FAILURE_THRESHOLD).toBe(3);

      await recordFailure('test');
      expect(getState('test').state).toBe('CLOSED');
      expect(getState('test').failures).toBe(1);

      await recordFailure('test');
      expect(getState('test').state).toBe('CLOSED');
      expect(getState('test').failures).toBe(2);

      await recordFailure('test');
      expect(getState('test').state).toBe('OPEN');
      expect(getState('test').failures).toBe(3);
      expect(emit).toHaveBeenCalledWith('circuit_open', 'circuit_breaker', expect.objectContaining({
        key: 'test',
        reason: 'failure_threshold_reached'
      }));
    });

    it('blocks dispatch when OPEN', async () => {
      await recordFailure('test');
      await recordFailure('test');
      await recordFailure('test');

      expect(isAllowed('test')).toBe(false);
    });
  });

  describe('OPEN → HALF_OPEN after cooldown', () => {
    it('transitions to HALF_OPEN after 30 minutes', async () => {
      expect(OPEN_DURATION_MS).toBe(30 * 60 * 1000);

      await recordFailure('test');
      await recordFailure('test');
      await recordFailure('test');
      expect(getState('test').state).toBe('OPEN');

      // Simulate time passing by manipulating openedAt
      // Access internal state - we need to use reset and recordFailure to set up state
      // Instead, test via the getState auto-transition by using vi.useFakeTimers
      vi.useFakeTimers();
      reset('test2');
      await recordFailure('test2');
      await recordFailure('test2');
      await recordFailure('test2');
      expect(getState('test2').state).toBe('OPEN');

      vi.advanceTimersByTime(OPEN_DURATION_MS);
      const s = getState('test2');
      expect(s.state).toBe('HALF_OPEN');
      expect(isAllowed('test2')).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('HALF_OPEN probe', () => {
    it('success → CLOSED', async () => {
      vi.useFakeTimers();
      reset('probe');
      await recordFailure('probe');
      await recordFailure('probe');
      await recordFailure('probe');

      vi.advanceTimersByTime(OPEN_DURATION_MS);
      expect(getState('probe').state).toBe('HALF_OPEN');

      await recordSuccess('probe');
      expect(getState('probe').state).toBe('CLOSED');
      expect(getState('probe').failures).toBe(0);
      expect(emit).toHaveBeenCalledWith('circuit_closed', 'circuit_breaker', expect.objectContaining({
        key: 'probe',
        previous_state: 'HALF_OPEN'
      }));

      vi.useRealTimers();
    });

    it('failure → back to OPEN', async () => {
      vi.useFakeTimers();
      reset('probe2');
      await recordFailure('probe2');
      await recordFailure('probe2');
      await recordFailure('probe2');

      vi.advanceTimersByTime(OPEN_DURATION_MS);
      expect(getState('probe2').state).toBe('HALF_OPEN');

      await recordFailure('probe2');
      expect(getState('probe2').state).toBe('OPEN');
      expect(emit).toHaveBeenCalledWith('circuit_open', 'circuit_breaker', expect.objectContaining({
        key: 'probe2',
        reason: 'half_open_probe_failed'
      }));

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('force resets to CLOSED', async () => {
      await recordFailure('test');
      await recordFailure('test');
      await recordFailure('test');
      expect(getState('test').state).toBe('OPEN');

      reset('test');
      expect(getState('test').state).toBe('CLOSED');
      expect(getState('test').failures).toBe(0);
    });
  });

  describe('getAllStates', () => {
    it('returns states for all tracked keys', async () => {
      await recordFailure('a');
      await recordFailure('b');
      const all = getAllStates();
      expect(all).toHaveProperty('a');
      expect(all).toHaveProperty('b');
      expect(all.a.failures).toBe(1);
      expect(all.b.failures).toBe(1);
    });
  });

  describe('success resets failures in CLOSED state', () => {
    it('resets failure count on success', async () => {
      await recordFailure('test');
      await recordFailure('test');
      expect(getState('test').failures).toBe(2);

      await recordSuccess('test');
      expect(getState('test').failures).toBe(0);
      expect(getState('test').state).toBe('CLOSED');
    });
  });
});
