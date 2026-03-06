/**
 * Contract Test: decision.js
 *
 * Guards the interface contract of decision functions.
 * Tests pure functions (splitActionsBySafety, SAFE_ACTIONS).
 */
import { describe, it, expect } from 'vitest';
import { SAFE_ACTIONS, splitActionsBySafety } from '../../decision.js';

describe('decision contract', () => {
  describe('SAFE_ACTIONS', () => {
    it('is a Set', () => {
      expect(SAFE_ACTIONS).toBeInstanceOf(Set);
    });

    it('contains known safe actions', () => {
      expect(SAFE_ACTIONS.has('retry')).toBe(true);
      expect(SAFE_ACTIONS.has('reprioritize')).toBe(true);
      expect(SAFE_ACTIONS.has('skip')).toBe(true);
    });

    it('does not contain unsafe actions', () => {
      expect(SAFE_ACTIONS.has('deploy')).toBe(false);
      expect(SAFE_ACTIONS.has('delete')).toBe(false);
    });
  });

  describe('splitActionsBySafety', () => {
    it('returns object with safeActions and unsafeActions arrays', () => {
      const result = splitActionsBySafety([]);
      expect(result).toHaveProperty('safeActions');
      expect(result).toHaveProperty('unsafeActions');
      expect(Array.isArray(result.safeActions)).toBe(true);
      expect(Array.isArray(result.unsafeActions)).toBe(true);
    });

    it('correctly separates safe and unsafe actions', () => {
      const actions = [
        { type: 'retry', target_id: '1' },
        { type: 'deploy', target_id: '2' },
        { type: 'skip', target_id: '3' },
        { type: 'escalate', target_id: '4' },
      ];
      const result = splitActionsBySafety(actions);
      expect(result.safeActions).toHaveLength(2);
      expect(result.unsafeActions).toHaveLength(2);
      expect(result.safeActions[0].type).toBe('retry');
      expect(result.safeActions[1].type).toBe('skip');
      expect(result.unsafeActions[0].type).toBe('deploy');
    });

    it('returns all safe when no unsafe actions', () => {
      const actions = [{ type: 'retry' }, { type: 'reprioritize' }];
      const result = splitActionsBySafety(actions);
      expect(result.safeActions).toHaveLength(2);
      expect(result.unsafeActions).toHaveLength(0);
    });

    it('returns all unsafe when no safe actions', () => {
      const actions = [{ type: 'deploy' }, { type: 'escalate' }];
      const result = splitActionsBySafety(actions);
      expect(result.safeActions).toHaveLength(0);
      expect(result.unsafeActions).toHaveLength(2);
    });
  });
});
