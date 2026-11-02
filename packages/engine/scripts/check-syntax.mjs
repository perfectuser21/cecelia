import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
function collect(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (['tests', '__tests__', 'node_modules'].includes(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.isFile() && (/\.(?:sh|[cm]?js)$/.test(entry.name) || file === 'hooks/pre-commit')) files.push(file);
  }
}
for (const directory of ['hooks', 'runners', 'scripts', 'lib', 'skills/dev/scripts', 'src/harness', 'ci/scripts']) collect(directory);
files.push('skill-loader.cjs');
if (!files.some(file => file.endsWith('.sh')) || !files.some(file => /\.[cm]?js$/.test(file))) {
  throw new Error('Engine脚本语法检查集合不完整');
}
for (const file of files.sort()) {
  const shell = file.endsWith('.sh') || file === 'hooks/pre-commit';
  const result = spawnSync(shell ? 'bash' : process.execPath, [shell ? '-n' : '--check', join(root, file)], { encoding: 'utf8' });
  if (result.error || result.signal || result.status !== 0) {
    process.stderr.write(`Engine语法检查失败：${relative(root, join(root, file))}\n`);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    process.exit(result.status || 1);
  }
}
process.stdout.write(`Engine脚本语法检查通过：${files.length}个真实文件\n`);
