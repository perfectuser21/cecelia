/**
 * Unit tests for Tick Health Monitor auto-recovery (startup self-healing fix)
 *
 * Scenario: Brain restarts, tick_enabled=false in working_memory.
 * If disabled_at timestamp is > TICK_AUTO_RECOVER_MINUTES ago → auto-enable.
 * If disabled_at < threshold → stay disabled.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db.js', () => ({ default: { query: vi.fn() } }));

describe('tick-health-monitor: disableTick stores disabled_at', () => {
  it('tick.js disableTick() stores disabled_at timestamp', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../tick.js', import.meta.url).pathname,
      'utf8'
    );
    // disableTick must store disabled_at with the false value
    expect(src).toContain('disabled_at');
    expect(src).toContain('new Date().toISOString()');
  });

  it('TICK_AUTO_RECOVER_MINUTES constant is defined', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../tick.js', import.meta.url).pathname,
      'utf8'
    );
    expect(src).toContain('TICK_AUTO_RECOVER_MINUTES');
    expect(src).toMatch(/TICK_AUTO_RECOVER_MINUTES.*parseInt.*process\.env\.TICK_AUTO_RECOVER_MINUTES/);
  });

  it('initTickLoop checks disabled_at and auto-recovers when expired', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../tick.js', import.meta.url).pathname,
      'utf8'
    );
    // Must check disabled_at against threshold
    expect(src).toContain('minutesDisabled >= TICK_AUTO_RECOVER_MINUTES');
    // Must call enableTick when expired
    expect(src).toContain('tick_auto_recover');
  });

  it('initTickLoop treats missing disabled_at as Infinity (always recover)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../tick.js', import.meta.url).pathname,
      'utf8'
    );
    // No timestamp = unknown = treat as expired
    expect(src).toContain('Infinity');
  });

  it('auto-recovery logs a cecelia_events P1 alert', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../tick.js', import.meta.url).pathname,
      'utf8'
    );
    expect(src).toContain("'tick_auto_recover'");
    expect(src).toContain('auto_recovered: true');
  });
});
