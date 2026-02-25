import { describe, it, expect } from 'vitest';

describe('DELETE /api/quality/queue/clear', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';

  it('should clear queue successfully', async () => {
    const response = await fetch(`${API_BASE}/api/queue/clear`, {
      method: 'DELETE'
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.cleared).toBeDefined();
    expect(data.message).toBeDefined();
  });

  it('should handle empty queue', async () => {
    const response = await fetch(`${API_BASE}/api/queue/clear`, {
      method: 'DELETE'
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toContain('Queue');
  });
});
