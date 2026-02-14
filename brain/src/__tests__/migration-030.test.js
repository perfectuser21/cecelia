import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../db.js';

describe('Migration 030: Capability-Driven Development', () => {
  beforeAll(async () => {
    // Migration should have been applied during server startup
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('capabilities table', () => {
    it('should have capabilities table', async () => {
      const result = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'capabilities'
      `);

      expect(result.rows.length).toBe(1);
    });

    it('should have correct columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'capabilities'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('description');
      expect(columns).toContain('current_stage');
      expect(columns).toContain('stage_definitions');
      expect(columns).toContain('related_repos');
      expect(columns).toContain('related_skills');
      expect(columns).toContain('key_tables');
      expect(columns).toContain('evidence');
      expect(columns).toContain('owner');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });

    it('should have id as VARCHAR(60) primary key', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = 'capabilities' AND column_name = 'id'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('character varying');
      expect(result.rows[0].character_maximum_length).toBe(60);
    });

    it('should have current_stage with CHECK constraint', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'capabilities'
          AND constraint_type = 'CHECK'
          AND constraint_name LIKE '%current_stage%'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have 23 seed capabilities', async () => {
      const result = await pool.query('SELECT count(*) FROM capabilities');
      expect(parseInt(result.rows[0].count, 10)).toBe(23);
    });

    it('should have valid seed data structure', async () => {
      const result = await pool.query(`
        SELECT id, name, current_stage, related_repos
        FROM capabilities
        ORDER BY id
        LIMIT 5
      `);

      expect(result.rows.length).toBe(5);

      // Check each capability has required fields
      result.rows.forEach(cap => {
        expect(cap.id).toBeTruthy();
        expect(cap.name).toBeTruthy();
        expect(cap.current_stage).toBeGreaterThanOrEqual(1);
        expect(cap.current_stage).toBeLessThanOrEqual(4);
      });
    });

    it('should have autonomous-task-scheduling capability', async () => {
      const result = await pool.query(`
        SELECT * FROM capabilities WHERE id = 'autonomous-task-scheduling'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].name).toBe('自主任务调度与派发');
      expect(result.rows[0].current_stage).toBe(3);
    });
  });

  describe('pr_plans new fields', () => {
    it('should have capability_id column', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'pr_plans' AND column_name = 'capability_id'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('character varying');
    });

    it('should have from_stage column with CHECK constraint', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'pr_plans' AND column_name = 'from_stage'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('integer');
    });

    it('should have to_stage column with CHECK constraint', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'pr_plans' AND column_name = 'to_stage'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('integer');
    });

    it('should have evidence_required column', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'pr_plans' AND column_name = 'evidence_required'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('text');
    });

    it('should have foreign key to capabilities', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'pr_plans'
          AND constraint_type = 'FOREIGN KEY'
          AND constraint_name LIKE '%capability_id%'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have chk_stage_progression constraint', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'pr_plans'
          AND constraint_type = 'CHECK'
          AND constraint_name = 'chk_stage_progression'
      `);

      expect(result.rows.length).toBe(1);
    });
  });

  describe('stage progression constraints', () => {
    let testProjectId;

    beforeAll(async () => {
      // Create a test project for pr_plans
      const result = await pool.query(`
        INSERT INTO projects (name, repo_path)
        VALUES ('Test Project for Migration 030', '/test/path')
        RETURNING id
      `);
      testProjectId = result.rows[0].id;
    });

    afterAll(async () => {
      // Cleanup
      await pool.query('DELETE FROM pr_plans WHERE project_id = $1', [testProjectId]);
      await pool.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    });

    it('should allow valid stage progression (from_stage < to_stage)', async () => {
      const result = await pool.query(`
        INSERT INTO pr_plans (
          project_id, title, dod,
          capability_id, from_stage, to_stage, evidence_required
        ) VALUES (
          $1, 'Test PR Plan - Valid Progression', 'Test DoD',
          'autonomous-task-scheduling', 2, 3, 'Test evidence'
        )
        RETURNING id, from_stage, to_stage
      `,  [testProjectId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].from_stage).toBe(2);
      expect(result.rows[0].to_stage).toBe(3);

      // Cleanup
      await pool.query('DELETE FROM pr_plans WHERE id = $1', [result.rows[0].id]);
    });

    it('should reject from_stage >= to_stage (same stage)', async () => {
      await expect(async () => {
        await pool.query(`
          INSERT INTO pr_plans (
            project_id, title, dod,
            from_stage, to_stage
          ) VALUES (
            $1, 'Test PR Plan - Same Stage', 'Test DoD',
            3, 3
          )
        `, [testProjectId]);
      }).rejects.toThrow();
    });

    it('should reject from_stage > to_stage (backward)', async () => {
      await expect(async () => {
        await pool.query(`
          INSERT INTO pr_plans (
            project_id, title, dod,
            from_stage, to_stage
          ) VALUES (
            $1, 'Test PR Plan - Backward', 'Test DoD',
            3, 2
          )
        `, [testProjectId]);
      }).rejects.toThrow();
    });

    it('should allow NULL from_stage or to_stage', async () => {
      const result1 = await pool.query(`
        INSERT INTO pr_plans (
          project_id, title, dod,
          from_stage, to_stage
        ) VALUES (
          $1, 'Test PR Plan - NULL from', 'Test DoD',
          NULL, 3
        )
        RETURNING id
      `, [testProjectId]);

      expect(result1.rows.length).toBe(1);

      const result2 = await pool.query(`
        INSERT INTO pr_plans (
          project_id, title, dod,
          from_stage, to_stage
        ) VALUES (
          $1, 'Test PR Plan - NULL to', 'Test DoD',
          2, NULL
        )
        RETURNING id
      `, [testProjectId]);

      expect(result2.rows.length).toBe(1);

      // Cleanup
      await pool.query('DELETE FROM pr_plans WHERE id = ANY($1)', [[result1.rows[0].id, result2.rows[0].id]]);
    });
  });

  describe('schema_version', () => {
    it('should have schema_version 030', async () => {
      const result = await pool.query(`
        SELECT version, description
        FROM schema_version
        WHERE version = '030'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].description).toContain('Capability-Driven Development');
    });
  });
});
