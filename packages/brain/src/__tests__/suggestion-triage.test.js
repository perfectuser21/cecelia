/**
 * Tests for suggestion-triage module
 */

import {
  createSuggestion,
  executeTriage,
  getTopPrioritySuggestions,
  updateSuggestionStatus,
  cleanupExpiredSuggestions,
  getTriageStats
} from '../suggestion-triage.js';
import pool from '../db.js';

describe('Suggestion Triage System', () => {
  beforeEach(async () => {
    // 清理测试数据
    await pool.query('DELETE FROM suggestions WHERE source = $1', ['test']);
    await pool.query('DELETE FROM cecelia_events WHERE source = $1', ['test']);
  });

  afterAll(async () => {
    // 最终清理
    await pool.query('DELETE FROM suggestions WHERE source = $1', ['test']);
    await pool.query('DELETE FROM cecelia_events WHERE source = $1', ['test']);
  });

  describe('createSuggestion', () => {
    test('creates suggestion with correct priority scoring', async () => {
      const suggestionData = {
        content: 'Test suggestion from cortex',
        source: 'cortex',
        agent_id: 'cortex-v1',
        suggestion_type: 'alert',
        target_entity_type: 'system',
        metadata: { urgency: 'high' }
      };

      const suggestion = await createSuggestion(suggestionData);

      expect(suggestion.id).toBeDefined();
      expect(suggestion.content).toBe(suggestionData.content);
      expect(suggestion.source).toBe('cortex');
      expect(suggestion.suggestion_type).toBe('alert');
      expect(suggestion.priority_score).toBeGreaterThan(0.8); // Alert type should have high priority
      expect(suggestion.status).toBe('pending');
    });

    test('calculates different priority scores for different sources', async () => {
      const cortexSuggestion = await createSuggestion({
        content: 'Cortex suggestion',
        source: 'cortex',
        suggestion_type: 'general'
      });

      const executorSuggestion = await createSuggestion({
        content: 'Executor suggestion',
        source: 'executor',
        suggestion_type: 'general'
      });

      // Cortex should have higher priority than executor
      expect(cortexSuggestion.priority_score).toBeGreaterThan(executorSuggestion.priority_score);
    });

    test('emits event when suggestion is created', async () => {
      await createSuggestion({
        content: 'Test event emission',
        source: 'test'
      });

      // 检查事件是否发布
      const eventResult = await pool.query(`
        SELECT * FROM cecelia_events
        WHERE event_type = 'suggestion_created'
        AND source = 'suggestion_triage'
        AND payload->>'source' = 'test'
        ORDER BY created_at DESC
        LIMIT 1
      `);

      expect(eventResult.rows.length).toBe(1);
      const event = eventResult.rows[0];
      expect(event.payload.source).toBe('test');
    });
  });

  describe('executeTriage', () => {
    test('processes pending suggestions and updates priority scores', async () => {
      // 创建一些测试建议，其中一些是旧的（需要重新评分）
      const oldSuggestion = await pool.query(`
        INSERT INTO suggestions (content, source, suggestion_type, created_at, priority_score)
        VALUES ($1, $2, $3, now() - interval '2 hours', $4)
        RETURNING *
      `, ['Old suggestion', 'test', 'general', 0.5]);

      const recentSuggestion = await createSuggestion({
        content: 'Recent high priority suggestion',
        source: 'test',
        suggestion_type: 'alert'
      });

      const processedSuggestions = await executeTriage(10);

      expect(processedSuggestions.length).toBeGreaterThanOrEqual(2);

      // 验证优先级排序（高优先级在前）
      for (let i = 1; i < processedSuggestions.length; i++) {
        expect(processedSuggestions[i-1].priority_score)
          .toBeGreaterThanOrEqual(processedSuggestions[i].priority_score);
      }
    });

    test('identifies and rejects duplicate suggestions', async () => {
      // 创建两个相似的建议
      const suggestion1 = await createSuggestion({
        content: 'Create task for user management',
        source: 'test',
        suggestion_type: 'task_creation',
        target_entity_type: 'project',
        target_entity_id: '00000000-0000-0000-0000-000000001234'
      });

      const suggestion2 = await createSuggestion({
        content: 'Create task for user management feature',
        source: 'test',
        suggestion_type: 'task_creation',
        target_entity_type: 'project',
        target_entity_id: '00000000-0000-0000-0000-000000001234'
      });

      await executeTriage(10);

      // 检查其中一个被标记为 rejected
      const rejectedResult = await pool.query(`
        SELECT * FROM suggestions
        WHERE source = 'test' AND status = 'rejected'
      `);

      expect(rejectedResult.rows.length).toBe(1);

      // 检查 metadata 中包含去重信息
      const rejected = rejectedResult.rows[0];
      expect(rejected.metadata.rejection_reason).toBe('duplicate');
      expect(rejected.metadata.duplicate_of).toBeDefined();
    });

    test('emits triage completion event', async () => {
      await createSuggestion({
        content: 'Test triage event',
        source: 'test'
      });

      await executeTriage(10);

      // 检查 triage 完成事件
      const eventResult = await pool.query(`
        SELECT * FROM cecelia_events
        WHERE event_type = 'suggestions_triaged'
        ORDER BY created_at DESC
        LIMIT 1
      `);

      expect(eventResult.rows.length).toBe(1);
      const event = eventResult.rows[0];
      expect(event.payload.processed_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getTopPrioritySuggestions', () => {
    test('returns suggestions ordered by priority', async () => {
      // 创建不同优先级的建议
      await createSuggestion({
        content: 'Low priority',
        source: 'test',
        suggestion_type: 'general'
      });

      await createSuggestion({
        content: 'High priority alert',
        source: 'test',
        suggestion_type: 'alert'
      });

      const topSuggestions = await getTopPrioritySuggestions(5);

      expect(topSuggestions.length).toBe(2);
      expect(topSuggestions[0].priority_score)
        .toBeGreaterThanOrEqual(topSuggestions[1].priority_score);
    });

    test('respects limit parameter', async () => {
      // 创建多个建议
      for (let i = 0; i < 5; i++) {
        await createSuggestion({
          content: `Test suggestion ${i}`,
          source: 'test'
        });
      }

      const limitedResults = await getTopPrioritySuggestions(3);
      expect(limitedResults.length).toBe(3);
    });
  });

  describe('updateSuggestionStatus', () => {
    test('updates status and sets processed_at for processed status', async () => {
      const suggestion = await createSuggestion({
        content: 'Test status update',
        source: 'test'
      });

      await updateSuggestionStatus(suggestion.id, 'processed', {
        action_taken: 'task_created',
        task_id: 'new-task-123'
      });

      const result = await pool.query(`
        SELECT * FROM suggestions WHERE id = $1
      `, [suggestion.id]);

      const updated = result.rows[0];
      expect(updated.status).toBe('processed');
      expect(updated.processed_at).toBeDefined();
      expect(updated.metadata.action_taken).toBe('task_created');
    });

    test('emits status update event', async () => {
      const suggestion = await createSuggestion({
        content: 'Test event on status update',
        source: 'test'
      });

      await updateSuggestionStatus(suggestion.id, 'rejected', {
        reason: 'not_feasible'
      });

      const eventResult = await pool.query(`
        SELECT * FROM cecelia_events
        WHERE event_type = 'suggestion_status_updated'
        AND payload->>'suggestion_id' = $1
      `, [suggestion.id]);

      expect(eventResult.rows.length).toBe(1);
      const event = eventResult.rows[0];
      expect(event.payload.new_status).toBe('rejected');
    });
  });

  describe('cleanupExpiredSuggestions', () => {
    test('archives expired suggestions', async () => {
      // 创建一个过期的建议
      const expiredResult = await pool.query(`
        INSERT INTO suggestions (content, source, expires_at)
        VALUES ($1, $2, now() - interval '1 hour')
        RETURNING id
      `, ['Expired suggestion', 'test']);

      const expiredId = expiredResult.rows[0].id;

      const cleanupCount = await cleanupExpiredSuggestions();

      expect(cleanupCount).toBeGreaterThanOrEqual(1);

      // 验证建议被标记为 archived
      const result = await pool.query(`
        SELECT status FROM suggestions WHERE id = $1
      `, [expiredId]);

      expect(result.rows[0].status).toBe('archived');
    });

    test('does not affect non-expired suggestions', async () => {
      const activeSuggestion = await createSuggestion({
        content: 'Active suggestion',
        source: 'test'
      });

      await cleanupExpiredSuggestions();

      const result = await pool.query(`
        SELECT status FROM suggestions WHERE id = $1
      `, [activeSuggestion.id]);

      expect(result.rows[0].status).toBe('pending');
    });
  });

  describe('getTriageStats', () => {
    test('returns correct statistics', async () => {
      // 创建不同状态的建议
      await createSuggestion({
        content: 'Pending suggestion 1',
        source: 'test'
      });

      await createSuggestion({
        content: 'Pending suggestion 2',
        source: 'test'
      });

      const processedSuggestion = await createSuggestion({
        content: 'Processed suggestion',
        source: 'test'
      });

      await updateSuggestionStatus(processedSuggestion.id, 'processed');

      const stats = await getTriageStats();

      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.by_status.pending).toBeGreaterThanOrEqual(2);
      expect(stats.by_status.processed).toBeGreaterThanOrEqual(1);
      expect(stats.avg_priority_by_status).toBeDefined();
    });
  });
});