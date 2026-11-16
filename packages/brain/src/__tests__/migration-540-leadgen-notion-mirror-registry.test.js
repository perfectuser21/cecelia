/** 迁移 540（任务 f6ad056e，决策 a029a7a7）：获客·视频/评论/线索三张 Notion 镜子库登记进注册表。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = readFileSync(fileURLToPath(new URL('../../migrations/540_leadgen_notion_mirror_registry.sql', import.meta.url)), 'utf8');
const down = readFileSync(fileURLToPath(new URL('../../migrations/rollback/540_leadgen_notion_mirror_registry.down.sql', import.meta.url)), 'utf8');
const registrations = [...up.matchAll(/\('([^']+)', '[^']+', '([^']+)', (NULL|'[^']+'), '([^']+)',\s*'[^']+', '([^']+)',/g)];

describe('migration 540 获客镜子库登记', () => {
  it('外部业务库以 mirror/push/active 登记，brain_table 为空（真身在 hk-vps zenithjoy 库，不在 cecelia）', () => {
    expect(registrations.length).toBeGreaterThan(0);
    for (const row of registrations) expect(row.slice(2)).toEqual(['mirror', 'NULL', 'push', 'active']);
  });

  it('重跑空操作（ON CONFLICT DO NOTHING 走唯一索引）', () => {
    expect(up).toMatch(/ON CONFLICT DO NOTHING;/);
  });

  it('回滚只删本迁移登记，不碰别的注册表行', () => {
    const rollbackIds = [...down.matchAll(/'([0-9a-f-]{36})'/g)].map(m => m[1]);
    expect(rollbackIds.sort()).toEqual(registrations.map(row => row[1]).sort());
    expect(down).toMatch(/brain_table IS NULL/);
  });
});
