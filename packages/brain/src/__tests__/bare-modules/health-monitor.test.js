/**
 * Bare Module Test: health-monitor.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('health-monitor module', () => {
  it('can be imported', async () => {
    const mod = await import('../../health-monitor.js');
    expect(mod).toBeDefined();
  });

  it('exports runLayer2HealthCheck function', async () => {
    const { runLayer2HealthCheck } = await import('../../health-monitor.js');
    expect(typeof runLayer2HealthCheck).toBe('function');
  });

  it('exports calculateHealthLevel function', async () => {
    const { calculateHealthLevel } = await import('../../health-monitor.js');
    expect(typeof calculateHealthLevel).toBe('function');
  });

  it('exports recordHealthEvent function', async () => {
    const { recordHealthEvent } = await import('../../health-monitor.js');
    expect(typeof recordHealthEvent).toBe('function');
  });
});
