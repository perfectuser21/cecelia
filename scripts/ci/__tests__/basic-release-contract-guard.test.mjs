import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
const root = new URL('../../../', import.meta.url).pathname;
test('合同CLI的缺失参数和未知参数必须失败，不能按空stdin当非harness成功', () => {
  for (const args of [['--fixture'], ['--unknown']]) {
    const result = spawnSync(process.execPath, ['packages/brain/scripts/ci/contract-exists.mjs', ...args], { cwd: root, encoding: 'utf8', input: '' });
    assert.notEqual(result.status, 0, args.join(' '));
  }
});
test('合同CLI真实读取有合同、缺合同与普通编码差异', () => {
  for (const [input, success] of [['sprints/legacy/contract-draft.md\nsprints/legacy/build.js', true], ['sprints/legacy/build.js', false], ['apps/dashboard/a.tsx', true], ['sprints/20261103-cw-abcdef12/05-review.md', true]]) {
    const result = spawnSync(process.execPath, ['packages/brain/scripts/ci/contract-exists.mjs'], { cwd: root, encoding: 'utf8', input });
    assert.equal(result.status === 0, success, result.stderr);
  }
});
