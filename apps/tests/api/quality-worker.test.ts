import { describe, it, expect } from 'vitest';

describe('Quality API - Worker', () => {
  it('should return worker status', async () => {
    const res = await fetch('http://localhost:5220/api/worker');
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('status');
    expect(['idle', 'running']).toContain(data.status);
  });

  it('should have required worker state fields', async () => {
    const res = await fetch('http://localhost:5220/api/worker');
    const data = await res.json();
    expect(data).toHaveProperty('currentTask');
    expect(data).toHaveProperty('uptime');
    expect(data).toHaveProperty('lastCrash');
  });
});
