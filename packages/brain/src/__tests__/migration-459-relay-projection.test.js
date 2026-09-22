import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 459 接力棒投影注册表', () => {
  it('Projects 多一根 tasks(project 根) 推送血管；「决策」库方向改 both；幂等', async () => {
    const sql = await readFile(new URL('../../migrations/459_relay_projection_registry.sql', import.meta.url), 'utf8');
    expect(sql).toContain("'d83c40c2-ba63-8323-8dc7-01cc291c4d9b','Projects','mirror','tasks','push'");
    expect(sql).toContain('notion-relay-projection.pushProjectRoots');
    expect(sql).toContain("ON CONFLICT (notion_db_id, COALESCE(brain_table, '')) DO NOTHING");
    expect(sql).toContain("SET direction = 'both'");
    expect(sql).toContain("'f93e1918-56c1-4f31-9a41-36aa76a1c9c2' AND brain_table = 'decisions'");
  });
});
