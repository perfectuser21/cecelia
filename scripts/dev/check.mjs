import {readdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runSteps} from '../ci/run-basic-check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function tests(directory, suffix) {
  const files = readdirSync(resolve(root, directory), {withFileTypes: true})
    .filter(entry => entry.name.endsWith(suffix)).map(entry => {
      if (!entry.isFile()) throw new Error(`开发工具测试入口必须为普通文件：${directory}/${entry.name}`);
      return `${directory}/${entry.name}`;
    }).sort();
  if (!files.length) throw new Error(`开发工具测试集合为空：${directory}/*${suffix}`);
  return files;
}

try {
  if (process.argv.length !== 2) throw new Error('开发工具检查不接受额外参数');
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  process.exitCode = runSteps([
    {command: 'node', args: ['scripts/dev/check-syntax.mjs']},
    {command: 'node', args: ['--test', ...tests('scripts/dev/__tests__', '.test.mjs')]},
    {command: 'npx', args: ['--no-install', 'vitest', 'run', '--config', 'scripts/dev/vitest.config.mjs', '--reporter=dot']},
    ...tests('scripts/dev/hooks/__tests__', '.test.sh').map(path => ({command: 'bash', args: [path]})),
  ], {cwd: root, env});
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
