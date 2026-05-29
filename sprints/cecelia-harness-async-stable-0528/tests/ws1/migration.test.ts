import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Sprint Tests CI 从 repo root 运行；migration 在 packages/brain/migrations/
const MIGRATION_PATH = join(process.cwd(), 'packages/brain/migrations/288_harness_messages.sql');

describe('WS1 — DB Migration harness_messages [BEHAVIOR]', () => {
  it('288_harness_messages.sql 文件存在', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('migration 含 CREATE TABLE IF NOT EXISTS harness_messages', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS harness_messages');
  });

  it('migration 含 id UUID 字段（Primary Key）', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql.toLowerCase()).toMatch(/id\s+uuid/);
  });

  it('migration 含 initiative_id 字段', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('initiative_id');
  });

  it('migration 含 sub_task_id 字段', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('sub_task_id');
  });

  it('migration 含 message 字段', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('message');
  });

  it('migration 含 consumed_at 字段（可为 NULL）', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('consumed_at');
  });

  it('migration 含 created_at 字段', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('created_at');
  });

  it('migration 使用 IF NOT EXISTS（幂等）', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('IF NOT EXISTS');
  });
});
