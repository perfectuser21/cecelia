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

    it('should mark self-healing as active (BRAIN_ALWAYS_ACTIVE) — immune system always present in Brain', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'self-healing', name: '自愈与免疫', current_stage: 2, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'cecelia' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'self-healing');
      // self-healing is Brain's immune system — always present, even when not recently triggered
      expect(cap.status).toBe('active');
      expect(cap.evidence).toContain('brain_embedded:true');
      expect(cap.status).not.toBe('island');
      expect(cap.status).not.toBe('dormant');
    });

    it('should mark capability as failing when task success rate is below 30%', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'flaky-cap', name: 'Flaky Cap', current_stage: 2, related_skills: ['dev'], key_tables: [], scope: 'cecelia', owner: 'system' },
          ],
        })
        // task stats: high failure rate (2/10 completed = 20%)
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', total: 10, completed: 2, failed: 8, recent_30d: 5, last_used: new Date().toISOString() }],
        })
        .mockResolvedValueOnce({ rows: [] }) // no skill stats
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'flaky-cap');
      expect(cap.status).toBe('failing');
    });
  });

  describe('INFRA_DEPLOYED_CAPABILITIES', () => {
    it('should mark infra-deployed capabilities as active with infra_deployed evidence', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            // brain-deployment is in INFRA_DEPLOYED_CAPABILITIES
            { id: 'brain-deployment', name: 'Brain 部署流程', current_stage: 3, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'brain-deployment');
      expect(cap.status).toBe('active');
      expect(cap.evidence).toContain('infra_deployed:true');
      expect(cap.status).not.toBe('island');
    });

    it('should mark all 9 infra-deployed capabilities as active, not island', async () => {
      const pool = (await import('../db.js')).default;

      const infraCaps = [
        'brain-deployment',
        'branch-protection-hooks',
        'cecelia-dashboard',
        'ci-devgate-quality',
        'cloudflare-tunnel-routing',
        'nas-file-storage',
        'tailscale-internal-network',
        'vpn-service-management',
        'zenithjoy-dashboard',
      ];

      pool.query
        .mockResolvedValueOnce({
          rows: infraCaps.map(id => ({
            id, name: id, current_stage: 3, related_skills: [], key_tables: [], scope: 'cecelia', owner: 'system',
          })),
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      for (const id of infraCaps) {
        const cap = result.capabilities.find(c => c.id === id);
        expect(cap, `${id} should be found`).toBeDefined();
        expect(cap.status, `${id} should be active`).toBe('active');
        expect(cap.evidence, `${id} should have infra_deployed evidence`).toContain('infra_deployed:true');
      }
      expect(result.summary.island).toBe(0);
    });

    it('should mark capability with key_tables data as active (credential-management fix)', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'credential-management', name: '凭据统一管理', current_stage: 3, related_skills: ['credentials'], key_tables: ['decisions'], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }) // no embedded sources
        .mockResolvedValueOnce({ rows: [{ has_data: true }] }); // decisions table has data

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'credential-management');
      expect(cap.status).not.toBe('island');
      expect(cap.evidence).toContain('table:decisions=has_data');
    });

    it('should mark capability with key_tables data as active (multi-platform-publishing fix)', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'multi-platform-publishing', name: '多平台内容发布', current_stage: 4, related_skills: ['toutiao-publisher'], key_tables: ['content_publish_jobs'], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }) // no embedded sources
        .mockResolvedValueOnce({ rows: [{ has_data: true }] }); // content_publish_jobs table has data

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'multi-platform-publishing');
      expect(cap.status).not.toBe('island');
      expect(cap.evidence).toContain('table:content_publish_jobs=has_data');
    });
  });

  describe('BRAIN_ALWAYS_ACTIVE — embedded capabilities regression (scanner fix)', () => {
    it('should mark dev-workflow as active with brain_embedded evidence', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'dev-workflow', name: '/dev 统一开发工作流', current_stage: 3, related_skills: ['dev'], key_tables: [], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'dev-workflow');
      // dev-workflow is always active: Brain can dispatch /dev tasks at any time
      expect(cap.status).toBe('active');
      expect(cap.evidence).toContain('brain_embedded:true');
      expect(cap.status).not.toBe('island');
      expect(cap.status).not.toBe('failing');
    });

    it('should mark self-healing-immunity as active with brain_embedded evidence', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'self-healing-immunity', name: '自愈免疫系统', current_stage: 2, related_skills: ['cecelia-brain'], key_tables: ['absorption_policies', 'policy_effectiveness', 'immune_events'], scope: 'cecelia', owner: 'system' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no skills
        .mockResolvedValueOnce({ rows: [] }); // no embedded sources

      const { scanCapabilities } = await import('../capability-scanner.js');
      const result = await scanCapabilities();

      const cap = result.capabilities.find(c => c.id === 'self-healing-immunity');
      // self-healing-immunity policies always resident in Brain, not an island
      expect(cap.status).toBe('active');
      expect(cap.evidence).toContain('brain_embedded:true');
      expect(cap.status).not.toBe('island');
      expect(cap.status).not.toBe('dormant');
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
