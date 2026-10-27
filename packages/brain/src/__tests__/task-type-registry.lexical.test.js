import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanFile } from './helpers/task-type-registry.guard.lib.js';
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
  it('词法错误不能静默当作空命中', () => { expect(() => scan("const x = 'unterminated")).toThrow(); });
});
