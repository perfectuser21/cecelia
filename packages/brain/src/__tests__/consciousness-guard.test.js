import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { isConsciousnessEnabled, logStartupDeclaration, GUARDED_MODULES, _resetDeprecationWarn } from '../consciousness-guard.js';

describe('consciousness-guard', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
    _resetDeprecationWarn();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isConsciousnessEnabled', () => {
    test('default is true when no env vars set', () => {
      expect(isConsciousnessEnabled()).toBe(true);
    });

    test('CONSCIOUSNESS_ENABLED=false disables', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'false';
      expect(isConsciousnessEnabled()).toBe(false);
    });

    test('CONSCIOUSNESS_ENABLED=true enables', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'true';
      expect(isConsciousnessEnabled()).toBe(true);
    });

    test('BRAIN_QUIET_MODE=true backward compat', () => {
      process.env.BRAIN_QUIET_MODE = 'true';
      expect(isConsciousnessEnabled()).toBe(false);
    });

    test('new env overrides when both set (CONSCIOUSNESS_ENABLED=true wins)', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'true';
      process.env.BRAIN_QUIET_MODE = 'true';
      expect(isConsciousnessEnabled()).toBe(true);
    });

    test('BRAIN_QUIET_MODE=false (non-"true") does not disable', () => {
      process.env.BRAIN_QUIET_MODE = 'false';
      expect(isConsciousnessEnabled()).toBe(true);
    });
  });

  describe('GUARDED_MODULES', () => {
    test('contains all expected module names', () => {
      const expected = [
        'thalamus', 'rumination', 'rumination-scheduler', 'narrative',
        'diary-scheduler', 'conversation-digest', 'conversation-consolidator',
        'capture-digestion', 'self-report', 'notebook-feeder',
        'proactive-mouth', 'evolution-scanner', 'evolution-synthesizer',
        'desire-system', 'suggestion-cycle', 'self-drive',
        'dept-heartbeat', 'pending-followups',
      ];
      for (const mod of expected) {
        expect(GUARDED_MODULES).toContain(mod);
      }
    });
  });

  describe('logStartupDeclaration', () => {
    test('prints nothing when consciousness enabled', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logStartupDeclaration();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('prints declaration when CONSCIOUSNESS_ENABLED=false', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'false';
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logStartupDeclaration();
      const calls = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(calls).toContain('CONSCIOUSNESS_ENABLED=false');
      expect(calls).toContain('意识层全部跳过');
      expect(calls).toContain('守护模块');
      spy.mockRestore();
    });

    test('deprecation warn only once when using BRAIN_QUIET_MODE=true', () => {
      process.env.BRAIN_QUIET_MODE = 'true';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      isConsciousnessEnabled();
      isConsciousnessEnabled();
      isConsciousnessEnabled();
      const warnCalls = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(warnCalls).toContain('BRAIN_QUIET_MODE is deprecated');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });
});
