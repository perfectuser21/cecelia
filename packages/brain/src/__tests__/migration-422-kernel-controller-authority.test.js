import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 422 Kernel Controller authority', () => {
  it('creates durable sessions and binds active runs to a generation', async () => {
    const sql = await readFile(
      new URL('../../migrations/422_kernel_controller_authority.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kernel_controller_sessions/i);
    expect(sql).toMatch(/generation BIGINT NOT NULL/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS controller_generation BIGINT/i);
    expect(sql).toMatch(/FOREIGN KEY \(controller_session_id\)/i);
    expect(sql).toContain("VALUES ('422'");
  });

  it('has a complete rollback including the schema marker', async () => {
    const sql = await readFile(
      new URL('../../migrations/rollback/422_kernel_controller_authority.down.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('DROP TABLE IF EXISTS kernel_controller_sessions');
    expect(sql).toContain("DELETE FROM schema_version WHERE version = '422'");
  });
});
