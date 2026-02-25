/**
 * 提案系统 Migration 054 验证测试
 * 覆盖：SQL 文件存在性、字段和索引定义
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(__dirname, '../../migrations/054_inbox_proposal_system.sql');

describe('Migration 054: Inbox 提案系统', () => {
  it('migration 文件存在', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  const sql = existsSync(MIGRATION_PATH) ? readFileSync(MIGRATION_PATH, 'utf-8') : '';

  it('包含 6 个新列定义', () => {
    const columns = ['category', 'comments', 'options', 'priority', 'source', 'signature'];
    for (const col of columns) {
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\s+`, 'i'));
    }
  });

  it('category 默认值为 approval', () => {
    expect(sql).toMatch(/category\s+TEXT\s+DEFAULT\s+'approval'/i);
  });

  it('comments 默认值为空 JSONB 数组', () => {
    expect(sql).toMatch(/comments\s+JSONB\s+DEFAULT\s+'\[\]'::jsonb/i);
  });

  it('options 默认值为 NULL', () => {
    expect(sql).toMatch(/options\s+JSONB\s+DEFAULT\s+NULL/i);
  });

  it('priority 默认值为 normal', () => {
    expect(sql).toMatch(/priority\s+TEXT\s+DEFAULT\s+'normal'/i);
  });

  it('包含 inbox 复合索引', () => {
    expect(sql).toContain('idx_pending_actions_inbox');
    expect(sql).toContain('status, priority, category, created_at');
  });

  it('包含 signature 部分索引', () => {
    expect(sql).toContain('idx_pending_actions_signature');
    expect(sql).toContain('WHERE signature IS NOT NULL');
  });

  it('包含 schema_version 更新', () => {
    expect(sql).toContain("INSERT INTO schema_version");
    expect(sql).toContain("'054'");
  });
});
