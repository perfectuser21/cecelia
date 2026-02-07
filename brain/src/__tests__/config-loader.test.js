/**
 * Config Loader Tests
 * Tests dynamic configuration reading from brain_config table
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { readBrainConfig, readBrainConfigBatch, loadAllAdjustableParams } from '../config-loader.js';

const { Pool } = pg;
let pool;

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
});

afterAll(async () => {
  await pool.end();
});

describe('Config Loader', () => {
  beforeEach(async () => {
    // Clean up test config keys
    await pool.query("DELETE FROM brain_config WHERE key LIKE 'test.%'");
  });

  describe('readBrainConfig', () => {
    it('should return value from database when key exists', async () => {
      // Insert test config
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at)
        VALUES ($1, $2, NOW())
      `, ['test.sample_key', JSON.stringify(42)]);

      const value = await readBrainConfig('test.sample_key', 0);

      expect(value).toBe(42);
    });

    it('should return default value when key does not exist', async () => {
      const value = await readBrainConfig('test.nonexistent', 'default_value');

      expect(value).toBe('default_value');
    });

    it('should parse JSON string values', async () => {
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at)
        VALUES ($1, $2, NOW())
      `, ['test.json_value', JSON.stringify({ foo: 'bar', count: 123 })]);

      const value = await readBrainConfig('test.json_value', {});

      expect(value).toEqual({ foo: 'bar', count: 123 });
    });

    it('should handle numeric values', async () => {
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at)
        VALUES ($1, $2, NOW())
      `, ['test.number', JSON.stringify(3.14)]);

      const value = await readBrainConfig('test.number', 0);

      expect(value).toBe(3.14);
    });

    it('should handle boolean values', async () => {
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at)
        VALUES ($1, $2, NOW())
      `, ['test.boolean', JSON.stringify(true)]);

      const value = await readBrainConfig('test.boolean', false);

      expect(value).toBe(true);
    });

    it('should return default value on database error', async () => {
      // Pass invalid key that would cause error (but handled gracefully)
      const value = await readBrainConfig(null, 'fallback');

      expect(value).toBe('fallback');
    });
  });

  describe('readBrainConfigBatch', () => {
    it('should read multiple keys at once', async () => {
      // Insert multiple test configs
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at) VALUES
        ('test.key1', $1, NOW()),
        ('test.key2', $2, NOW()),
        ('test.key3', $3, NOW())
      `, [JSON.stringify(100), JSON.stringify(200), JSON.stringify(300)]);

      const config = await readBrainConfigBatch({
        'test.key1': 0,
        'test.key2': 0,
        'test.key3': 0
      });

      expect(config['test.key1']).toBe(100);
      expect(config['test.key2']).toBe(200);
      expect(config['test.key3']).toBe(300);
    });

    it('should use defaults for missing keys', async () => {
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at)
        VALUES ('test.exists', $1, NOW())
      `, [JSON.stringify(999)]);

      const config = await readBrainConfigBatch({
        'test.exists': 0,
        'test.missing': 'default'
      });

      expect(config['test.exists']).toBe(999);
      expect(config['test.missing']).toBe('default');
    });

    it('should return all defaults when no keys exist', async () => {
      const config = await readBrainConfigBatch({
        'test.nonexistent1': 'a',
        'test.nonexistent2': 'b'
      });

      expect(config).toEqual({
        'test.nonexistent1': 'a',
        'test.nonexistent2': 'b'
      });
    });

    it('should handle empty input', async () => {
      const config = await readBrainConfigBatch({});

      expect(config).toEqual({});
    });
  });

  describe('loadAllAdjustableParams', () => {
    beforeEach(async () => {
      // Clean up all adjustable params
      await pool.query("DELETE FROM brain_config WHERE key LIKE 'alertness.%' OR key LIKE 'retry.%' OR key LIKE 'resource.%' OR key LIKE 'circuit_breaker.%'");
    });

    it('should return default values when no config exists', async () => {
      const config = await loadAllAdjustableParams();

      expect(config).toHaveProperty('alertness.alert_threshold', 0.5);
      expect(config).toHaveProperty('alertness.emergency_threshold', 0.7);
      expect(config).toHaveProperty('retry.max_attempts', 3);
      expect(config).toHaveProperty('circuit_breaker.failure_threshold', 3);
    });

    it('should override defaults with database values', async () => {
      // Clean first
      await pool.query("DELETE FROM brain_config WHERE key = 'alertness.alert_threshold'");

      // Insert adjusted parameter
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at)
        VALUES ('alertness.alert_threshold', $1, NOW())
      `, [JSON.stringify(0.6)]);

      const config = await loadAllAdjustableParams();

      expect(config['alertness.alert_threshold']).toBe(0.6);
      // emergency_threshold should be default (0.7)
      expect(config['alertness.emergency_threshold']).toBeGreaterThanOrEqual(0.5);
    });

    it('should load all adjustable parameters', async () => {
      const config = await loadAllAdjustableParams();

      // Check all expected keys exist
      const expectedKeys = [
        'alertness.alert_threshold',
        'alertness.emergency_threshold',
        'alertness.coma_threshold',
        'retry.max_attempts',
        'retry.backoff_base_seconds',
        'resource.max_concurrent_tasks',
        'resource.memory_threshold_mb',
        'circuit_breaker.failure_threshold',
        'circuit_breaker.timeout_seconds'
      ];

      for (const key of expectedKeys) {
        expect(config).toHaveProperty(key);
      }
    });
  });
});
