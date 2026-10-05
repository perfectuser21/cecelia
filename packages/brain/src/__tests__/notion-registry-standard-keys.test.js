/**
 * 守卫（树+仓库 v3.0 第 3 刀 a 段）：代码里查 Notion 注册表 / 标记推送表用的键必须是标准表名。
 * 旧名视图在第 2 刀 c 段会删；键不跟着改，resolveDbId 查不到 active 行，推送静默停更。
 * 允许旧名字面量出现：对外 API 路径（routes/journeys.js）、vocab-alias 的别名表、cascade-list 的 source 标签。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTORY_TABLES } from '../projection/directory-source.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const ALLOW = new Set(['routes/journeys.js', 'vocab-alias.js', 'cascade-list.js']);
const KEY = /(resolveDbId\(\s*\w+\s*,\s*|\btable:\s*|\bbrain_table\s*=\s*)['"`](journey_steps|journey_step_links|enablers)['"`]/;

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
export function legacyRegistryKeys(source) {
  return source.split('\n').map((text, i) => ({ text, n: i + 1 })).filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text) && KEY.test(text));
}

describe('Notion 注册表键只用标准表名', () => {
  it('守卫能抓到旧键（proven-to-fire）', () => {
    expect(legacyRegistryKeys("const dbId = await resolveDbId(pool, 'journey_steps');")).toHaveLength(1);
    expect(legacyRegistryKeys("await push({ table: 'journey_step_links', dbId })")).toHaveLength(1);
    expect(legacyRegistryKeys("const dbId = await resolveDbId(pool, 'activities');")).toHaveLength(0);
    expect(legacyRegistryKeys("// table: 'journey_steps' 只在注释")).toHaveLength(0);
  });

  it('目录投影的表映射用标准名', () => {
    expect(DIRECTORY_TABLES.activities).toBe('activities');
  });

  it('src 非测试代码没有旧名注册表键', () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length);
      if (ALLOW.has(rel)) continue;
      for (const { text, n } of legacyRegistryKeys(readFileSync(file, 'utf8'))) offenders.push(`${rel}:${n}  ${text.trim().slice(0, 100)}`);
    }
    expect(offenders, `这些行还在用旧名作注册表键：\n${offenders.join('\n')}`).toEqual([]);
  });
});
