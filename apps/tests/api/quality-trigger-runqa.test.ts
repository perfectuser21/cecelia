import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('POST /api/quality/trigger/runQA', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';

  it('should queue QA task successfully', async () => {
    const response = await fetch(`${API_BASE}/api/trigger/runQA`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priority: 'P1',
        payload: {
          project: 'cecelia-workspace',
          branch: 'develop',
          triggeredBy: 'test'
        }
      })
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.taskId).toBeDefined();
    expect(data.message).toBe('QA task queued successfully');
  });

  it('should handle missing payload gracefully', async () => {
    const response = await fetch(`${API_BASE}/api/trigger/runQA`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.taskId).toBeDefined();
  });
});
