/**
 * 迁移 479 结构断言（链 bf5088a3 棒4-2 跟进，决策 10a68212）：journey_step_links 镜子换库。
 * 09-27 上产实证：注册表登记的 Backbone-Step Map 库 369c… 2026-09-19 已进回收站（GET 200、写入 404），
 * 格子行 188 次 POST 全败。新库「承诺地图格子」3e8c40c2-ba63-8194-a47c-dcf5f4b508bb 建在「数据落脚总台账」页下；
 * 旧登记行归档（direction none 不再进 A10 对账）；记账列清零让 286 行重推。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/479_step_links_notion_db.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/479_step_links_notion_db.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const NEW_DB = '3e8c40c2-ba63-8194-a47c-dcf5f4b508bb';
const OLD_DB = '369c40c2-ba63-81e2-b95a-e5e3d0592676';

describe('migration 479', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('旧 Backbone-Step Map 登记行归档：status archived + direction none（不再是推送行）', () => {
    expect(sql).toMatch(new RegExp(`UPDATE notion_projection_map[\\s\\S]*status = 'archived'[\\s\\S]*direction = 'none'[\\s\\S]*WHERE notion_db_id = '${OLD_DB}' AND brain_table = 'journey_step_links'`));
  });

  it('新「承诺地图格子」库登记为 push/active，血管 pushJourneyStepLinks', () => {
    expect(sql).toMatch(new RegExp(`'${NEW_DB}',\\s*'承诺地图格子',\\s*'mirror',\\s*'journey_step_links',\\s*'push',\\s*'notion-push-sync\\.pushJourneyStepLinks',\\s*'active'`));
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('journey_step_links 记账列清零（旧 id 指向回收站页；386 种子行 synced_at 是假同步）', () => {
    expect(sql).toMatch(/UPDATE journey_step_links\s+SET notion_id = NULL, notion_digest = NULL, notion_synced_at = NULL/);
  });

  it('登记 schema_version 479', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'479'/);
  });

  it('回滚：删新登记、旧行还原 push/active、删 schema_version（记账列不回填——回收站页无从恢复）', () => {
    expect(downSql).toMatch(new RegExp(`DELETE FROM notion_projection_map WHERE notion_db_id = '${NEW_DB}'`));
    expect(downSql).toMatch(new RegExp(`UPDATE notion_projection_map[\\s\\S]*status = 'active'[\\s\\S]*direction = 'push'[\\s\\S]*WHERE notion_db_id = '${OLD_DB}'`));
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '479'/);
  });
});
