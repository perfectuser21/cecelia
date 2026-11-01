import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 已知历史来源机制 fixture；不能据此认领当前候选或授予发布资格。
const FIXTURE_REVISION = 'a68df7e48781bc38875d8581249049f57c4fe5de';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
export const fixtureGit = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
  cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});

export function readFixedExistingOpsGitFixture(revision = FIXTURE_REVISION) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('fixed Git fixture requires a full commit SHA');
  if (fixtureGit('rev-parse', '--verify', `${revision}^{commit}`).trim() !== revision) {
    throw Error('fixed Git fixture commit identity mismatch');
  }
  const tree = fixtureGit('rev-parse', `${revision}^{tree}`).trim();
  const entries = fixtureGit('ls-tree', '-rz', '--full-tree', revision).split('\0').filter(Boolean).map(line => {
    const [meta, path] = line.split('\t'), [mode, type, sha] = meta.split(' ');
    return { path, mode, type, sha };
  });
  const cache = new Map();
  const read = path => {
    if (!cache.has(path)) cache.set(path, fixtureGit('show', `${revision}:${path}`));
    return cache.get(path);
  };
  return { revision, tree, entries, paths: entries.map(entry => entry.path), read };
}
