// packages/brain/src/__tests__/reanchor-blocked-tasks-script.test.js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('scripts/reanchor-blocked-tasks.mjs', () => {
  it('只选 map_revision_mismatch 停车任务（三种 detail 形态），解锁前清零计数，支持 --dry-run', async () => {
    const source = await readFile(new URL('../../scripts/reanchor-blocked-tasks.mjs', import.meta.url), 'utf8');
    expect(source).toContain("blocked_reason = 'dispatch_fail_autoblock'");
    expect(source).toContain("blocked_detail->>'reason_code' = 'map_revision_mismatch'");
    expect(source).toContain("blocked_detail->>'last_error' = 'map_revision_mismatch'");
    expect(source).toContain("blocked_detail->>'message' LIKE '%base_sha 落后%'");
    expect(source).toContain('dispatch_fail_consecutive');
    expect(source).toContain('unblockTask(');
    expect(source).toContain("'--dry-run'");
  });
});
