import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const api = join(root, 'apps/api');
const require = createRequire(join(api, 'package.json'));
const cli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

test('默认真实收集仅接收Dashboard共享features，旧Express和CLI不能混入', t => {
  const directory = mkdtempSync(join(tmpdir(), 'api-feature-collection-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const output = join(directory, 'selected.json');
  const result = spawnSync(process.execPath, [cli, 'list', '--filesOnly', `--json=${output}`], {
    cwd: api, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const selected = JSON.parse(readFileSync(output, 'utf8')).map(row => relative(api, row.file)).sort();
  const expected = readdirSync(join(api, 'features'), {recursive: true})
    .filter(path => /\.(?:test|spec)\.tsx?$/.test(path))
    .map(path => `features/${path}`).sort();
  assert.ok(expected.length > 0, '必须真实发现共享前端测试');
  assert.deepEqual(selected, expected, '默认集合必须完整保护共享前端且排除旧服务');
  for (const path of ['features/navigation.test.ts', 'features/planning/pages/capability-system/InvocationPanel.test.tsx']) {
    assert.ok(selected.includes(path), `动态manifest消费者不能丢失：${path}`);
  }
});
