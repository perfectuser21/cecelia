/** 迁移 543（任务 1b3c0000）：「技能工厂看板」Notion 库登记进注册表。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOARD_VESSEL } from '../skill-factory-board.js';

const up = readFileSync(fileURLToPath(new URL('../../migrations/543_skill_factory_board_registry.sql', import.meta.url)), 'utf8');
const down = readFileSync(fileURLToPath(new URL('../../migrations/rollback/543_skill_factory_board_registry.down.sql', import.meta.url)), 'utf8');
const DB = '3f5c40c2-ba63-818e-9813-dedb2576f8e5';

describe('migration 543 技能工厂看板登记', () => {
  it('以 mirror/push/active 登记，vessel 与推送代码同名（推送按 vessel 找库），brain_table 为空（看板由 tasks 派生，非一表一镜）', () => {
    expect(up).toContain(`('${DB}', '技能工厂看板', 'mirror', NULL, 'push',`);
    expect(up).toContain(`'${BOARD_VESSEL}'`);
    expect(up).toMatch(/'active', 'system'/);
  });
  it('重跑空操作，登记 schema_version 543', () => {
    expect(up).toMatch(/ON CONFLICT DO NOTHING;/);
    expect(up).toMatch(/INSERT INTO schema_version \(version, description\)\s*VALUES \('543'/);
  });
  it('回滚只删这一行登记与版本号，并清掉看板页链接', () => {
    expect(down).toContain(DB);
    expect(down).toMatch(/brain_table IS NULL/);
    expect(down).toMatch(/DELETE FROM projection_links WHERE target = 'notion-skill-factory'/);
    expect(down).toMatch(/DELETE FROM schema_version WHERE version = '543'/);
  });
});
