import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// 已合并main的固定祖先；只核历史字节，不执行旧Harness或算术测试。
const BASELINE = '289ddd8d0690f154006c5586926277c48e10f716';
const ROLE = '<!-- W19_HISTORICAL_FROZEN -->\n\n'
  + '> 本目录是已退休W19 Harness的历史冻结样机，不是现役业务或常规回归目标。';
const document = path => /\.md$/i.test(path);
const fail = (code, path = '') => { throw new Error(`${code}${path ? ':' + path : ''}`); };
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--root')) fail('W19_FROZEN_USAGE');

try {
  const root = realpathSync(resolve(args[1] || process.cwd()));
  const git = (...values) => execFileSync('git', values, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) fail('W19_FROZEN_GIT_ROOT');
  try { git('merge-base', '--is-ancestor', BASELINE, 'HEAD'); }
  catch { fail('W19_FROZEN_BASELINE'); }

  const frozen = new Map();
  for (const row of git('ls-tree', '-rz', BASELINE, '--', 'playground/').split('\0').filter(Boolean)) {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match) fail('W19_FROZEN_BASELINE');
    if (!document(match[3])) frozen.set(match[3], { mode: match[1], blob: match[2] });
  }
  if (!frozen.size) fail('W19_FROZEN_BASELINE');
  const tracked = new Set([...git('ls-tree', '-rz', '--name-only', 'HEAD', '--', 'playground/').split('\0'),
    ...git('ls-files', '-z', '--', 'playground/').split('\0')].filter(path => path && !document(path)));
  if (tracked.size !== frozen.size || [...tracked].some(path => !frozen.has(path))) fail('W19_FROZEN_DRIFT');
  for (const [path, expected] of frozen) {
    let stat, bytes;
    try {
      for (let parent = dirname(join(root, path)); parent !== root; parent = dirname(parent)) {
        if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) fail('W19_FROZEN_DRIFT', path);
      }
      stat = lstatSync(join(root, path));
      if (!stat.isFile()) fail('W19_FROZEN_DRIFT', path);
      bytes = readFileSync(join(root, path));
    }
    catch { fail('W19_FROZEN_DRIFT', path); }
    const mode = stat.mode & 0o111 ? '100755' : '100644';
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (mode !== expected.mode || blob !== expected.blob) fail('W19_FROZEN_DRIFT', path);
  }
  let readme;
  try {
    if (!lstatSync(join(root, 'playground/README.md')).isFile()) fail('W19_FROZEN_ROLE');
    readme = readFileSync(join(root, 'playground/README.md'), 'utf8');
  }
  catch { fail('W19_FROZEN_ROLE'); }
  if (!readme.startsWith(ROLE)) fail('W19_FROZEN_ROLE');
  console.log(`W19_FROZEN_OK: ${frozen.size} historical inputs unchanged`);
} catch (error) {
  console.error(/^W19_FROZEN_/.test(error.message) ? error.message : 'W19_FROZEN_GIT');
  process.exitCode = 1;
}
