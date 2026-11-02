import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {planChecks} from '../basic-scope.mjs';

test('Engine退役后完整CI与历史路径差分都只运行现役组件', () => {
  const full = planChecks([], {full: true});
  assert.ok(!full.some(row => row.component === 'engine'));
  assert.deepEqual(planChecks(['packages/engine/hooks/branch-protect.sh']), full);
  assert.ok(full.some(row => row.component === 'brain-unit'));
  assert.ok(full.some(row => row.component === 'scripts'));
});

test('旧Engine组件命令必须失败，不能伪装成空成功', () => {
  const cli = new URL('../run-basic-check.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, '--list', 'engine'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /未知 CI 组件/);
});
