import { describe, it, expect } from 'vitest';

describe('POST /api/quality/trigger/syncNotion', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';

  it('should queue Notion sync task successfully', async () => {
    const response = await fetch(`${API_BASE}/api/trigger/syncNotion`, {
      method: 'POST'
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.taskId).toBeDefined();
    expect(data.message).toBe('Notion sync task queued');
  });
});
