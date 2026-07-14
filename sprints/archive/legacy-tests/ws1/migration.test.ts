/**
 * WS1 TDD Red Phase — initiative_run_events DB migration
 * 迁移文件尚未创建，以下所有 test 应 FAIL
 * Generator 执行 migration 后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../');
const MIGRATION_FILE = join(REPO_ROOT, 'packages/brain/src/db/migrations/010-initiative-run-events.sql');

describe('WS1 — initiative_run_events migration [BEHAVIOR]', () => {
  it('migration 文件存在', () => {
    expect(existsSync(MIGRATION_FILE), `文件不存在: ${MIGRATION_FILE}`).toBe(true);
  });

  it('DDL 包含 CREATE TABLE initiative_run_events', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toContain('CREATE TABLE initiative_run_events');
  });

  it('DDL 包含 event_id UUID PRIMARY KEY', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toMatch(/event_id\s+UUID.*PRIMARY KEY/i);
  });

  it('DDL 包含 initiative_id UUID NOT NULL 列', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toContain('initiative_id');
    expect(content).toMatch(/initiative_id\s+UUID\s+NOT NULL/i);
  });

  it('DDL 包含 node CHECK 约束枚举值', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toContain('planner');
    expect(content).toContain('proposer');
    expect(content).toContain('reviewer');
    expect(content).toContain('generator');
    expect(content).toContain('evaluator');
    expect(content).toContain('report');
  });

  it('DDL 包含 status CHECK 约束枚举值（含 failed，禁用 in_progress）', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toContain('pending');
    expect(content).toContain('running');
    expect(content).toContain('completed');
    expect(content).toContain('failed');
    // 不应包含禁用别名
    expect(content).not.toContain('in_progress');
    expect(content).not.toContain("'done'");
  });

  it('DDL 包含复合索引 (initiative_id, created_at)', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toContain('initiative_id');
    expect(content).toContain('created_at');
    expect(content).toMatch(/CREATE INDEX.*initiative_run_events/i);
  });
});
