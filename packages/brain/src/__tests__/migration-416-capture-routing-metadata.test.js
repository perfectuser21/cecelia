import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 416 capture routing metadata', () => {
  it('adds a non-null JSON routing envelope to real capture atoms', async () => {
    const sql = await readFile(
      new URL('../../migrations/416_capture_atom_routing_metadata.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toMatch(/ALTER TABLE capture_atoms/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
    expect(sql).toMatch(/jsonb_typeof\(metadata\) = 'object'/i);
  });
});
