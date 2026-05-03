import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static analysis test: verify that all revert-to-queued SQL in routes/tasks.js
// includes claimed_by = NULL (fix for dispatch deadlock bug)
describe('routes/tasks.js — revert-to-queued SQL invariant', () => {
  const src = readFileSync(
    join(__dirname, '../tasks.js'),
    'utf8'
  );

  it("所有 SET status = 'queued' UPDATE 语句都包含 claimed_by = NULL", () => {
    const blocks = src.split(/SET\s+status\s*=\s*'queued'/).slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const upToWhere = block.split(/\bWHERE\b/)[0];
      expect(upToWhere, `SET status=queued block missing claimed_by = NULL`).toContain('claimed_by = NULL');
    }
  });

  it("所有 SET status = 'queued' UPDATE 语句都包含 claimed_at = NULL", () => {
    const blocks = src.split(/SET\s+status\s*=\s*'queued'/).slice(1);
    for (const block of blocks) {
      const upToWhere = block.split(/\bWHERE\b/)[0];
      expect(upToWhere, `SET status=queued block missing claimed_at = NULL`).toContain('claimed_at = NULL');
    }
  });
});
