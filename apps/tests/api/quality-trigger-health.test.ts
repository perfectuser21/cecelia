import { describe, it, expect } from 'vitest';

describe('POST /api/quality/trigger/healthCheck', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';

  it('should return health check data', async () => {
    const response = await fetch(`${API_BASE}/api/trigger/healthCheck`, {
      method: 'POST'
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.worker).toBeDefined();
    expect(data.queue).toBeDefined();
    expect(data.heartbeat).toBeDefined();
    expect(data.disk).toBeDefined();
    expect(data.memory).toBeDefined();
  });

  it('should include worker status', async () => {
    const response = await fetch(`${API_BASE}/api/trigger/healthCheck`, {
      method: 'POST'
    });

    const data = await response.json();
    expect(data.worker.status).toBeDefined();
    expect(['idle', 'busy', 'unknown']).toContain(data.worker.status);
  });
});
