import { describe, it, expect } from 'vitest';

describe('Quality API - Logs', () => {
  it('should return 404 for non-existent file', async () => {
    const res = await fetch('http://localhost:5220/api/runs/nonexistent/logs/test.log');
    expect(res.status).toBe(404);
  });

  it('should return file content as text for valid file', async () => {
    // First get a valid runId and file
    const runsRes = await fetch('http://localhost:5220/api/runs?limit=1');
    const runs = await runsRes.json();

    if (runs.length > 0) {
      const runId = runs[0].runId;
      const evidenceRes = await fetch(`http://localhost:5220/api/runs/${runId}/evidence`);
      const files = await evidenceRes.json();

      if (files.length > 0) {
        const res = await fetch(`http://localhost:5220/api/runs/${runId}/logs/${files[0]}`);
        expect(res.ok).toBe(true);
        expect(res.headers.get('content-type')).toContain('text/plain');
      }
    }
  });
});
