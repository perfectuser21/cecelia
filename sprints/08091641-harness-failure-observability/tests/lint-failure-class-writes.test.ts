import { describe, it, expect } from 'vitest';
// 机械闸扫描器纯函数（本 sprint 新增，红阶段 import 失败）
import { scanTerminalWrites } from '../../../scripts/lint-failure-class-writes.mjs';

describe('lint-failure-class-writes scanner [BEHAVIOR]', () => {
  it('scanTerminalWrites flags terminal write missing failure_class', () => {
    const bad = `
      export async function badTerminalWrite(pool, id) {
        await pool.query("UPDATE tasks SET status='failed' WHERE id=$1", [id]);
      }
    `;
    const violations = scanTerminalWrites(bad, 'bad.mjs');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]).toMatch(/failure_class/i);
  });

  it('scanTerminalWrites passes terminal write that routes through persistTerminalFailure', () => {
    const good = `
      export async function goodTerminalWrite(pool, id) {
        await persistTerminalFailure(pool, id, 'timeout', 'detail');
      }
    `;
    const violations = scanTerminalWrites(good, 'good.mjs');
    expect(violations.length).toBe(0);
  });

  it('scanTerminalWrites passes terminal write that inlines failure_class in same statement', () => {
    const good = `
      await pool.query("UPDATE tasks SET status='failed', result = COALESCE(result,'{}'::jsonb) || jsonb_build_object('failure_class','timeout') WHERE id=$1", [id]);
    `;
    const violations = scanTerminalWrites(good, 'good2.mjs');
    expect(violations.length).toBe(0);
  });
});
