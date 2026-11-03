import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const entries = ['guard', 'reader-tuples'].map(name =>
  resolve(root, `packages/brain/src/__tests__/claude-channel-retired.${name}.test.js`));

test('防复活守卫的共享依赖不得导入测试入口，避免用例被重复注册', () => {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const ast = parse(readFileSync(file, 'utf8'), {ecmaVersion: 'latest', sourceType: 'module'});
    for (const node of ast.body) {
      if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) continue;
      const source = node.source?.value;
      if (!source?.startsWith('.')) continue;
      const dependency = resolve(dirname(file), source);
      assert.doesNotMatch(dependency, /\.(?:test|spec)\.[cm]?[jt]sx?$/, `${file} 导入了测试入口 ${dependency}`);
      visit(dependency);
    }
  }
  entries.forEach(visit);
});
