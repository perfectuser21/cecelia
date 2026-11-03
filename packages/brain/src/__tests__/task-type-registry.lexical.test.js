import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'acorn';
import { scanFile } from './helpers/task-type-registry.lexical.lib.js';

const roots = [];
const scan = source => {
  const root = mkdtempSync(join(tmpdir(), 'task-type-lexical-')); roots.push(root);
  const file = join(root, 'source.js'); writeFileSync(file, source); return scanFile(file);
};
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('task_type 守卫词法边界', () => {
  it.each([
    'export const sample = "expect.arrayContaining([\'dev\', \'review\'])";',
    'export const sample = \'const TYPES = ["dev", "review"];\';',
    'export const sample = `const TYPES = [\'dev\', \'review\']; const MAP = {dev: 1, review: 2};`;',
    'const sample = "escaped \\\" text [\'dev\', \'review\']";',
    'const sample = /[\'dev\',\'review\']/;',
  ])('源码数据不作为A/C可执行字面量：%s', source => { expect(scan(source)).toEqual([]); });
  it.each([
    "const result = `${['dev', 'review']}`;",
    "const result = `${({dev: 1, review: 2})}`;",
    "const result = `${`nested ${['dev', 'review']}`}`;",
  ])('模板插值真实代码仍命中：%s', source => { expect(scan(source)).toHaveLength(1); });
  it('字符串数据不掩盖同一文件后续真实名单，行号仍精确', () => {
    expect(scan('const sample = "[\'dev\',\'review\']";\nconst REAL = [\'dev\',\'review\'];')).toEqual(['2:REAL']);
  });
  it('SQL字面量及绑定参数小名单仍检查', () => {
    expect(scan("const q = `SELECT * FROM tasks WHERE task_type IN ('dev','review')`; ")).toEqual(['1:SQL']);
    expect(scan("const SMALL = ['pipeline_rescue'];\nconst q = `SELECT * FROM tasks WHERE task_type = ANY($1)`;\nquery(q, [SMALL]);")).toContain('1:SMALL');
  });
  it('正则中的斜线和数组内注释不破坏后续真实候选', () => {
    const source = String.raw`const pattern = /https?:\/\//;
const REAL = ['dev', /* 说明 */ 'review'];`;
    expect(scan(source)).toEqual(['2:REAL']);
  });
  it('主守卫真实导入此模块scanner，旧helper只提供walk和relPath', () => {
    const tree = parse(readFileSync(new URL('./task-type-registry.guard.test.js', import.meta.url), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const imports = tree.body.filter(n => n.type === 'ImportDeclaration');
    const scanner = imports.flatMap(n => n.specifiers.filter(s => s.local.name === 'scanFile').map(s => ({ path: n.source.value, imported: s.imported?.name })));
    expect(scanner).toEqual([{ path: './helpers/task-type-registry.lexical.lib.js', imported: 'scanFile' }]);
    const legacy = imports.find(n => n.source.value === './helpers/task-type-registry.guard.lib.js');
    expect(legacy.specifiers.map(s => s.imported.name).sort()).toEqual(['relPath', 'walk']);
  });
  it('词法错误不能静默当作空命中', () => { expect(() => scan("const x = 'unterminated")).toThrow(); });
});
