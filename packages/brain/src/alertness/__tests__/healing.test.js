import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static analysis: all revert-to-queued SQL in healing.js must clear claimed_by
describe('alertness/healing.js — revert-to-queued SQL invariant', () => {
  const src = readFileSync(join(__dirname, '../healing.js'), 'utf8');

  it("所有 SET status = 'queued' UPDATE 语句包含 claimed_by = NULL", () => {
    // Match SET...status = 'queued' blocks (not WHERE or SELECT clauses)
    const blocks = src.split(/SET\s+status\s*=\s*'queued'/).slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const upToEnd = block.split(/\bWHERE\b/)[0];
      expect(upToEnd, 'SET status=queued block missing claimed_by = NULL').toContain('claimed_by = NULL');
    }
  });

  it("所有 SET status = 'queued' UPDATE 语句包含 claimed_at = NULL", () => {
    const blocks = src.split(/SET\s+status\s*=\s*'queued'/).slice(1);
    for (const block of blocks) {
      const upToEnd = block.split(/\bWHERE\b/)[0];
      expect(upToEnd, 'SET status=queued block missing claimed_at = NULL').toContain('claimed_at = NULL');
    }
  });
});
