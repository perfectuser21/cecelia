/**
 * 守卫（树+仓库 v3.0 第 2 刀 b 段，任务 6112bbcc）：迁移 522 起 activities / activity_cells / warehouse_items 是物理表，
 * journey_steps / journey_step_links / enablers 只是兼容视图。生产代码里的 SQL 必须写标准名，不得再往旧名视图读写。
 * 允许的旧名出现：注释、API 路径（/journey_steps 等对外端点）、Notion 注册表键（notion_projection_map.brain_table，Notion 对齐那刀再改）、迁移文件，
 * 以及 RENAME TO（重放 511/513 等旧迁移期间把 activities 临时叫回旧名，implementation-snapshot 的 scratch 就这么做）。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = [
  fileURLToPath(new URL('../', import.meta.url)),
  fileURLToPath(new URL('../../../../scripts/ci/', import.meta.url)),
];
const OLD = 'journey_steps|journey_step_links|enablers';
const SQL_OLD = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE|EXISTS|DELETE\\s+FROM|REFERENCES)\\s+(?:public\\.)?(${OLD})\\b`, 'i');
const QUALIFIER = new RegExp(`\\b(${OLD})\\.(?=[a-z_*])`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (['__tests__', 'node_modules', 'migrations', 'fixtures'].includes(name)) continue;
      walk(p, out);
    } else if (/\.(js|mjs|cjs)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}
const isComment = (line) => /^\s*(\/\/|\*|\/\*|#)/.test(line);
export function legacySqlLines(source) {
  return source.split('\n').map((text, i) => ({ text, n: i + 1 }))
    .filter(({ text }) => !isComment(text) && !/RENAME TO/.test(text) && (SQL_OLD.test(text) || (QUALIFIER.test(text) && /(RETURNING|WHERE|\bSET\b|ON CONFLICT|COALESCE|EXCLUDED)/.test(text))));
}

describe('生产代码 SQL 只写标准表名', () => {
  it('守卫能抓到旧名：合成行必须被识别（proven-to-fire）', () => {
    expect(legacySqlLines('const q = `SELECT * FROM journey_steps WHERE id=$1`;')).toHaveLength(1);
    expect(legacySqlLines('await db.query("UPDATE journey_step_links SET cell_status=$1")')).toHaveLength(1);
    expect(legacySqlLines('JOIN enablers e ON e.id=c.enabler_id')).toHaveLength(1);
    expect(legacySqlLines('  promise=COALESCE(EXCLUDED.promise, journey_steps.promise),')).toHaveLength(1);
    expect(legacySqlLines('// FROM journey_steps 只在注释里')).toHaveLength(0);
    expect(legacySqlLines("await c.query('ALTER TABLE journey_steps RENAME TO activities')")).toHaveLength(0);
    expect(legacySqlLines("router.get('/journey_steps', handler)")).toHaveLength(0);
    expect(legacySqlLines('SELECT * FROM activities a JOIN activity_cells c ON c.step_id=a.id')).toHaveLength(0);
  });

  it('packages/brain/src 与 scripts/ci 的非测试代码里没有往旧名视图读写的 SQL', () => {
    const offenders = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        for (const { text, n } of legacySqlLines(readFileSync(file, 'utf8'))) offenders.push(`${file.split('/cecelia')[1] ?? file}:${n}  ${text.trim().slice(0, 100)}`);
      }
    }
    expect(offenders, `这些行还在用旧名视图：\n${offenders.join('\n')}`).toEqual([]);
  });
});
