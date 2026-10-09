/**
 * 迁移 483 结构断言（任务 d852c852）：journey_steps.notion_body_digest —— Backbone Activities 页面正文指纹。
 * 行为见 activity-contract-body.test.js。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/483_backbone_body_digest.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/483_backbone_body_digest.down.sql', import.meta.url));

describe('migration 483', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });
  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
  it('加正文指纹列 + 记 schema_version', () => {
    expect(sql).toMatch(/ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS notion_body_digest text/);
    expect(sql).toMatch(/INSERT INTO schema_version \(version, description\)\s*VALUES \('483'/);
  });
});
