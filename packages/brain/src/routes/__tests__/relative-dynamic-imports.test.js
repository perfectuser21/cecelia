import {describe, expect, it} from 'vitest';
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {parse} from 'acorn';

// 仅静态读取当前routes JS；Node解析文件身份，不import/require执行目标模块。
function inspect(root) {
  const errors = [], imports = [];
  let parsed = 0;
  function walk(node, file) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportExpression' && typeof node.source?.value === 'string' && node.source.value.startsWith('.')) {
      const specifier = node.source.value;
      try {
        const literal = fileURLToPath(new URL(specifier, pathToFileURL(file)));
        const target = createRequire(pathToFileURL(file)).resolve(literal);
        // 禁止CJS目录index回退冒充ESM文件；允许真实Node解析后的符号链接身份。
        if (!statSync(literal).isFile()) throw Error('不是可导入文件');
        imports.push({file, specifier, target});
      } catch (error) {errors.push({file, line: node.loc.start.line, specifier, error: error.message});}
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) walk(child, file);
      else if (value && typeof value === 'object') walk(value, file);
    }
  }
  function scan(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (entry.name === '__tests__') continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.name.endsWith('.js')) {
        try {walk(parse(readFileSync(file, 'utf8'), {ecmaVersion: 'latest', sourceType: 'module', locations: true}), file); parsed++;}
        catch (error) {errors.push({file, error: error.message});}
      }
    }
  }
  scan(root);
  return {errors, imports, parsed};
}
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'owned-route-import-'));
  try {return run(directory);} finally {rmSync(directory, {recursive: true, force: true});}
}

describe('现役route字面量相对动态import身份契约', () => {
  it('当前真实routes必须全部解析，不执行目标模块或纳入冻结历史', () => {
    const result = inspect(fileURLToPath(new URL('../', import.meta.url)));
    expect(result.parsed).toBeGreaterThan(0); expect(result.imports.length).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });
  it('真实Node解析已有文件不会执行其顶层代码；模板动态路径不伪作已验', () => fixture(directory => {
    writeFileSync(join(directory, 'target.js'), `throw Error('禁止执行目标模块');`);
    writeFileSync(join(directory, 'route.js'), "const load = () => import('./target.js'); const dynamic = name => import(`./${name}.js`);");
    const result = inspect(directory);
    expect(result.errors).toEqual([]); expect(result.imports).toHaveLength(1); expect(result.imports[0].target).toBe(realpathSync(join(directory, 'target.js')));
  }));
  it('真实Node拒绝缺文件，不能因import只存在于未调用handler而假绿', () => fixture(directory => {
    writeFileSync(join(directory, 'route.js'), "const handler = async () => import('./missing.js');");
    const result = inspect(directory);
    expect(result.errors).toHaveLength(1); expect(result.errors[0]).toMatchObject({specifier: './missing.js', line: 1});
  }));
  it('语法错误必须成为门禁失败，不能静默漏扫', () => fixture(directory => {
    writeFileSync(join(directory, 'route.js'), 'export const broken = ;');
    const result = inspect(directory);
    expect(result.parsed).toBe(0); expect(result.errors).toHaveLength(1);
  }));
});
