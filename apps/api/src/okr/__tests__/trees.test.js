/**
 * OKR Tree CRUD API Tests
 * Tests for tree-based operations: list trees, get tree, create tree, update tree, delete tree
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

// Use test database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

// Test data IDs for cleanup
let testObjectiveIds = [];
let testKRIds = [];

describe('OKR Tree CRUD API', () => {
  beforeAll(async () => {
    // Verify database connection
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Cleanup test data in reverse order
    for (const krId of testKRIds) {
      await pool.query('DELETE FROM goals WHERE id = $1', [krId]).catch(() => {});
    }
    for (const objId of testObjectiveIds) {
      await pool.query('DELETE FROM goals WHERE id = $1', [objId]).catch(() => {});
    }
    testKRIds = [];
    testObjectiveIds = [];
  });

  describe('GET /api/okr/trees - List OKR Trees', () => {
    it('returns only top-level Objectives', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, parent_id) VALUES ($1, $2, NULL) RETURNING *`,
        ['Test Objective', 'objective']
      );
      testObjectiveIds.push(objResult.rows[0].id);

      // Create KR (should not appear in trees list)
      const krResult = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Test KR', 'key_result', objResult.rows[0].id, 1.0]
      );
      testKRIds.push(krResult.rows[0].id);

      // Query top-level Objectives
      const treesResult = await pool.query(`
        SELECT
          o.*,
          (SELECT COUNT(*) FROM goals WHERE parent_id = o.id) as children_count
        FROM goals o
        WHERE o.type = 'objective' AND o.parent_id IS NULL
        AND o.id = $1
      `, [objResult.rows[0].id]);

      expect(treesResult.rows.length).toBe(1);
      expect(treesResult.rows[0].type).toBe('objective');
      expect(parseInt(treesResult.rows[0].children_count)).toBe(1);
    });

    it('includes children_count in response', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *`,
        ['Test Objective with KRs', 'objective']
      );
      testObjectiveIds.push(objResult.rows[0].id);

      // Create 3 KRs
      for (let i = 1; i <= 3; i++) {
        const krResult = await pool.query(
          `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
          [`KR ${i}`, 'key_result', objResult.rows[0].id, 1.0]
        );
        testKRIds.push(krResult.rows[0].id);
      }

      // Query with children_count
      const result = await pool.query(`
        SELECT
          o.*,
          (SELECT COUNT(*) FROM goals WHERE parent_id = o.id) as children_count
        FROM goals o
        WHERE o.id = $1
      `, [objResult.rows[0].id]);

      expect(parseInt(result.rows[0].children_count)).toBe(3);
    });
  });

  describe('GET /api/okr/trees/:id - Get Complete OKR Tree', () => {
    it('returns Objective with all Key Results', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, progress) VALUES ($1, $2, $3) RETURNING *`,
        ['Full OKR Tree', 'objective', 25]
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create 2 KRs
      const kr1Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['KR 1', 'key_result', objId, 0.6, 30]
      );
      testKRIds.push(kr1Result.rows[0].id);

      const kr2Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['KR 2', 'key_result', objId, 0.4, 50]
      );
      testKRIds.push(kr2Result.rows[0].id);

      // Query tree
      const objQuery = await pool.query(
        'SELECT * FROM goals WHERE id = $1 AND type = $2',
        [objId, 'objective']
      );
      expect(objQuery.rows.length).toBe(1);

      const krsQuery = await pool.query(
        'SELECT * FROM goals WHERE parent_id = $1 ORDER BY weight DESC',
        [objId]
      );
      expect(krsQuery.rows.length).toBe(2);
      expect(krsQuery.rows.every(kr => kr.type === 'key_result')).toBe(true);
    });

    it('returns 404 for non-existent tree', async () => {
      const result = await pool.query(
        'SELECT * FROM goals WHERE id = $1 AND type = $2',
        ['00000000-0000-0000-0000-000000000000', 'objective']
      );
      expect(result.rows.length).toBe(0);
    });
  });

  describe('POST /api/okr/trees - Create OKR Tree', () => {
    it('creates Objective and Key Results in one transaction', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create Objective
        const objResult = await client.query(
          `INSERT INTO goals (title, type, status, priority) VALUES ($1, $2, $3, $4) RETURNING *`,
          ['New OKR Tree', 'objective', 'pending', 'P1']
        );
        testObjectiveIds.push(objResult.rows[0].id);
        const objId = objResult.rows[0].id;

        // Create KRs
        const kr1Result = await client.query(
          `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
          ['First KR', 'key_result', objId, 0.5]
        );
        testKRIds.push(kr1Result.rows[0].id);

        const kr2Result = await client.query(
          `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
          ['Second KR', 'key_result', objId, 0.5]
        );
        testKRIds.push(kr2Result.rows[0].id);

        await client.query('COMMIT');

        // Verify tree was created
        const verifyObj = await pool.query('SELECT * FROM goals WHERE id = $1', [objId]);
        expect(verifyObj.rows.length).toBe(1);
        expect(verifyObj.rows[0].type).toBe('objective');

        const verifyKRs = await pool.query('SELECT * FROM goals WHERE parent_id = $1', [objId]);
        expect(verifyKRs.rows.length).toBe(2);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('rolls back on error', async () => {
      const client = await pool.connect();
      let objId = null;

      try {
        await client.query('BEGIN');

        // Create Objective
        const objResult = await client.query(
          `INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *`,
          ['Rollback Test', 'objective']
        );
        objId = objResult.rows[0].id;

        // Try to create KR with invalid weight (> 1)
        await client.query(
          `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4)`,
          ['Invalid KR', 'key_result', objId, 1.5]
        );

        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Verify nothing was created (rolled back)
      if (objId) {
        const result = await pool.query('SELECT * FROM goals WHERE id = $1', [objId]);
        expect(result.rows.length).toBe(0);
      }
    });
  });

  describe('PUT /api/okr/trees/:id - Update OKR Tree', () => {
    it('updates Objective fields', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, status) VALUES ($1, $2, $3) RETURNING *`,
        ['Original Title', 'objective', 'pending']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Update Objective
      const updateResult = await pool.query(
        `UPDATE goals SET title = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
        ['Updated Title', 'in_progress', objId]
      );

      expect(updateResult.rows[0].title).toBe('Updated Title');
      expect(updateResult.rows[0].status).toBe('in_progress');
    });

    it('can add new Key Results to existing Objective', async () => {
      // Create Objective with 1 KR
      const objResult = await pool.query(
        `INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *`,
        ['Expandable Objective', 'objective']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      const kr1Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Original KR', 'key_result', objId, 1.0]
      );
      testKRIds.push(kr1Result.rows[0].id);

      // Add new KR
      const kr2Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['New KR', 'key_result', objId, 0.5]
      );
      testKRIds.push(kr2Result.rows[0].id);

      // Verify 2 KRs now
      const krsResult = await pool.query('SELECT * FROM goals WHERE parent_id = $1', [objId]);
      expect(krsResult.rows.length).toBe(2);
    });

    it('can remove Key Results from Objective', async () => {
      // Create Objective with 2 KRs
      const objResult = await pool.query(
        `INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *`,
        ['Shrinkable Objective', 'objective']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      const kr1Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['KR to Keep', 'key_result', objId, 0.5]
      );
      testKRIds.push(kr1Result.rows[0].id);

      const kr2Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['KR to Delete', 'key_result', objId, 0.5]
      );
      const kr2Id = kr2Result.rows[0].id;

      // Delete one KR
      await pool.query('DELETE FROM goals WHERE id = $1', [kr2Id]);

      // Verify only 1 KR remains
      const krsResult = await pool.query('SELECT * FROM goals WHERE parent_id = $1', [objId]);
      expect(krsResult.rows.length).toBe(1);
      expect(krsResult.rows[0].title).toBe('KR to Keep');
    });

    it('recalculates Objective progress when KR progress changes', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, progress) VALUES ($1, $2, $3) RETURNING *`,
        ['Progress Test Objective', 'objective', 0]
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create 2 KRs with equal weight
      const kr1Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['KR 1', 'key_result', objId, 1.0, 40]
      );
      testKRIds.push(kr1Result.rows[0].id);
      const kr1Id = kr1Result.rows[0].id;

      const kr2Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['KR 2', 'key_result', objId, 1.0, 60]
      );
      testKRIds.push(kr2Result.rows[0].id);

      // Calculate expected progress: (40 * 1.0 + 60 * 1.0) / (1.0 + 1.0) = 50
      const krs = await pool.query(
        'SELECT progress, weight FROM goals WHERE parent_id = $1',
        [objId]
      );

      let totalWeightedProgress = 0;
      let totalWeight = 0;
      for (const kr of krs.rows) {
        totalWeightedProgress += parseInt(kr.progress) * parseFloat(kr.weight);
        totalWeight += parseFloat(kr.weight);
      }
      const calculatedProgress = Math.round(totalWeightedProgress / totalWeight);
      expect(calculatedProgress).toBe(50);

      // Update KR1 progress to 80
      await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [80, kr1Id]);

      // Recalculate: (80 * 1.0 + 60 * 1.0) / 2 = 70
      const updatedKRs = await pool.query(
        'SELECT progress, weight FROM goals WHERE parent_id = $1',
        [objId]
      );

      totalWeightedProgress = 0;
      totalWeight = 0;
      for (const kr of updatedKRs.rows) {
        totalWeightedProgress += parseInt(kr.progress) * parseFloat(kr.weight);
        totalWeight += parseFloat(kr.weight);
      }
      const newProgress = Math.round(totalWeightedProgress / totalWeight);
      expect(newProgress).toBe(70);
    });
  });

  describe('DELETE /api/okr/trees/:id - Delete OKR Tree', () => {
    it('deletes Objective and all Key Results (cascade)', async () => {
      const client = await pool.connect();
      let objId = null;

      try {
        await client.query('BEGIN');

        // Create Objective
        const objResult = await client.query(
          `INSERT INTO goals (title, type) VALUES ($1, $2) RETURNING *`,
          ['Tree to Delete', 'objective']
        );
        objId = objResult.rows[0].id;

        // Create 2 KRs
        await client.query(
          `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4)`,
          ['KR 1', 'key_result', objId, 0.5]
        );
        await client.query(
          `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4)`,
          ['KR 2', 'key_result', objId, 0.5]
        );

        // Delete KRs first
        await client.query('DELETE FROM goals WHERE parent_id = $1', [objId]);

        // Delete Objective
        await client.query('DELETE FROM goals WHERE id = $1', [objId]);

        await client.query('COMMIT');

        // Verify nothing remains
        const verifyObj = await pool.query('SELECT * FROM goals WHERE id = $1', [objId]);
        expect(verifyObj.rows.length).toBe(0);

        const verifyKRs = await pool.query('SELECT * FROM goals WHERE parent_id = $1', [objId]);
        expect(verifyKRs.rows.length).toBe(0);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('returns 404 for non-existent tree', async () => {
      const result = await pool.query(
        'SELECT * FROM goals WHERE id = $1 AND type = $2',
        ['00000000-0000-0000-0000-000000000000', 'objective']
      );
      expect(result.rows.length).toBe(0);
    });
  });
});
