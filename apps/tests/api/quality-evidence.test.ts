import { describe, it, expect } from 'vitest';

describe('Quality API - Evidence', () => {
  it('should return 404 for non-existent run', async () => {
    const res = await fetch('http://localhost:5220/api/runs/nonexistent/evidence');
    expect(res.status).toBe(404);
  });

  it('should return evidence files array for valid run', async () => {
    // First get a valid runId
    const runsRes = await fetch('http://localhost:5220/api/runs?limit=1');
    const runs = await runsRes.json();

    if (runs.length > 0) {
      const runId = runs[0].runId;
      const res = await fetch(`http://localhost:5220/api/runs/${runId}/evidence`);
      expect(res.ok).toBe(true);
      const files = await res.json();
      expect(Array.isArray(files)).toBe(true);
    }
  });
});
