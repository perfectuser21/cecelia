import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../migrations/395_workbench_projection.sql', import.meta.url), 'utf8');

describe('migration 395 — Workbench 本地主链与 projection', () => {
  it('兼容旧 dest_type/dest_id 并建立 canonical captures 列', () => {
    expect(sql).toMatch(/destination_type/i);
    expect(sql).toMatch(/destination_id/i);
    expect(sql).toMatch(/dest_type/i);
    expect(sql).toMatch(/dest_id/i);
  });

  it('建立 outbox、external link、command 三张通用表', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS projection_outbox/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS projection_links/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS projection_commands/i);
  });
});
