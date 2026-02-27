/**
 * Tests for migration 087: suggestions table
 */

import pool from '../db.js';

describe('Migration 087: Suggestions Table', () => {
  beforeAll(async () => {
    // 确保迁移已执行
    // 在实际环境中，这应该通过 migrate.js 来处理
  });

  afterAll(async () => {
    // 清理测试数据
    await pool.query('DELETE FROM suggestions WHERE source = $1', ['test']);
  });

  describe('Table Structure', () => {
    test('suggestions table exists with correct columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'suggestions'
        ORDER BY column_name
      `);

      const columns = result.rows.map(row => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES'
      }));

      // 验证必要的列存在
      const expectedColumns = [
        'id', 'content', 'priority_score', 'source', 'agent_id',
        'status', 'suggestion_type', 'target_entity_type',
        'target_entity_id', 'metadata', 'created_at', 'updated_at',
        'processed_at', 'expires_at'
      ];

      for (const expectedCol of expectedColumns) {
        expect(columns.some(col => col.name === expectedCol)).toBe(true);
      }
    });

    test('indexes exist for performance', async () => {
      const result = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'suggestions'
        AND indexname LIKE 'idx_suggestions_%'
      `);

      const indexNames = result.rows.map(row => row.indexname);

      // 验证关键索引存在
      expect(indexNames).toContain('idx_suggestions_status');
      expect(indexNames).toContain('idx_suggestions_priority_score');
      expect(indexNames).toContain('idx_suggestions_triage');
    });

    test('trigger for updated_at exists', async () => {
      const result = await pool.query(`
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_table = 'suggestions'
        AND trigger_name = 'trigger_suggestions_updated_at'
      `);

      expect(result.rows.length).toBe(1);
    });
  });

  describe('Data Operations', () => {
    test('can insert suggestion with required fields', async () => {
      const testSuggestion = {
        content: 'Test suggestion content',
        source: 'test',
        agent_id: 'test-agent',
        suggestion_type: 'general'
      };

      const result = await pool.query(`
        INSERT INTO suggestions (content, source, agent_id, suggestion_type)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [testSuggestion.content, testSuggestion.source, testSuggestion.agent_id, testSuggestion.suggestion_type]);

      expect(result.rows.length).toBe(1);
      const inserted = result.rows[0];

      expect(inserted.content).toBe(testSuggestion.content);
      expect(inserted.source).toBe(testSuggestion.source);
      expect(inserted.status).toBe('pending'); // 默认状态
      expect(inserted.priority_score).toBe(0.5); // 默认优先级
      expect(inserted.created_at).toBeDefined();
      expect(inserted.expires_at).toBeDefined();
    });

    test('updated_at trigger works', async () => {
      // 插入一个建议
      const insertResult = await pool.query(`
        INSERT INTO suggestions (content, source)
        VALUES ($1, $2)
        RETURNING id, updated_at
      `, ['Test for trigger', 'test']);

      const originalUpdatedAt = insertResult.rows[0].updated_at;
      const suggestionId = insertResult.rows[0].id;

      // 等待一小段时间确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 100));

      // 更新建议
      await pool.query(`
        UPDATE suggestions
        SET status = 'processed'
        WHERE id = $1
      `, [suggestionId]);

      // 检查 updated_at 是否更新
      const selectResult = await pool.query(`
        SELECT updated_at
        FROM suggestions
        WHERE id = $1
      `, [suggestionId]);

      const newUpdatedAt = selectResult.rows[0].updated_at;
      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });

    test('can query suggestions with filters', async () => {
      // 插入多个测试建议
      await pool.query(`
        INSERT INTO suggestions (content, source, status, priority_score)
        VALUES
          ('High priority', 'test', 'pending', 0.9),
          ('Low priority', 'test', 'pending', 0.1),
          ('Processed', 'test', 'processed', 0.5)
      `);

      // 测试按状态过滤
      const pendingResult = await pool.query(`
        SELECT * FROM suggestions
        WHERE source = 'test' AND status = 'pending'
      `);
      expect(pendingResult.rows.length).toBeGreaterThanOrEqual(2);

      // 测试按优先级过滤
      const highPriorityResult = await pool.query(`
        SELECT * FROM suggestions
        WHERE source = 'test' AND priority_score >= 0.8
      `);
      expect(highPriorityResult.rows.length).toBeGreaterThanOrEqual(1);
    });
  });
});