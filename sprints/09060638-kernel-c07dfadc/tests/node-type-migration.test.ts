import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// 本 sprint 必须新增一个 migration，把 'canvas'/'stage' 并入 map_projection_nodes.node_type CHECK。
// RED：当前无任何 migration 在 node_type 语境下含 'stage'/'canvas'（405 枚举为 8 项，无这两者）。
const migDirUrl = new URL('../../../packages/brain/migrations/', import.meta.url);

function nodeTypeMigrationsContaining(term: string): string[] {
  return readdirSync(migDirUrl)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(new URL(f, migDirUrl), 'utf8'))
    .filter((sql) => sql.includes('map_projection_nodes') && sql.includes('node_type'))
    .filter((sql) => sql.includes(term));
}

describe('node_type migration 扩展 [BEHAVIOR]', () => {
  it('migration 把 canvas 与 stage 并入 node_type CHECK 且保留既有枚举', () => {
    const canvasMigs = nodeTypeMigrationsContaining("'canvas'");
    const stageMigs = nodeTypeMigrationsContaining("'stage'");
    expect(canvasMigs.length).toBeGreaterThanOrEqual(1);
    expect(stageMigs.length).toBeGreaterThanOrEqual(1);
    // 既有枚举不得删（回归保护）——扩展 CHECK 的 migration 里仍能找到既有类型名
    const combined = [...canvasMigs, ...stageMigs].join('\n');
    for (const keep of ['value_stream', 'capability', 'feature', 'assertion']) {
      expect(combined).toContain(`'${keep}'`);
    }
  });
});
