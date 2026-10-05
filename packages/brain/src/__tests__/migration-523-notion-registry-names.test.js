/**
 * 迁移 523（树+仓库 v3.0 第 3 刀 a 段）：Notion 注册表键改标准表名，旧混合库退役，Ops 运行图谱登记名改闹钟总账。
 * 只读 SQL 文本断言形状；真数据演练见 PR 描述（scratch 灌生产注册表跑通）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/523_notion_registry_standard_names.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/523_notion_registry_standard_names.down.sql', import.meta.url));

describe('migration 523 notion registry standard names', () => {
  const sql = readFileSync(up, 'utf8');

  it('旧键换标准键：journey_steps→activities、journey_step_links→activity_cells，先清未映射占位', () => {
    expect(sql).toMatch(/DELETE FROM notion_projection_map[\s\S]*unmapped:[\s\S]*'activities', 'activity_cells'/);
    expect(sql).toMatch(/SET brain_table = 'activities'[\s\S]*WHERE brain_table = 'journey_steps'/);
    expect(sql).toMatch(/SET brain_table = 'activity_cells'[\s\S]*WHERE brain_table = 'journey_step_links'/);
    expect(sql.indexOf('DELETE FROM notion_projection_map')).toBeLessThan(sql.indexOf("SET brain_table = 'activities'"));
  });

  it('旧「价值流与能力」混合库停推（archived/none，不删页），闹钟总账改名', () => {
    expect(sql).toMatch(/status = 'archived', direction = 'none'[\s\S]*brain_table = 'journeys' AND notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a'/);
    expect(sql).toMatch(/title = '闹钟总账'[\s\S]*notion_db_id = '3d3c40c2-ba63-815e-be8a-f5048c070d80'/);
  });

  it('旧名兼容视图仍带 notion_id 列：补未映射占位行，registry_coverage 才不报「带 notion_id 列却未登记」', () => {
    expect(sql).toMatch(/INSERT INTO notion_projection_map[\s\S]*'unmapped:journey_steps'[\s\S]*'journey_steps'[\s\S]*'archived'/);
    expect(sql).toMatch(/'unmapped:journey_step_links'[\s\S]*'journey_step_links'/);
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM notion_projection_map WHERE notion_db_id = 'unmapped:journey_steps'/);
  });

  it('页面链接表 projection_links 的实体类型随键改名（目录投影按 DIRECTORY_TABLES 查链接，不改会判「页已被占用」）', () => {
    expect(sql).toMatch(/UPDATE projection_links SET entity_type = 'activities'[\s\S]*WHERE entity_type = 'journey_steps'/);
    expect(readFileSync(down, 'utf8')).toMatch(/UPDATE projection_links SET entity_type = 'journey_steps'[\s\S]*WHERE entity_type = 'activities'/);
  });

  it('写 schema_version 523，事务包裹，有回滚文件', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'523'/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(readFileSync(down, 'utf8')).toMatch(/SET brain_table = 'journey_steps'[\s\S]*WHERE brain_table = 'activities'/);
  });
});
