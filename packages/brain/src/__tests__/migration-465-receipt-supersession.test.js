import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const upUrl = new URL('../../migrations/465_work_routing_receipt_supersession.sql', import.meta.url);
const downUrl = new URL('../../migrations/rollback/465_work_routing_receipt_supersession.down.sql', import.meta.url);

describe('migration 465 — work_routing_receipts 链式接班（anchor_generation）', () => {
  it('up/down 文件存在', () => {
    expect(existsSync(upUrl)).toBe(true);
    expect(existsSync(downUrl)).toBe(true);
  });

  it('加 anchor_generation 列，默认 1 且非空', () => {
    const upSql = readFileSync(upUrl, 'utf8');
    expect(upSql).toMatch(/ADD COLUMN IF NOT EXISTS anchor_generation integer NOT NULL DEFAULT 1/i);
  });

  it('按定义（不按名字）删旧三列唯一键，新建四列唯一键与 supersedes 唯一', () => {
    const upSql = readFileSync(upUrl, 'utf8');
    expect(upSql).toMatch(/pg_get_constraintdef\(oid\) = 'UNIQUE \(source, source_id, router_version\)'/);
    expect(upSql).toMatch(/work_routing_receipts_route_generation_unique UNIQUE \(source, source_id, router_version, anchor_generation\)/);
    expect(upSql).toMatch(/work_routing_receipts_supersedes_unique UNIQUE \(supersedes_receipt_id\)/);
    expect(upSql).toMatch(/INSERT INTO schema_version[\s\S]*'465'/);
  });

  it('down 还原三列唯一键并删列', () => {
    const downSql = readFileSync(downUrl, 'utf8');
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS work_routing_receipts_route_generation_unique/);
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS work_routing_receipts_supersedes_unique/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS anchor_generation/);
    expect(downSql).toMatch(/UNIQUE \(source, source_id, router_version\)/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '465'/);
  });
});
