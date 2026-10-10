/** 迁移 539（决策 de6dff5d 第 5 步，任务 5bf2512a）：资源当下健康 + 状态变化历史 + 仓库物件健康汇总视图。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = readFileSync(fileURLToPath(new URL('../../migrations/539_resource_health.sql', import.meta.url)), 'utf8');
const down = readFileSync(fileURLToPath(new URL('../../migrations/rollback/539_resource_health.down.sql', import.meta.url)), 'utf8');

describe('migration 539 resource health', () => {
  it('建 resource_health：资源类型+键唯一，五态受约束，挂仓库物件（不另造设备表）', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS resource_health \(/);
    expect(up).toMatch(/UNIQUE \(resource_type, resource_key\)/);
    expect(up).toMatch(/status\s+text NOT NULL CHECK \(status IN \('healthy', 'degraded', 'offline', 'restricted', 'unknown'\)\)/);
    expect(up).toMatch(/resource_type\s+text NOT NULL CHECK \(resource_type IN \('account', 'phone', 'machine', 'warehouse_item', 'service', 'other'\)\)/);
    expect(up).toMatch(/warehouse_item_id\s+uuid REFERENCES warehouse_items\(id\) ON DELETE SET NULL/);
    for (const col of ['reason', 'evidence', 'source', 'observed_at', 'status_since']) expect(up).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    expect(up).not.toMatch(/CREATE TABLE[^;]*(devices|phones|machines)\s*\(/);
  });

  it('建 resource_health_events：状态变化历史，级联删', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS resource_health_events \(/);
    expect(up).toMatch(/resource_health_id\s+uuid NOT NULL REFERENCES resource_health\(id\) ON DELETE CASCADE/);
    expect(up).toMatch(/from_status/);
    expect(up).toMatch(/to_status/);
  });

  it('历史由触发器保证：插入与状态变化各记一条，状态不变不记；状态变化时 status_since 跟着走', () => {
    expect(up).toMatch(/CREATE TRIGGER resource_health_history AFTER INSERT OR UPDATE OF status ON resource_health/);
    expect(up).toMatch(/OLD\.status IS NOT DISTINCT FROM NEW\.status/);
    expect(up).toMatch(/CREATE TRIGGER resource_health_touch BEFORE UPDATE ON resource_health/);
    expect(up).toMatch(/NEW\.status_since := NEW\.observed_at/);
  });

  it('仓库物件健康汇总视图：最差状态 + 各态计数', () => {
    expect(up).toMatch(/CREATE OR REPLACE VIEW v_warehouse_item_health AS/);
    expect(up).toMatch(/worst_status/);
  });

  it('登记 schema_version 539，回滚脚本对称删除', () => {
    expect(up).toMatch(/INSERT INTO schema_version \(version, description\)\s*VALUES \('539'/);
    expect(down).toMatch(/DROP VIEW IF EXISTS v_warehouse_item_health/);
    expect(down).toMatch(/DROP TABLE IF EXISTS resource_health_events/);
    expect(down).toMatch(/DROP TABLE IF EXISTS resource_health\b/);
    expect(down).toMatch(/DELETE FROM schema_version WHERE version = '539'/);
  });
});
