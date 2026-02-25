import { describe, it, expect } from 'vitest';

describe('POST /api/quality/worker/restart', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';

  it('should restart worker successfully', async () => {
    const response = await fetch(`${API_BASE}/api/worker/restart`, {
      method: 'POST'
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('restarted');
    expect(data.message).toBe('Worker restarted successfully');
  });

  it('should return new PID', async () => {
    const response = await fetch(`${API_BASE}/api/worker/restart`, {
      method: 'POST'
    });

    const data = await response.json();
    expect(data.pid).toBeDefined();
  });
});
