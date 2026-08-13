import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 417', () => {
  it('persists explicit Golden Path four-form and Map scope inputs', async () => {
    const sql = await readFile(
      new URL('../../migrations/417_golden_path_work_routing.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS change_kind TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS map_scope JSONB/i);
    expect(sql).toContain("'new_capability'");
    expect(sql).toContain("'capability_change'");
    expect(sql).toContain("'bugfix'");
    expect(sql).toContain("'parameter_only'");
    expect(sql).toMatch(/jsonb_typeof\(map_scope\) = 'array'/i);
    expect(sql).toContain("VALUES ('417'");
  });
});
