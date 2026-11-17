import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { commandsFor } from '../run-basic-check.mjs';

const entry = 'src/__tests__/integration/workflow-common-terminal.pg.integration.test.js';
const dependency = './acceptance-classification.pg.integration.test.js';
const directory = new URL('../../../packages/brain/src/__tests__/integration/', import.meta.url);
const target = fileURLToPath(new URL(dependency, directory));
const isFile = path => existsSync(path) && lstatSync(path).isFile();
function check(source, exists = isFile) {
  const imports = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .filter(node => node.type === 'ImportDeclaration').map(node => node.source.value);
  assert.equal(imports.filter(value => value === dependency).length, 1, '验收分类回归必须唯一静态导入');
  assert.ok(exists(target), '验收分类 PG 回归文件必须存在');
}

test('验收分类13项由必需PG入口静态引入，删除导入或文件均拒绝', () => {
  const steps = commandsFor('brain-integration');
  const index = steps.findIndex(step => step.args.includes(entry));
  assert.ok(index >= 0);
  assert.equal(steps[index].ciScratchDatabase, true);
  assert.ok(steps[index].args.includes('../../scripts/ci/deep-integration.config.mjs'));
  assert.ok(!steps[index].args.includes('--passWithNoTests'));
  const migration = steps.findIndex(step => step.args.includes('src/migrate.js'));
  assert.ok(migration >= 0 && migration < index);
  const source = readFileSync(new URL('workflow-common-terminal.pg.integration.test.js', directory), 'utf8');
  check(source);
  assert.throws(() => check(source.replace(`import '${dependency}';`, '')));
  assert.throws(() => check(source, path => path !== target && isFile(path)));
});
