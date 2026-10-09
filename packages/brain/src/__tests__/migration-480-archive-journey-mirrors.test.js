/**
 * 迁移 480 结构断言（决策 24a37029，任务 6ae72edd）：AI Journey / AI Feature 两镜子库停推。
 * 两库 2026-09-19 进 Notion 回收站（GET 200、写入 404），Brain 每 5 分钟推失败刷日志一周无人知；
 * 承诺地图已由「承诺地图格子」承载（迁移 479），主理人拍板：停推，不恢复不重建。
 * 归档写法照 479：status archived + direction none；notes 写明原因与决策号；幂等。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/480_archive_journey_mirrors.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/480_archive_journey_mirrors.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';

describe('migration 480', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('AI Journey 登记行归档：archived + none', () => {
    expect(sql).toMatch(new RegExp(`UPDATE notion_projection_map[\\s\\S]*status = 'archived'[\\s\\S]*direction = 'none'[\\s\\S]*WHERE notion_db_id = '${JOURNEY_DB}' AND brain_table = 'journeys'`));
  });

  it('AI Feature 登记行归档：archived + none', () => {
    expect(sql).toMatch(new RegExp(`UPDATE notion_projection_map[\\s\\S]*status = 'archived'[\\s\\S]*direction = 'none'[\\s\\S]*WHERE notion_db_id = '${FEATURE_DB}' AND brain_table = 'journey_features'`));
  });

  it('notes 写明回收站原因与决策 24a37029；不清 journeys/journey_features 记账列', () => {
    expect(sql).toMatch(/notes\s*=/);
    expect(sql).toContain('24a37029');
    expect(sql).toMatch(/回收站/);
    expect(sql).not.toMatch(/UPDATE journeys\s/);
    expect(sql).not.toMatch(/UPDATE journey_features\s/);
  });

  it('登记 schema_version 480（幂等）', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'480'[\s\S]*ON CONFLICT \(version\) DO NOTHING/);
  });

  it('回滚：两行还原 push/active（回到"已知坏"状态）、删 schema_version 480', () => {
    expect(downSql).toMatch(new RegExp(`UPDATE notion_projection_map[\\s\\S]*status = 'active'[\\s\\S]*direction = 'push'[\\s\\S]*WHERE notion_db_id = '${JOURNEY_DB}'`));
    expect(downSql).toMatch(new RegExp(`UPDATE notion_projection_map[\\s\\S]*status = 'active'[\\s\\S]*direction = 'push'[\\s\\S]*WHERE notion_db_id = '${FEATURE_DB}'`));
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '480'/);
  });
});
