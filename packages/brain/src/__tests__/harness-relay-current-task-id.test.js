/**
 * 刀C1（决策 dc18d43d）：spawn 两处 INSERT initiative_runs 必须写 current_task_id，
 * 否则 GET /relay-runs?task_id= 恒空（initiatives.js:276 已有过滤但列一直是 NULL）。
 * 源码哨兵：防止未来新增/修改 INSERT 时漏列回退。
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('C1: spawn INSERT initiative_runs 带完整身份（源码哨兵）', () => {
  it('harness-skill-relay.js 所有 INSERT initiative_runs 均含 task 与 source', async () => {
    const src = await readFile(new URL('../harness-skill-relay.js', import.meta.url), 'utf8');
    const inserts = src.match(/INSERT INTO initiative_runs[\s\S]{0,400}?VALUES/g) || [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const ins of inserts) {
      expect(ins).toMatch(/current_task_id/);
      expect(ins).toMatch(/created_source/);
    }
    expect(src.match(/'legacy_relay'/g)).toHaveLength(inserts.length);
  });
});
