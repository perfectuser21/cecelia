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
        // Mock embedded sources query
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
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'no-usage');
      expect(cap.status).toBe('island');
    });

    it('should mark BRAIN_ALWAYS_ACTIVE capabilities as active with brain_embedded evidence', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            // An always-active capability (in BRAIN_ALWAYS_ACTIVE set)
            { id: 'emotion-perception', name: '情绪感知', current_stage: 2, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'cecelia' },
            // Another always-active capability
            { id: 'watchdog-resource-monitor', name: '看门狗资源监控', current_stage: 3, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // embedded sources (queried before per-cap check)

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const emotionCap = result.capabilities.find(c => c.id === 'emotion-perception');
      expect(emotionCap.status).toBe('active');
      expect(emotionCap.evidence).toContain('brain_embedded:true');

      const watchdogCap = result.capabilities.find(c => c.id === 'watchdog-resource-monitor');
      expect(watchdogCap.status).toBe('active');
      expect(watchdogCap.evidence).toContain('brain_embedded:true');
    });

    it('should mark BRAIN_EMBEDDED_SOURCES capabilities as active when cecelia_events has records', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            // circuit-breaker-protection is in BRAIN_EMBEDDED_SOURCES
            { id: 'circuit-breaker-protection', name: '熔断保护系统', current_stage: 3, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        // cecelia_events: circuit_breaker source has recent activity
        .mockResolvedValueOnce({ rows: [{ source: 'circuit_breaker' }] });

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'circuit-breaker-protection');
      expect(cap.status).toBe('active');
      expect(cap.evidence).toContain('brain_embedded:true');
      expect(cap.evidence).toContain('cecelia_events:source=circuit_breaker');
    });

    it('should mark postgresql-database-service as active with brain_embedded evidence', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'postgresql-database-service', name: 'PostgreSQL 数据库服务', current_stage: 3, related_skills: [], key_tables: [], scope: 'system', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'postgresql-database-service');
      expect(cap.status).toBe('active');
      expect(cap.evidence).toContain('brain_embedded:true');
      // 不应被标记为 island（Brain 数据层始终运行）
      expect(cap.status).not.toBe('island');
    });

    it('should mark BRAIN_EMBEDDED_SOURCES capabilities as dormant (not island) when no cecelia_events records', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'self-healing', name: '自愈与免疫', current_stage: 2, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'cecelia' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        // cecelia_events: no 'healing' source found
        .mockResolvedValueOnce({ rows: [] });

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'self-healing');
      expect(cap.status).toBe('dormant');
      expect(cap.evidence).toContain('brain_embedded:true');
      expect(cap.evidence).toContain('cecelia_events:no_recent_activity');
      expect(cap.status).not.toBe('island');
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
