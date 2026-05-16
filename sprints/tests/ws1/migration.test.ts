/**
 * WS1: DB Migration — initiative_run_events 表
 * TDD Red: 测试 migration 文件存在且 DDL 符合 PRD schema
 * Generator 创建 packages/brain/migrations/276_initiative_run_events.sql 后变 Green
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATION_PATH = resolve('packages/brain/migrations/276_initiative_run_events.sql');

describe('Workstream 1 — DB Migration [BEHAVIOR]', () => {
  it('[ARTIFACT] migration 文件 276_initiative_run_events.sql 存在', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('[ARTIFACT] migration 包含 CREATE TABLE initiative_run_events', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toContain('CREATE TABLE initiative_run_events');
  });

  it('[ARTIFACT] migration DDL 包含 id uuid PRIMARY KEY（PRD: id 非 event_id）', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toMatch(/\bid\b.*uuid.*PRIMARY KEY|PRIMARY KEY.*gen_random_uuid/i);
    expect(sql).not.toMatch(/\bevent_id\b.*PRIMARY KEY/);
  });

  it('[ARTIFACT] migration DDL 包含 initiative_id uuid NOT NULL', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toContain('initiative_id');
    expect(sql).toMatch(/initiative_id\s+uuid\s+NOT NULL/i);
  });

  it('[ARTIFACT] migration DDL 包含 node varchar NOT NULL', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toMatch(/node\s+varchar/i);
    expect(sql).toMatch(/node.*NOT NULL/i);
  });

  it('[ARTIFACT] migration DDL 包含 status varchar NOT NULL', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toMatch(/status\s+varchar/i);
    expect(sql).toMatch(/status.*NOT NULL/i);
  });

  it('[ARTIFACT] migration DDL 包含 payload jsonb', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toContain('payload');
    expect(sql).toContain('jsonb');
  });

  it('[ARTIFACT] migration DDL 包含 created_at timestamptz NOT NULL DEFAULT NOW()', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toContain('created_at');
    expect(sql).toMatch(/timestamptz|timestamp with time zone/i);
    expect(sql).toMatch(/created_at.*NOT NULL/i);
  });

  it('[ARTIFACT] migration 包含复合索引 (initiative_id, created_at)', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(sql).toContain('CREATE INDEX');
    expect(sql).toMatch(/initiative_id.*created_at|created_at.*initiative_id/);
  });

  it('[BEHAVIOR] migration 不含额外 CHECK 约束（PRD DDL 无 CHECK）', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    const checkCount = (sql.match(/CHECK\s*\(/gi) || []).length;
    expect(checkCount).toBe(0);
  });
});
