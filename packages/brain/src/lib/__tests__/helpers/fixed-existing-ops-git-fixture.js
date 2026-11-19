import {readExistingOpsGitTree} from './read-existing-ops-git-tree.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 已知历史来源机制 fixture；不能据此认领当前候选或授予发布资格。
const FIXTURE_REVISION = 'a68df7e48781bc38875d8581249049f57c4fe5de';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
export const fixtureGit = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
  cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});

export function readFixedExistingOpsGitFixture(revision = FIXTURE_REVISION) {
  const snapshot=readExistingOpsGitTree(fixtureGit,revision);
  try { fixtureGit('merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main'); }
  catch { throw Error('fixed Git fixture must be merged into origin/main'); }
  return snapshot;
}
