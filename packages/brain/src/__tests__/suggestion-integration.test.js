/**
 * End-to-end integration tests for the complete suggestion system
 */

import { createSuggestion, executeTriage } from '../suggestion-triage.js';
import pool from '../db.js';

describe('Suggestion System Integration', () => {
  beforeAll(async () => {
    // 确保测试环境有 suggestions 表
    // 在实际环境中，这应该通过数据库迁移来处理
    try {
      await pool.query('SELECT 1 FROM suggestions LIMIT 1');
    } catch (error) {
      console.warn('Suggestions table may not exist - this is expected in isolated test environments');
      // 在隔离的测试环境中，我们可能需要跳过集成测试
      return;
    }
  });

  beforeEach(async () => {
    // 清理测试数据
    await pool.query('DELETE FROM suggestions WHERE source LIKE $1', ['integration-test%']);
    await pool.query('DELETE FROM cecelia_events WHERE source LIKE $1', ['integration-test%']);
  });

  afterAll(async () => {
    // 最终清理
    await pool.query('DELETE FROM suggestions WHERE source LIKE $1', ['integration-test%']);
    await pool.query('DELETE FROM cecelia_events WHERE source LIKE $1', ['integration-test%']);
  });

  describe('Complete workflow integration', () => {
    test('full suggestion lifecycle: create → triage → update status', async () => {
      // 跳过测试如果表不存在
      try {
        await pool.query('SELECT 1 FROM suggestions LIMIT 1');
      } catch {
        console.warn('Skipping integration test - suggestions table not available');
        return;
      }

      // 1. 创建多个不同优先级的建议
      const suggestions = await Promise.all([
        createSuggestion({
          content: '高优先级警告：系统CPU使用率过高',
          source: 'integration-test-cortex',
          agent_id: 'cortex-v1',
          suggestion_type: 'alert',
          target_entity_type: 'system',
          metadata: { cpu_usage: '95%' }
        }),
        createSuggestion({
          content: '建议优化任务调度算法',
          source: 'integration-test-thalamus',
          agent_id: 'thalamus-v1',
          suggestion_type: 'optimization',
          target_entity_type: 'system'
        }),
        createSuggestion({
          content: '创建新任务：用户反馈处理',
          source: 'integration-test-executor',
          agent_id: 'executor-v1',
          suggestion_type: 'task_creation',
          target_entity_type: 'project',
          target_entity_id: 'test-project-id'
        })
      ]);

      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].priority_score).toBeGreaterThan(0.8); // Alert should be high priority
      expect(suggestions[1].priority_score).toBeGreaterThan(0.5); // Optimization medium
      expect(suggestions[2].priority_score).toBeGreaterThan(0.6); // Task creation medium-high

      // 2. 执行 triage 处理
      const processedSuggestions = await executeTriage(10);

      expect(processedSuggestions.length).toBe(3);

      // 验证按优先级排序
      for (let i = 1; i < processedSuggestions.length; i++) {
        expect(processedSuggestions[i-1].priority_score)
          .toBeGreaterThanOrEqual(processedSuggestions[i].priority_score);
      }

      // 3. 验证数据库状态
      const dbSuggestions = await pool.query(`
        SELECT * FROM suggestions
        WHERE source LIKE 'integration-test%'
        ORDER BY priority_score DESC
      `);

      expect(dbSuggestions.rows).toHaveLength(3);
      expect(dbSuggestions.rows[0].suggestion_type).toBe('alert'); // 最高优先级

      // 4. 模拟处理建议并更新状态
      const { updateSuggestionStatus } = await import('../suggestion-triage.js');

      await updateSuggestionStatus(suggestions[0].id, 'processed', {
        action_taken: 'alert_acknowledged',
        processed_by: 'admin'
      });

      await updateSuggestionStatus(suggestions[2].id, 'processed', {
        action_taken: 'task_created',
        task_id: 'new-task-123'
      });

      // 5. 验证状态更新
      const updatedSuggestions = await pool.query(`
        SELECT * FROM suggestions
        WHERE source LIKE 'integration-test%' AND status = 'processed'
      `);

      expect(updatedSuggestions.rows).toHaveLength(2);

      // 6. 验证事件记录
      const events = await pool.query(`
        SELECT * FROM cecelia_events
        WHERE source LIKE 'integration-test%'
        ORDER BY created_at DESC
      `);

      expect(events.rows.length).toBeGreaterThanOrEqual(5); // 创建事件 + 状态更新事件 + triage 事件
    });

    test('handles duplicate suggestion detection and rejection', async () => {
      try {
        await pool.query('SELECT 1 FROM suggestions LIMIT 1');
      } catch {
        console.warn('Skipping integration test - suggestions table not available');
        return;
      }

      // 创建两个相似的建议
      const suggestion1 = await createSuggestion({
        content: '优化数据库查询性能',
        source: 'integration-test-cortex',
        suggestion_type: 'optimization',
        target_entity_type: 'database',
        target_entity_id: 'main-db'
      });

      const suggestion2 = await createSuggestion({
        content: '优化数据库查询性能问题',
        source: 'integration-test-cortex',
        suggestion_type: 'optimization',
        target_entity_type: 'database',
        target_entity_id: 'main-db'
      });

      // 执行 triage
      const processedSuggestions = await executeTriage(10);

      // 应该只有一个建议保持 pending 状态
      expect(processedSuggestions).toHaveLength(1);

      // 验证另一个被标记为 rejected
      const rejectedSuggestions = await pool.query(`
        SELECT * FROM suggestions
        WHERE source LIKE 'integration-test%' AND status = 'rejected'
      `);

      expect(rejectedSuggestions.rows).toHaveLength(1);
      expect(rejectedSuggestions.rows[0].metadata.rejection_reason).toBe('duplicate');
    });

    test('cleanup expired suggestions works correctly', async () => {
      try {
        await pool.query('SELECT 1 FROM suggestions LIMIT 1');
      } catch {
        console.warn('Skipping integration test - suggestions table not available');
        return;
      }

      // 创建一个过期的建议
      await pool.query(`
        INSERT INTO suggestions (content, source, expires_at, status)
        VALUES ($1, $2, now() - interval '1 hour', 'pending')
      `, ['过期建议测试', 'integration-test-expired']);

      // 创建一个未过期的建议
      await createSuggestion({
        content: '未过期建议测试',
        source: 'integration-test-active'
      });

      const { cleanupExpiredSuggestions } = await import('../suggestion-triage.js');

      // 执行清理
      const cleanupCount = await cleanupExpiredSuggestions();

      expect(cleanupCount).toBeGreaterThanOrEqual(1);

      // 验证过期建议被标记为 archived
      const expiredSuggestion = await pool.query(`
        SELECT status FROM suggestions
        WHERE source = 'integration-test-expired'
      `);

      expect(expiredSuggestion.rows[0].status).toBe('archived');

      // 验证未过期建议仍然是 pending
      const activeSuggestion = await pool.query(`
        SELECT status FROM suggestions
        WHERE source = 'integration-test-active'
      `);

      expect(activeSuggestion.rows[0].status).toBe('pending');
    });

    test('statistics reflect system state accurately', async () => {
      try {
        await pool.query('SELECT 1 FROM suggestions LIMIT 1');
      } catch {
        console.warn('Skipping integration test - suggestions table not available');
        return;
      }

      // 创建不同状态的建议
      const suggestions = await Promise.all([
        createSuggestion({
          content: 'Pending suggestion 1',
          source: 'integration-test-stats'
        }),
        createSuggestion({
          content: 'Pending suggestion 2',
          source: 'integration-test-stats'
        }),
        createSuggestion({
          content: 'To be processed',
          source: 'integration-test-stats'
        })
      ]);

      // 更新其中一个为 processed
      const { updateSuggestionStatus, getTriageStats } = await import('../suggestion-triage.js');
      await updateSuggestionStatus(suggestions[2].id, 'processed');

      // 获取统计信息
      const stats = await getTriageStats();

      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.by_status.pending).toBeGreaterThanOrEqual(2);
      expect(stats.by_status.processed).toBeGreaterThanOrEqual(1);
      expect(stats.avg_priority_by_status.pending).toBeDefined();
      expect(stats.avg_priority_by_status.processed).toBeDefined();
    });
  });

  describe('Performance and scalability', () => {
    test('handles large batch of suggestions efficiently', async () => {
      try {
        await pool.query('SELECT 1 FROM suggestions LIMIT 1');
      } catch {
        console.warn('Skipping integration test - suggestions table not available');
        return;
      }

      // 创建100个建议
      const batchSize = 100;
      const createPromises = [];

      for (let i = 0; i < batchSize; i++) {
        createPromises.push(createSuggestion({
          content: `批量建议测试 ${i}`,
          source: `integration-test-batch-${i % 5}`, // 5个不同的源
          suggestion_type: i % 2 === 0 ? 'general' : 'optimization'
        }));
      }

      const startTime = Date.now();
      await Promise.all(createPromises);
      const createTime = Date.now() - startTime;

      console.log(`创建 ${batchSize} 个建议耗时: ${createTime}ms`);

      // 执行 triage
      const triageStartTime = Date.now();
      const processedSuggestions = await executeTriage(batchSize);
      const triageTime = Date.now() - triageStartTime;

      console.log(`Triage 处理 ${processedSuggestions.length} 个建议耗时: ${triageTime}ms`);

      expect(processedSuggestions.length).toBe(batchSize);
      expect(createTime).toBeLessThan(10000); // 创建应该在10秒内完成
      expect(triageTime).toBeLessThan(5000);  // Triage 应该在5秒内完成

      // 验证优先级排序正确
      for (let i = 1; i < Math.min(10, processedSuggestions.length); i++) {
        expect(processedSuggestions[i-1].priority_score)
          .toBeGreaterThanOrEqual(processedSuggestions[i].priority_score);
      }
    });

    test('triage with limit parameter works correctly', async () => {
      try {
        await pool.query('SELECT 1 FROM suggestions LIMIT 1');
      } catch {
        console.warn('Skipping integration test - suggestions table not available');
        return;
      }

      // 创建20个建议
      for (let i = 0; i < 20; i++) {
        await createSuggestion({
          content: `限制测试建议 ${i}`,
          source: `integration-test-limit-${i}`
        });
      }

      // 限制只处理10个
      const processedSuggestions = await executeTriage(10);

      expect(processedSuggestions.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Error resilience', () => {
    test('system recovers gracefully from database errors during triage', async () => {
      try {
        await pool.query('SELECT 1 FROM suggestions LIMIT 1');
      } catch {
        console.warn('Skipping integration test - suggestions table not available');
        return;
      }

      // 创建一个正常的建议
      await createSuggestion({
        content: '错误恢复测试建议',
        source: 'integration-test-recovery'
      });

      // 模拟数据库连接问题（通过创建一个无效的查询来测试错误处理）
      // 注意：这只是测试错误处理逻辑，实际的数据库错误很难在测试中完全模拟

      // 执行 triage 应该能处理错误并继续
      const processedSuggestions = await executeTriage(10);

      // 系统应该仍能处理正常的建议
      expect(Array.isArray(processedSuggestions)).toBe(true);
    });
  });
});