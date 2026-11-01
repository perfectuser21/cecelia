import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import brain from '../../../packages/brain/vitest.config.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const glob = require('fast-glob');
const root = fileURLToPath(new URL('../../../', import.meta.url));

function constantAssertions(source, path = 'fixture.test.js') {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const found = [];
  const literal = node => node && [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NullKeyword].includes(node.kind);
  function walk(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['toBe', 'toEqual', 'toStrictEqual'].includes(node.expression.name.text)) {
      const receiver = node.expression.expression;
      if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) && receiver.expression.text === 'expect') {
        const left = receiver.arguments[0], right = node.arguments[0];
        if (literal(left) && literal(right) && left.getText(tree) === right.getText(tree)) {
          found.push(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1);
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return found;
}

test('空断言守卫识别真实字面量自比较，字符串夹具和真实调用结果不误报', () => {
  assert.deepEqual(constantAssertions('expect(true).toBe(true);'), [1]);
  assert.deepEqual(constantAssertions('expect(2).toEqual(2);\nexpect("same").toStrictEqual("same");'), [1, 2]);
  assert.deepEqual(constantAssertions('expect(real()).toBe(true);\nconst fixture = "expect(true).toBe(true)";'), []);
});

test('默认Brain与维护中组件测试不允许重新引入字面量自比较', () => {
  const files = new Set([
    ...glob.sync(brain.test.include, { cwd: `${root}packages/brain`, ignore: brain.test.exclude, absolute: true }),
    ...glob.sync(['apps/{api,dashboard}/**/*.{test,spec}.{ts,tsx}',
      'packages/{engine,quality,mcp-readonly}/**/*.{test,spec}.{js,ts,tsx,mjs}'],
    { cwd: root, ignore: ['**/node_modules/**', '**/dist/**'], absolute: true }),
  ]);
  assert.ok(files.size > 0, '测试清单为空不能通过');
  const errors = [];
  for (const path of files) {
    for (const line of constantAssertions(readFileSync(path, 'utf8'), path)) errors.push(`${path.slice(root.length)}:${line}`);
  }
  assert.deepEqual(errors, [], `这些断言不依赖被测行为：${errors.join(', ')}`);
});
