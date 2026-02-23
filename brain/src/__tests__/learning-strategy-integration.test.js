/**
 * Learning to Strategy Integration Tests
 *
 * 验收标准：
 * 1. 当新 Learning 达到质量阈值时自动触发 Strategy 更新
 * 2. Thalamus 决策时能获取到最新的 Strategy
 * 3. 集成测试覆盖完整流程
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================
// Mock Setup
// ============================================

// Mock pool
const mockQuery = vi.fn();
const mockClient = {
  query: mockQuery,
  release: vi.fn(),
};
const mockPool = {
  query: mockQuery,
  connect: vi.fn(() => mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock strategy.js
vi.mock('../strategy.js', () => ({
  convertFromLearning: vi.fn((learning) => {
    if (!learning || !learning.id || !learning.content) {
      return null;
    }
    const metadata = learning.metadata || {};
    const confidence = metadata.confidence || 0;
    if (confidence < 0.7) {
      return null;
    }
    return {
      name: `Strategy: ${learning.title}`,
      description: 'Test strategy description',
      conditions: [{ type: 'test' }],
      actions: [{ type: 'test' }],
      version: '1.0.0',
      created_from_learning_id: learning.id,
      created_at: new Date().toISOString(),
      metadata: { confidence },
    };
  }),
  validateStrategy: vi.fn((strategy) => {
    if (!strategy) return { valid: false, errors: ['Strategy is null'] };
    const errors = [];
    if (!strategy.name) errors.push('name required');
    if (!strategy.description) errors.push('description required');
    if (!Array.isArray(strategy.conditions)) errors.push('conditions must be array');
    if (!Array.isArray(strategy.actions)) errors.push('actions must be array');
    return { valid: errors.length === 0, errors };
  }),
  QUALITY_THRESHOLDS: {
    min_confidence: 0.7,
    min_effectiveness_score: 20,
  },
}));

// Import after mocks
const {
  triggerLearningToStrategy,
  getTriggerStatus,
  getTriggerConfig,
  checkTriggerConditions,
  getConversionStats,
  getConversionHistory,
  getConversionDiagnostics,
  DEFAULT_TRIGGER_INTERVAL_MS,
  DEFAULT_CONFIG,
} = await import('../triggers/learning-strategy-trigger.js');

describe('Learning-Strategy Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // 验收标准 1: 当新 Learning 达到质量阈值时自动触发 Strategy 更新
  // ============================================

  describe('自动触发转换 - 质量阈值触发', () => {
    it('should convert learning when quality threshold met', async () => {
      // Setup: mock database to return candidate learnings with high quality
      const now = new Date();
      const mockLearnings = [
        {
          id: 'learning-001',
          title: 'High Quality Learning',
          content: JSON.stringify({ root_cause: 'Test cause', learnings: ['Learn 1'] }),
          metadata: { confidence: 0.85 },
          quality_score: 0.85,
          trigger_event: 'test_event',
          created_at: new Date(now.getTime() - 10 * 60 * 1000), // 10 min ago
          applied: true,
        },
      ];

      mockQuery
        // First call: getTriggerConfig
        .mockResolvedValueOnce({
          rows: [
            { key: 'learning.trigger.enabled', value: 'true' },
            { key: 'learning.trigger.time_window_minutes', value: '60' },
            { key: 'learning.trigger.quality_threshold', value: '0.7' },
          ],
        })
        // Second call: getCandidateLearnings
        .mockResolvedValueOnce({ rows: mockLearnings })
        // Third call: getTriggerEventFrequency
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })
        // Fourth call: saveStrategy
        .mockResolvedValueOnce({ rows: [{ id: 'strategy-001' }] })
        // Fifth call: markLearningTriggered
        .mockResolvedValueOnce({ rows: [] });

      const result = await triggerLearningToStrategy({
        intervalMs: 0,
        lastTriggerTime: 0,
      });

      expect(result.skipped).toBe(false);
      expect(result.converted).toHaveLength(1);
      expect(result.converted[0].learning_id).toBe('learning-001');
      expect(result.converted[0].strategy_id).toBe('strategy-001');
    });

    it('should skip learning when quality below threshold', async () => {
      // Setup: mock database to return learnings with low quality
      const mockLearnings = [
        {
          id: 'learning-002',
          title: 'Low Quality Learning',
          content: JSON.stringify({ root_cause: 'Test cause' }),
          metadata: { confidence: 0.5 }, // Below threshold 0.7
          quality_score: 0.5,
          created_at: new Date(),
          applied: true,
        },
      ];

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { key: 'learning.trigger.enabled', value: 'true' },
            { key: 'learning.trigger.time_window_minutes', value: '60' },
            { key: 'learning.trigger.quality_threshold', value: '0.7' },
          ],
        })
        .mockResolvedValueOnce({ rows: mockLearnings });

      const result = await triggerLearningToStrategy({
        intervalMs: 0,
        lastTriggerTime: 0,
      });

      // Should skip because quality below threshold
      expect(result.converted).toHaveLength(0);
      expect(result.summary).toContain('No learnings met trigger conditions');
    });

    it('should respect time window configuration', async () => {
      // Setup: mock database to return learnings within time window
      const now = new Date();
      const mockLearnings = [
        {
          id: 'learning-003',
          title: 'Recent Learning',
          content: JSON.stringify({ root_cause: 'Test' }),
          metadata: { confidence: 0.9 },
          created_at: new Date(now.getTime() - 30 * 60 * 1000), // 30 min ago
          applied: true,
        },
      ];

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { key: 'learning.trigger.enabled', value: 'true' },
            { key: 'learning.trigger.time_window_minutes', value: '60' },
            { key: 'learning.trigger.quality_threshold', value: '0.7' },
          ],
        })
        .mockResolvedValueOnce({ rows: mockLearnings });

      const result = await triggerLearningToStrategy({
        intervalMs: 0,
        lastTriggerTime: 0,
      });

      expect(result.skipped).toBe(false);
    });

    it('should skip when trigger is disabled', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { key: 'learning.trigger.enabled', value: 'false' },
        ],
      });

      const result = await triggerLearningToStrategy({
        intervalMs: 0,
        lastTriggerTime: 0,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Trigger disabled');
    });

    it('should skip when interval not elapsed', async () => {
      const now = Date.now();
      const result = await triggerLearningToStrategy({
        intervalMs: DEFAULT_TRIGGER_INTERVAL_MS,
        lastTriggerTime: now - 1000, // Only 1 second ago
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('Not time yet');
    });
  });

  // ============================================
  // 验收标准 2: Thalamus 决策时能获取到最新的 Strategy
  // ============================================

  describe('Strategy 获取 - Thalamus 集成', () => {
    it('should get trigger status with recent strategies', async () => {
      const mockStrategies = [
        {
          id: 'strategy-001',
          name: 'Test Strategy 1',
          description: 'Description 1',
          conditions: [],
          actions: [],
          version: '1.0.0',
          created_from_learning_id: 'learning-001',
          created_at: new Date(),
          learning_title: 'Learning 1',
        },
      ];

      const mockStats = {
        rows: [{ total_strategies: '10', unique_learnings: '8' }],
      };

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { key: 'learning.trigger.enabled', value: 'true' },
          ],
        })
        .mockResolvedValueOnce({ rows: mockStrategies })
        .mockResolvedValueOnce(mockStats);

      const status = await getTriggerStatus();

      expect(status.config.enabled).toBe(true);
      expect(status.recent_strategies).toHaveLength(1);
      expect(status.stats.total_strategies).toBe('10');
    });

    it('should get conversion statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_conversions: '5', unique_learnings: '4' }] })
        .mockResolvedValueOnce({ rows: [{ total: '10', triggered: '8', not_triggered: '2' }] })
        .mockResolvedValueOnce({ rows: [{ avg_duration_ms: '3000' }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const stats = await getConversionStats();

      expect(stats.total_conversions).toBe(5);
      expect(stats.unique_learnings).toBe(4);
      expect(stats.success_count).toBe(8);
      expect(stats.failure_count).toBe(2);
      expect(stats.success_rate).toBe(80);
      expect(stats.avg_duration_ms).toBe(3000);
      expect(stats.last_24h_conversions).toBe(2);
      expect(stats.last_7d_conversions).toBe(5);
    });

    it('should get conversion history', async () => {
      const mockHistory = [
        {
          learning_id: 'learning-001',
          learning_title: 'Test Learning',
          trigger_event: 'test_event',
          quality_score: 0.85,
          triggered_at: new Date(),
          strategy_id: 'strategy-001',
          strategy_name: 'Test Strategy',
          version: '1.0.0',
          strategy_created_at: new Date(),
          duration_ms: 5000,
          status: 'success',
        },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockHistory })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const history = await getConversionHistory({ limit: 20, offset: 0 });

      expect(history.records).toHaveLength(1);
      expect(history.records[0].learning_id).toBe('learning-001');
      expect(history.records[0].strategy_id).toBe('strategy-001');
      expect(history.records[0].status).toBe('success');
    });
  });

  // ============================================
  // 验收标准 3: 集成测试覆盖完整流程
  // ============================================

  describe('完整流程集成测试', () => {
    it('should complete full flow: learning -> trigger -> strategy', async () => {
      // Step 1: Create high-quality learning
      const now = new Date();
      const learning = {
        id: 'learning-integration-001',
        title: 'Integration Test Learning',
        content: JSON.stringify({
          root_cause: 'Integration test cause',
          learnings: ['Test learning 1', 'Test learning 2'],
          contributing_factors: ['factor1', 'factor2'],
        }),
        metadata: { confidence: 0.95 },
        quality_score: 0.95,
        trigger_event: 'integration_test',
        category: 'test_category',
        applied: true,
        created_at: now,
      };

      // Step 2: Check trigger conditions
      const freqInfo = { count: 5, event: 'integration_test' };
      const config = {
        time_window_minutes: 60,
        frequency_threshold: 3,
        quality_threshold: 0.7,
        require_all_conditions: false,
      };

      const conditions = checkTriggerConditions(learning, config, freqInfo);
      expect(conditions.shouldTrigger).toBe(true);
      expect(conditions.reasons).toContain('quality threshold met');

      // Step 3: Simulate conversion
      const { convertFromLearning } = await import('../strategy.js');
      const strategy = convertFromLearning(learning);

      expect(strategy).not.toBeNull();
      expect(strategy.created_from_learning_id).toBe(learning.id);
      expect(strategy.name).toBe('Strategy: Integration Test Learning');

      // Step 4: Validate strategy
      const { validateStrategy } = await import('../strategy.js');
      const validation = validateStrategy(strategy);
      expect(validation.valid).toBe(true);

      // Step 5: Save strategy (mock)
      const strategyId = 'strategy-integration-001';
      mockQuery.mockResolvedValueOnce({ rows: [{ id: strategyId }] });

      // Step 6: Mark learning as triggered (mock)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Step 7: Verify trigger status
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ key: 'learning.trigger.enabled', value: 'true' }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: strategyId,
              name: strategy.name,
              description: strategy.description,
              conditions: strategy.conditions,
              actions: strategy.actions,
              version: strategy.version,
              created_from_learning_id: learning.id,
              created_at: new Date(),
              learning_title: learning.title,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total_strategies: '1', unique_learnings: '1' }] });

      const status = await getTriggerStatus();
      expect(status.recent_strategies).toHaveLength(1);
      expect(status.recent_strategies[0].name).toBe(strategy.name);
    });

    it('should handle multiple learnings in batch', async () => {
      const learnings = [
        {
          id: 'batch-001',
          title: 'Batch Learning 1',
          content: JSON.stringify({ root_cause: 'Cause 1' }),
          metadata: { confidence: 0.9 },
          trigger_event: 'batch_event',
          created_at: new Date(),
          applied: true,
        },
        {
          id: 'batch-002',
          title: 'Batch Learning 2',
          content: JSON.stringify({ root_cause: 'Cause 2' }),
          metadata: { confidence: 0.85 },
          trigger_event: 'batch_event',
          created_at: new Date(),
          applied: true,
        },
        {
          id: 'batch-003',
          title: 'Batch Learning 3 - Low Quality',
          content: JSON.stringify({ root_cause: 'Cause 3' }),
          metadata: { confidence: 0.5 }, // Below threshold
          trigger_event: 'batch_event',
          created_at: new Date(),
          applied: true,
        },
      ];

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { key: 'learning.trigger.enabled', value: 'true' },
            { key: 'learning.trigger.time_window_minutes', value: '60' },
            { key: 'learning.trigger.quality_threshold', value: '0.7' },
          ],
        })
        .mockResolvedValueOnce({ rows: learnings })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'strat-001' }] }) // First conversion
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'strat-002' }] }) // Second conversion
        .mockResolvedValueOnce({ rows: [] });

      const result = await triggerLearningToStrategy({
        intervalMs: 0,
        lastTriggerTime: 0,
      });

      expect(result.converted).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should get conversion diagnostics', async () => {
      const mockFailed = [
        {
          learning_id: 'failed-001',
          learning_title: 'Failed Learning',
          trigger_event: 'test',
          quality_score: 0.5,
          created_at: new Date(),
          applied: true,
          triggered_at: null,
          learning_metadata: { confidence: 0.5 },
        },
      ];

      const mockPending = [
        {
          learning_id: 'pending-001',
          learning_title: 'Pending Learning',
          trigger_event: 'test',
          quality_score: 0.8,
          created_at: new Date(),
          confidence: 0.8,
        },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockFailed })
        .mockResolvedValueOnce({ rows: mockPending })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { key: 'learning.trigger.enabled', value: 'true' },
            { key: 'learning.trigger.quality_threshold', value: '0.7' },
          ],
        });

      const diagnostics = await getConversionDiagnostics();

      expect(diagnostics.failed_conversions).toHaveLength(1);
      expect(diagnostics.pending_learnings).toHaveLength(1);
      expect(diagnostics.trigger_config.quality_threshold).toBe(0.7);
    });
  });

  // ============================================
  // 边界情况和错误处理
  // ============================================

  describe('边界情况和错误处理', () => {
    it('should handle database errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await triggerLearningToStrategy({
        intervalMs: 0,
        lastTriggerTime: 0,
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Database connection failed');
    });

    it('should skip already converted learnings', async () => {
      const mockLearnings = [
        {
          id: 'already-converted',
          title: 'Already Converted',
          content: JSON.stringify({ root_cause: 'Test' }),
          metadata: { confidence: 0.9 },
          created_at: new Date(),
          applied: true,
        },
      ];

      // First query returns learnings, but SQL already filters out converted ones
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { key: 'learning.trigger.enabled', value: 'true' },
            { key: 'learning.trigger.time_window_minutes', value: '60' },
            { key: 'learning.trigger.quality_threshold', value: '0.7' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // No candidate learnings (all converted)

      const result = await triggerLearningToStrategy({
        intervalMs: 0,
        lastTriggerTime: 0,
      });

      expect(result.converted).toHaveLength(0);
      expect(result.reason).toContain('No candidate learnings');
    });

    it('should validate config loading with defaults', async () => {
      // No config rows returned, should use defaults
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const config = await getTriggerConfig();

      expect(config.enabled).toBe(DEFAULT_CONFIG.enabled);
      expect(config.time_window_minutes).toBe(DEFAULT_CONFIG.time_window_minutes);
      expect(config.quality_threshold).toBe(DEFAULT_CONFIG.quality_threshold);
    });

    it('should handle missing trigger_event for frequency check', async () => {
      const learning = {
        id: 'no-trigger-event',
        title: 'No Trigger Event',
        content: JSON.stringify({ root_cause: 'Test' }),
        metadata: { confidence: 0.9 },
        trigger_event: null,
        created_at: new Date(),
        applied: true,
      };

      const freqInfo = { count: 0, event: null };
      const config = {
        time_window_minutes: 60,
        frequency_threshold: 3,
        quality_threshold: 0.7,
        require_all_conditions: false,
      };

      const conditions = checkTriggerConditions(learning, config, freqInfo);

      // Should still trigger if quality is met (frequency check skipped when no trigger_event)
      expect(conditions.shouldTrigger).toBe(true);
    });
  });
});
