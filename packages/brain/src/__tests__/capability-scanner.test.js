import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

describe('capability-scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scanCapabilities', () => {
    it('should return capabilities health map with summary', async () => {
      const pool = (await import('../db.js')).default;

      // Mock capabilities query
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'test-cap', name: 'Test Cap', current_stage: 3, related_skills: ['dev'], key_tables: ['tasks'], scope: 'cecelia', owner: 'system' },
            { id: 'island-cap', name: 'Island Cap', current_stage: 1, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'system' },
          ],
        })
        // Mock task stats
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', total: 10, completed: 8, failed: 2, recent_30d: 5, last_used: new Date().toISOString() }],
        })
        // Mock skill stats
        .mockResolvedValueOnce({ rows: [] })
        // Mock table exists check for 'tasks'
        .mockResolvedValueOnce({ rows: [{ has_data: true }] });

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      expect(result).toHaveProperty('capabilities');
      expect(result).toHaveProperty('summary');
      expect(result.capabilities).toBeInstanceOf(Array);
      expect(result.summary.total).toBe(2);
    });

    it('should mark capabilities with no usage as island', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'no-usage', name: 'Unused', current_stage: 1, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }); // no skills

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'no-usage');
      expect(cap.status).toBe('island');
    });
  });

  describe('getCapabilityHealth', () => {
    it('should query cecelia_events for capability_scan events', async () => {
      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValueOnce({
        rows: [{ payload: { summary: { total: 5 } }, created_at: new Date().toISOString() }],
      });

      const { getCapabilityHealth } = await import('../capability-scanner.js');
      const results = await getCapabilityHealth(1);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('capability_scan'),
        [1]
      );
      expect(results).toHaveLength(1);
    });
  });

  describe('getScannerStatus', () => {
    it('should return scanner status', async () => {
      const { getScannerStatus } = await import('../capability-scanner.js');
      const status = getScannerStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('interval_ms');
      expect(status).toHaveProperty('island_threshold_days');
    });
  });
});
