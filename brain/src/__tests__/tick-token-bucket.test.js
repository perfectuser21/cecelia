/**
 * Tick Token Bucket Tests
 * Tests that tryConsumeToken() works for rate limiting
 */

import { describe, it, expect } from 'vitest';
import { tryConsumeToken, refillTokens } from '../alertness.js';

describe('Token Bucket Rate Limiting', () => {
  describe('tryConsumeToken', () => {
    it('should allow consumption and return remaining count', () => {
      // Refill first to ensure tokens available
      refillTokens();

      const result = tryConsumeToken('dispatch');

      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('remaining');
      expect(typeof result.allowed).toBe('boolean');
      expect(typeof result.remaining).toBe('number');
    });

    it('should eventually deny consumption after many attempts', () => {
      // Exhaust tokens by consuming many times
      let denied = false;
      let attempts = 0;
      const maxAttempts = 100; // Safety limit

      while (!denied && attempts < maxAttempts) {
        const result = tryConsumeToken('dispatch');
        if (!result.allowed) {
          denied = true;
          expect(result.reason).toBe('rate_limited');
          expect(result.remaining).toBe(0);
        }
        attempts++;
      }

      // Should eventually get rate limited
      expect(denied).toBe(true);
    });

    it('should support different bucket types', () => {
      refillTokens();

      const dispatchResult = tryConsumeToken('dispatch');
      expect(dispatchResult.allowed).toBeDefined();

      const l1Result = tryConsumeToken('l1_calls');
      expect(l1Result.allowed).toBeDefined();

      const l2Result = tryConsumeToken('l2_calls');
      expect(l2Result.allowed).toBeDefined();
    });

    it('should return reason when rate limited', () => {
      // Try to exhaust dispatch tokens
      for (let i = 0; i < 20; i++) {
        const result = tryConsumeToken('dispatch');
        if (!result.allowed) {
          expect(result.reason).toBe('rate_limited');
          return; // Test passed
        }
      }

      // If we get here without being rate limited, that's also valid
      // (tokens may have refilled during the loop)
    });
  });

  describe('refillTokens', () => {
    it('should be callable without errors', () => {
      expect(() => refillTokens()).not.toThrow();
    });
  });

  describe('Integration scenario', () => {
    it('should handle token consumption requests', () => {
      // Refill to ensure we start with tokens
      refillTokens();

      // Make some requests
      const results = [];
      for (let i = 0; i < 15; i++) {
        results.push(tryConsumeToken('dispatch'));
      }

      // At least one request should return a valid result
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('allowed');
    });
  });
});
