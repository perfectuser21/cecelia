/**
 * Tests for P0 FIX #1: Systemic failure pattern detection
 *
 * Before fix: checkSystemicFailurePattern() checked for FAILURE_CLASS.SYSTEMIC which classifyFailure() never returns
 * After fix: Detects same-class failures (NETWORK/RATE_LIMIT/etc) reaching threshold
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pool from '../db.js';
import { checkSystemicFailurePattern, FAILURE_CLASS } from '../quarantine.js';

describe('quarantine-systemic (P0 Fix #1)', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM tasks WHERE title LIKE $1', ['%test-systemic%']);
  });

  afterEach(async () => {
    await pool.query('DELETE FROM tasks WHERE title LIKE $1', ['%test-systemic%']);
  });

  it('should detect systemic failure when 3+ same-class failures occur within 30min', async () => {
    // Create 3 tasks with NETWORK failures
    const networkError = 'ECONNREFUSED: Connection refused';
    for (let i = 0; i < 3; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', $2::jsonb, NOW() - INTERVAL '${i * 5} minutes')
      `, [
        `test-systemic-network-${i}`,
        JSON.stringify({ error_details: networkError })
      ]);
    }

    const result = await checkSystemicFailurePattern();

    expect(result.isSystemic).toBe(true);
    expect(result.failureClass).toBe(FAILURE_CLASS.NETWORK);
    expect(result.count).toBeGreaterThanOrEqual(3);
    expect(result.pattern).toContain('network');
  });

  it('should detect RATE_LIMIT as systemic failure', async () => {
    // Create 3 tasks with rate limit failures
    const rateLimitError = '429 Too many requests';
    for (let i = 0; i < 3; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', $2::jsonb, NOW() - INTERVAL '${i * 5} minutes')
      `, [
        `test-systemic-ratelimit-${i}`,
        JSON.stringify({ error_details: rateLimitError })
      ]);
    }

    const result = await checkSystemicFailurePattern();

    expect(result.isSystemic).toBe(true);
    expect(result.failureClass).toBe(FAILURE_CLASS.RATE_LIMIT);
    expect(result.count).toBe(3);
  });

  it('should NOT detect systemic when failures are mixed types', async () => {
    // Create 1 NETWORK, 1 RATE_LIMIT, 1 TASK_ERROR
    await pool.query(`
      INSERT INTO tasks (title, status, payload, updated_at) VALUES
      ('test-systemic-mixed-1', 'failed', '{"error_details":"ECONNREFUSED"}', NOW()),
      ('test-systemic-mixed-2', 'failed', '{"error_details":"429 Too many requests"}', NOW()),
      ('test-systemic-mixed-3', 'failed', '{"error_details":"undefined is not a function"}', NOW())
    `);

    const result = await checkSystemicFailurePattern();

    expect(result.isSystemic).toBe(false);
    expect(result.count).toBeLessThan(3);
  });

  it('should NOT detect systemic when count < 3', async () => {
    // Create only 2 NETWORK failures
    const networkError = 'ECONNREFUSED';
    for (let i = 0; i < 2; i++) {
      await pool.query(`
        INSERT INTO tasks (title, status, payload, updated_at)
        VALUES ($1, 'failed', $2::jsonb, NOW())
      `, [
        `test-systemic-few-${i}`,
        JSON.stringify({ error_details: networkError })
      ]);
    }

    const result = await checkSystemicFailurePattern();

    expect(result.isSystemic).toBe(false);
  });

  it('should ignore failures older than 30min', async () => {
    // Create 2 recent + 1 old NETWORK failure (should NOT be systemic)
    const networkError = 'ECONNREFUSED';
    await pool.query(`
      INSERT INTO tasks (title, status, payload, updated_at) VALUES
      ('test-systemic-old-1', 'failed', $1::jsonb, NOW() - INTERVAL '35 minutes'),
      ('test-systemic-recent-1', 'failed', $1::jsonb, NOW() - INTERVAL '5 minutes'),
      ('test-systemic-recent-2', 'failed', $1::jsonb, NOW())
    `, [JSON.stringify({ error_details: networkError })]);

    const result = await checkSystemicFailurePattern();

    expect(result.isSystemic).toBe(false);
    expect(result.count).toBeLessThan(3);
  });
});
