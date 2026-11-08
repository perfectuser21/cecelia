import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {commandsFor} from '../run-basic-check.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const reports = ['quality-summary.json', 'packages/brain/quality-summary.json'];
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(cwd, args) {
  const result = spawnSync('git', args, {cwd, env, encoding: 'utf8', timeout: 10000});
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

test('单批质量统计生成物不能作为当前源码中的已跟踪输入', () => {
  const result = git(root, ['ls-files', '--cached', '--', ...reports]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', '旧质量快照仍在Git索引；历史由旧Git对象保留');
});

test('当前gitignore精确忽略两份质量生成物，不吞掉其它目录或运行时协议', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cecelia-quality-summary-ignore-'));
  try {
    assert.equal(git(directory, ['-c', 'init.templateDir=', 'init', '--quiet']).status, 0);
    writeFileSync(join(directory, '.gitignore'), readFileSync(join(root, '.gitignore')));
    for (const path of reports) {
      const result = git(directory, ['check-ignore', '--no-index', '--', path]);
      assert.equal(result.status, 0, `目标未被当前规则忽略：${path}`);
      assert.equal(result.stdout.trim(), path);
    }
    for (const path of ['apps/api/quality-summary.json', 'quality-summary.input.json', '.runtime/host-disk.json']) {
      const result = git(directory, ['check-ignore', '--no-index', '--', path]);
      assert.equal(result.status, 1, `忽略范围扩到了独立输入：${path}`);
      assert.equal(result.stdout, '');
    }
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('实际默认Scripts集合收录质量生成物永久回归', () => {
  assert.ok(commandsFor('scripts').some(step => step.command === 'node'
    && step.args.includes('scripts/ci/__tests__/basic-quality-summary-generated.test.mjs')));
});
