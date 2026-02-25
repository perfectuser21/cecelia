import { describe, it, expect } from 'vitest';

describe('Quality API - Queue', () => {
  it('should return queue data', async () => {
    const res = await fetch('http://localhost:5220/api/queue');
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('should include task age in queue items', async () => {
    const res = await fetch('http://localhost:5220/api/queue');
    const data = await res.json();
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('age');
      expect(typeof data[0].age).toBe('number');
    }
  });
});
