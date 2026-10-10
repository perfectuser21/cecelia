/** 迁移 540（任务 f6ad056e，决策 a029a7a7）：获客·视频/评论/线索三张 Notion 镜子库登记进注册表。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = readFileSync(fileURLToPath(new URL('../../migrations/540_leadgen_notion_mirror_registry.sql', import.meta.url)), 'utf8');
const down = readFileSync(fileURLToPath(new URL('../../migrations/rollback/540_leadgen_notion_mirror_registry.down.sql', import.meta.url)), 'utf8');
const DBS = ['3f5c40c2-ba63-814c-ac06-e557331075f6', '3f5c40c2-ba63-8187-a9e8-d3a4376ce622', '3f5c40c2-ba63-81bc-9613-cd71f15fdec5'];

describe('migration 540 获客镜子库登记', () => {
  it('三张库都以 mirror/push/active 登记，brain_table 为空（真身在 hk-vps zenithjoy 库，不在 cecelia）', () => {
    for (const [i, title] of ['获客·视频', '获客·评论', '获客·线索'].entries()) {
      expect(up).toMatch(new RegExp(`\\('${DBS[i]}', '${title}', 'mirror', NULL, 'push',`));
    }
    expect(up.match(/'active', 'system'/g)).toHaveLength(3);
    expect(up).toMatch(/leadgen-notion-mirror\.js/);
  });

  it('重跑空操作（ON CONFLICT DO NOTHING 走唯一索引），登记 schema_version 540', () => {
    expect(up).toMatch(/ON CONFLICT DO NOTHING;/);
    expect(up).toMatch(/INSERT INTO schema_version \(version, description\)\s*VALUES \('540'/);
  });

  it('回滚只删这三行登记与版本号，不碰别的注册表行', () => {
    for (const id of DBS) expect(down).toContain(id);
    expect(down).toMatch(/brain_table IS NULL/);
    expect(down).toMatch(/DELETE FROM schema_version WHERE version = '540'/);
  });
});
