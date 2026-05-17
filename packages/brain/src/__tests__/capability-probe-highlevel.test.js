import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockIsConsciousnessEnabled = vi.fn(() => true);
const mockGetConsciousnessStatus = vi.fn(() => ({ enabled: true, env_override: false, last_toggled_at: null }));

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));
vi.mock('../auto-fix.js', () => ({ shouldAutoFix: vi.fn(() => false), dispatchToDevSkill: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(() => 0), MAX_SEATS: 10 }));
vi.mock('../alerting.js', () => ({ sendAlert: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));
vi.mock('../monitor-loop.js', () => ({ getMonitorStatus: vi.fn(() => ({ running: true, interval_ms: 30000 })) }));
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: () => mockIsConsciousnessEnabled(),
  getConsciousnessStatus: () => mockGetConsciousnessStatus(),
  setConsciousnessEnabled: vi.fn(),
  initConsciousnessGuard: vi.fn(),
  logStartupDeclaration: vi.fn(),
  _resetCacheForTest: vi.fn(),
  _resetDeprecationWarn: vi.fn(),
  GUARDED_MODULES: [],
}));

describe('capability-probe high-level probes', () => {
  it('should include rumination, evolution, consolidation probes', async () => {
    const { PROBES } = await import('../capability-probe.js');
    const names = PROBES.map(p => p.name);
    expect(names).toContain('rumination');
    expect(names).toContain('evolution');
    expect(names).toContain('consolidation');
    expect(names).not.toContain('self_drive_health');
  });

  it('should have at least 10 probes total', async () => {
    const { PROBES } = await import('../capability-probe.js');
    expect(PROBES.length).toBeGreaterThanOrEqual(10);
  });
});
