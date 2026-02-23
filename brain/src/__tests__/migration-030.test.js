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

    it('should have seed capabilities', async () => {
      const result = await pool.query('SELECT count(*) FROM capabilities');
      expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(23);
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

  // pr_plans tests removed — table dropped in migration 058

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
