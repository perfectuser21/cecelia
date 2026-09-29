/**
 * 迁移 487 结构断言（决策 e00d9cc3 / 9d5fce74）：价值流镜子接线。
 *  - 记账表 notion_map_node_pages（主键 scope+node_key）
 *  - notion_projection_map 登记「价值流 Value Streams」库 mirror/push/active，血管 pushMapValueStreams
 *  - 902b「产品方向（人工维护）」登记为 truth/none
 *  - 453 占位行 unmapped:value_streams 归档
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/487_notion_map_value_streams.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/487_notion_map_value_streams.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

describe('migration 487', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('建记账表 notion_map_node_pages，主键 scope+node_key', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS notion_map_node_pages/);
    for (const c of ['scope text NOT NULL', 'node_key text NOT NULL', 'notion_id text', 'notion_digest text', 'notion_synced_at timestamptz', 'archived_at timestamptz']) {
      expect(sql).toContain(c);
    }
    expect(sql).toMatch(/PRIMARY KEY \(scope, node_key\)/);
  });

  it('登记新镜子库 mirror/push/active，血管 pushMapValueStreams，真身表 map_projection_nodes', () => {
    expect(sql).toMatch(/'3eac40c2-ba63-817f-a964-f071c78cb711',\s*'价值流 Value Streams',\s*'mirror',\s*'map_projection_nodes',\s*'push',\s*'notion-map-value-streams\.pushMapValueStreams',\s*'active'/);
  });

  it('902b 登记为 truth / none（产品方向，人工维护），notes 写来历与决策 e00d9cc3', () => {
    expect(sql).toMatch(/'902b85550fb54ae0bdf89b0d7a23a3f2',\s*'产品方向（人工维护）',\s*'truth',\s*NULL,\s*'none'/);
    expect(sql).toMatch(/e00d9cc3/);
  });

  it('453 占位行 unmapped:value_streams 归档', () => {
    expect(sql).toMatch(/UPDATE notion_projection_map\s+SET status = 'archived'[\s\S]*WHERE notion_db_id = 'unmapped:value_streams'/);
  });

  it('登记 schema_version 487', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'487'/);
  });

  it('回滚：删两登记行、占位行恢复 pending_vessel、删记账表、删 schema_version', () => {
    expect(downSql).toMatch(/DELETE FROM notion_projection_map[\s\S]*3eac40c2-ba63-817f-a964-f071c78cb711/);
    expect(downSql).toMatch(/902b85550fb54ae0bdf89b0d7a23a3f2/);
    expect(downSql).toMatch(/SET status = 'pending_vessel'[\s\S]*unmapped:value_streams/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS notion_map_node_pages/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '487'/);
  });
});
