import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function collect(directory) {
  return readdirSync(resolve(root, directory), {withFileTypes: true}).flatMap(entry => {
    if (['__tests__', 'node_modules'].includes(entry.name)) return [];
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collect(path);
    return entry.isFile() && (/\.(?:sh|[cm]?js)$/.test(path) || entry.name === 'pre-commit') ? [path] : [];
  });
}
const files = [...collect('scripts/dev'), ...collect('packages/brain/scripts/codex-bridge')].sort();
if (!files.length) throw new Error('开发工具语法检查集合为空');
for (const path of files) {
  const shell = path.endsWith('.sh') || path.endsWith('/pre-commit');
  const result = spawnSync(shell ? 'bash' : process.execPath, [shell ? '-n' : '--check', path], {cwd: root, encoding: 'utf8'});
  if (result.error || result.signal || result.status !== 0) {
    process.stderr.write(`${path}：${result.stderr || result.error || result.signal}\n`);
    process.exit(result.status || 1);
  }
}
process.stdout.write(`开发工具脚本语法检查：${files.length}个文件通过\n`);
