/**
 * 守卫（树+仓库 v3.0 第 6 刀，任务 49d057f1）：journeys 是迁移 520 留下的空壳父表，价值流 / 能力是它的两张继承子表。
 * 生产代码里的 SQL 必须直接读写 value_streams / capabilities，不得再碰父表（父表之后拆继承、改只读视图，仍碰它的读者会随之失效）。
 * 混查两种节点的地方统一用 src/lib/tree-nodes-sql.js 的片段；允许出现的 journeys：注释、迁移文件、变量名。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = [
  fileURLToPath(new URL('../', import.meta.url)),
  fileURLToPath(new URL('../../../../scripts/ci/', import.meta.url)),
  fileURLToPath(new URL('../../scripts/', import.meta.url)),
];
const SQL_PARENT = /\b(FROM|JOIN|INTO|UPDATE|TABLE|EXISTS|DELETE\s+FROM|REFERENCES|LIKE)\s+(?:ONLY\s+)?(?:public\.)?journeys\b/i;
const QUALIFIER = /\bjourneys\.(?!(?:js|mjs|cjs|sh|md|json)\b)(?=[a-z_*])/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (['__tests__', 'node_modules', 'migrations', 'fixtures'].includes(name)) continue;
      walk(p, out);
    } else if (/\.(js|mjs|cjs|sh)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}
// 注释，以及 smoke 里 `[/正则/, '说明']` 这种检查历史迁移文本的行（不是对库的查询）
const isComment = (line) => /^\s*(\/\/|\*|\/\*|#|--|\[\/)/.test(line);
export function parentJourneysLines(source) {
  return source.split('\n').map((text, i) => ({ text, n: i + 1 }))
    .filter(({ text }) => !isComment(text) && (SQL_PARENT.test(text) || (QUALIFIER.test(text) && /(RETURNING|WHERE|\bSET\b|ON CONFLICT|COALESCE|EXCLUDED)/.test(text))));
}

describe('生产代码 SQL 不碰 journeys 空壳父表', () => {
  it('守卫能抓到父表：合成行必须被识别（proven-to-fire）', () => {
    expect(parentJourneysLines('const q = `SELECT * FROM journeys WHERE id=$1`;')).toHaveLength(1);
    expect(parentJourneysLines('LEFT JOIN journeys j ON j.id = f.journey_id')).toHaveLength(1);
    expect(parentJourneysLines('INSERT INTO journeys (name) VALUES ($1)')).toHaveLength(1);
    expect(parentJourneysLines("UPDATE public.journeys SET name=$1 WHERE id=$2")).toHaveLength(1);
    expect(parentJourneysLines("psql -c \"SELECT count(*) FROM ONLY journeys\"")).toHaveLength(1);
    expect(parentJourneysLines('// FROM journeys 只在注释里')).toHaveLength(0);
    expect(parentJourneysLines('const journeys = (await db.query(sql)).rows;')).toHaveLength(0);
    expect(parentJourneysLines('SELECT * FROM value_streams v JOIN capabilities c ON c.parent_journey_id=v.id')).toHaveLength(0);
    expect(parentJourneysLines("router.get('/journeys', handler)")).toHaveLength(0);
    expect(parentJourneysLines('grep -q "WHERE x" packages/brain/src/routes/journeys.js')).toHaveLength(0);
    expect(parentJourneysLines("[/REFERENCES journeys\\(id\\)/, 'capability_id → journeys'],")).toHaveLength(0);
  });

  it('packages/brain/src、packages/brain/scripts（含 smoke）、scripts/ci 的非测试代码里没有读写 journeys 父表的 SQL', () => {
    const offenders = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        for (const { text, n } of parentJourneysLines(readFileSync(file, 'utf8'))) offenders.push(`${file.split('/cecelia')[1] ?? file}:${n}  ${text.trim().slice(0, 100)}`);
      }
    }
    expect(offenders, `这些行还在碰 journeys 父表：\n${offenders.join('\n')}`).toEqual([]);
  });
});
