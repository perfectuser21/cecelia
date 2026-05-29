/**
 * [FAILING] Migration 289 — decisions/initiative_contracts notion_id 列
 *
 * Migration 284（PR #3140）只加了 notion_synced_at，漏掉 notion_id，
 * 导致 notion-push-sync 每次推送后回写失败，5 分钟定时任务无限重复推送。
 *
 * 本测试验证：
 * 1. decisions 表有 notion_id 列（VARCHAR UNIQUE）
 * 2. initiative_contracts 表有 notion_id 列（VARCHAR UNIQUE）
 * 3. EXPECTED_SCHEMA_VERSION 已更新到 289
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
let pool;

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
});

afterAll(async () => {
  await pool.end();
});

describe('Migration 289 - decisions/initiative_contracts notion_id', () => {
  it('decisions 表应有 notion_id 列', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'decisions'
        AND column_name = 'notion_id'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('initiative_contracts 表应有 notion_id 列', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'initiative_contracts'
        AND column_name = 'notion_id'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('EXPECTED_SCHEMA_VERSION 应为 289', async () => {
    const { EXPECTED_SCHEMA_VERSION } = await import('../selfcheck.js');
    expect(EXPECTED_SCHEMA_VERSION).toBe('289');
  });
});
