import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isConsciousnessEnabled, logStartupDeclaration, GUARDED_MODULES, _resetDeprecationWarn,
  checkConsciousnessHeartbeat, _resetHeartbeatCheckForTest, _resetCacheForTest,
} from '../consciousness-guard.js';

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

  describe('memory-level toggle (Phase 2)', () => {
    let mockPool;

    beforeEach(() => {
      mockPool = { query: vi.fn() };
      delete process.env.CONSCIOUSNESS_ENABLED;
      delete process.env.BRAIN_QUIET_MODE;
    });

    test('initConsciousnessGuard loads value from working_memory', async () => {
      const { initConsciousnessGuard, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
      _resetCacheForTest();
      mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { enabled: false, last_toggled_at: '2026-04-20T00:00:00Z' } }] });
      await initConsciousnessGuard(mockPool);
      expect(isConsciousnessEnabled()).toBe(false);
    });

    test('memory=true (default) returns true', async () => {
      const { initConsciousnessGuard, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
      _resetCacheForTest();
      mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { enabled: true, last_toggled_at: null } }] });
      await initConsciousnessGuard(mockPool);
      expect(isConsciousnessEnabled()).toBe(true);
    });

    test('env=false overrides memory=true (escape hatch)', async () => {
      const { initConsciousnessGuard, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
      _resetCacheForTest();
      mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { enabled: true, last_toggled_at: null } }] });
      await initConsciousnessGuard(mockPool);
      process.env.CONSCIOUSNESS_ENABLED = 'false';
      expect(isConsciousnessEnabled()).toBe(false);
    });

    test('setConsciousnessEnabled writes DB and updates cache', async () => {
      const { initConsciousnessGuard, setConsciousnessEnabled, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
      _resetCacheForTest();
      mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { enabled: true, last_toggled_at: null } }] });
      await initConsciousnessGuard(mockPool);
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const status = await setConsciousnessEnabled(mockPool, false);
      expect(status.enabled).toBe(false);
      expect(status.last_toggled_at).toBeTruthy();
      expect(isConsciousnessEnabled()).toBe(false);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    test('getConsciousnessStatus includes env_override flag', async () => {
      const { getConsciousnessStatus, _resetCacheForTest } = await import('../consciousness-guard.js');
      _resetCacheForTest();
      expect(getConsciousnessStatus().env_override).toBe(false);
      process.env.CONSCIOUSNESS_ENABLED = 'false';
      expect(getConsciousnessStatus().env_override).toBe(true);
      delete process.env.CONSCIOUSNESS_ENABLED;
      process.env.BRAIN_QUIET_MODE = 'true';
      expect(getConsciousnessStatus().env_override).toBe(true);
    });

    test('reloadConsciousnessCache picks up external DB changes', async () => {
      const { initConsciousnessGuard, reloadConsciousnessCache, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
      _resetCacheForTest();
      mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { enabled: true, last_toggled_at: null } }] });
      await initConsciousnessGuard(mockPool);
      expect(isConsciousnessEnabled()).toBe(true);
      mockPool.query.mockResolvedValueOnce({ rows: [{ value_json: { enabled: false, last_toggled_at: '2026-04-20T01:00:00Z' } }] });
      await reloadConsciousnessCache(mockPool);
      expect(isConsciousnessEnabled()).toBe(false);
    });
  });

  describe('checkConsciousnessHeartbeat (Phase 3 — RCA#3)', () => {
    let mockPool;
    let mockAlerting;

    beforeEach(() => {
      _resetHeartbeatCheckForTest();
      _resetCacheForTest(); // 防 Phase 2 的 _cached 状态污染（setConsciousnessEnabled → enabled=false）
      delete process.env.CONSCIOUSNESS_ENABLED;
      delete process.env.BRAIN_QUIET_MODE;
      delete process.env.BRAIN_MINIMAL_MODE;
      mockPool = { query: vi.fn() };
      mockAlerting = { raise: vi.fn().mockResolvedValue(undefined) };
    });

    test('skips check when throttled (called twice within 1 hour)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '5' }] });
      const first = await checkConsciousnessHeartbeat(mockPool, mockAlerting);
      expect(first.checked).toBe(true);
      const second = await checkConsciousnessHeartbeat(mockPool, mockAlerting);
      expect(second.checked).toBe(false);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    test('returns heartbeats_24h count when rumination is healthy', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '12' }] });
      const result = await checkConsciousnessHeartbeat(mockPool, mockAlerting);
      expect(result.checked).toBe(true);
      expect(result.heartbeats_24h).toBe(12);
      expect(result.alerted).toBe(false);
      expect(result.healed).toBe(false);
      expect(mockAlerting.raise).not.toHaveBeenCalled();
    });

    test('skips when consciousness is disabled (CONSCIOUSNESS_ENABLED=false)', async () => {
      process.env.CONSCIOUSNESS_ENABLED = 'false';
      const result = await checkConsciousnessHeartbeat(mockPool, mockAlerting);
      expect(result.checked).toBe(true);
      expect(result.heartbeats_24h).toBe(-1);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    test('raises P2 alert when heartbeats_24h=0', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
      const result = await checkConsciousnessHeartbeat(mockPool, mockAlerting);
      expect(result.checked).toBe(true);
      expect(result.heartbeats_24h).toBe(0);
      expect(result.alerted).toBe(true);
      expect(mockAlerting.raise).toHaveBeenCalledWith(
        'P2',
        'consciousness_heartbeat_dead',
        expect.stringContaining('heartbeats_24h=0')
      );
    });

    test('self-heals by calling runRumination when heartbeats_24h=0 and no env override', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
      const mockRumination = { runRumination: vi.fn().mockResolvedValue({ digested: 3 }) };
      const result = await checkConsciousnessHeartbeat(mockPool, mockAlerting, mockRumination);
      expect(result.healed).toBe(true);
      expect(mockRumination.runRumination).toHaveBeenCalledWith(mockPool);
    });

    test('does not self-heal when BRAIN_MINIMAL_MODE=true', async () => {
      process.env.BRAIN_MINIMAL_MODE = 'true';
      mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
      const mockRumination = { runRumination: vi.fn() };
      const result = await checkConsciousnessHeartbeat(mockPool, mockAlerting, mockRumination);
      expect(result.healed).toBe(false);
      expect(mockRumination.runRumination).not.toHaveBeenCalled();
    });

    test('skips self-heal when consciousness disabled by BRAIN_QUIET_MODE (env_override path)', async () => {
      // BRAIN_QUIET_MODE=true → consciousness disabled → early return (heartbeats_24h=-1)
      // 即使有 heartbeats=0 也不会自愈，因为 isConsciousnessEnabled() 返回 false 时直接跳过
      process.env.BRAIN_QUIET_MODE = 'true';
      const mockRumination = { runRumination: vi.fn() };
      const result = await checkConsciousnessHeartbeat(mockPool, mockAlerting, mockRumination);
      expect(result.checked).toBe(true);
      expect(result.heartbeats_24h).toBe(-1);
      expect(result.alerted).toBe(false);
      expect(result.healed).toBe(false);
      expect(mockPool.query).not.toHaveBeenCalled(); // 不查 DB
      expect(mockRumination.runRumination).not.toHaveBeenCalled();
    });

    test('handles DB query failure gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await checkConsciousnessHeartbeat(mockPool, mockAlerting);
      expect(result.checked).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('heartbeat query failed'), expect.any(String));
      warnSpy.mockRestore();
    });
  });
});
