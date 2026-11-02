import assert from 'node:assert/strict';
import {describe, it, beforeEach, afterEach} from 'node:test';
import {chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {nativeWorktreeFixture, WORKTREE_MANAGE} from './fixtures/native-worktree-fixture.mjs';

describe('worktree cleanup计数与create上限不误删', () => {
  let fixture;
  beforeEach(() => {
    fixture = nativeWorktreeFixture();
    writeFileSync(join(fixture.bin, 'gh'), `#!/bin/sh
head=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--head" ]; then head="$2"; fi
  shift
done
if [ -n "\${FAKE_MERGED_BRANCH:-}" ] && [ "$head" = "$FAKE_MERGED_BRANCH" ]; then echo 4242; fi
`);
    chmodSync(join(fixture.bin, 'gh'), 0o755);
  });
  afterEach(() => fixture.dispose());
  function add(branch) {
    const path = join(fixture.worktrees, branch);
    fixture.git('worktree', 'add', '-q', '-b', branch, path);
    return path;
  }
  it('两个未合并worktree保持存在，计数从0递增不中断', () => {
    const a = add('cp-unmerged-a'), b = add('cp-unmerged-b');
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'cleanup']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /清理完成：移除 0 个，跳过 2 个/);
    assert.equal(existsSync(a), true); assert.equal(existsSync(b), true);
  });
  it('仅移除已合并worktree和分支，计数完成后继续保留未合并对象', () => {
    const merged = add('cp-merged-x'), unmerged = add('cp-unmerged-y');
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'cleanup'], {FAKE_MERGED_BRANCH: 'cp-merged-x'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /清理完成：移除 1 个，跳过 1 个/);
    assert.equal(existsSync(merged), false); assert.equal(existsSync(unmerged), true);
    assert.equal(fixture.git('branch', '--list', 'cp-merged-x'), '');
    assert.ok(fixture.git('branch', '--list', 'cp-unmerged-y').includes('cp-unmerged-y'));
  });
  for (const state of ['clean', 'dirty']) it(`create达到上限不清理${state}已合并worktree或分支`, () => {
    writeFileSync(join(fixture.repo, 'tracked.txt'), 'original\n');
    fixture.git('add', 'tracked.txt'); fixture.git('commit', '-qm', 'tracked');
    const wt = add('cp-merged-preserve');
    if (state === 'dirty') { writeFileSync(join(wt, 'tracked.txt'), 'unsaved change\n'); writeFileSync(join(wt, 'untracked.txt'), 'untracked evidence\n'); }
    const trees = fixture.git('worktree', 'list', '--porcelain'), branches = fixture.git('show-ref', '--heads');
    const tracked = readFileSync(join(wt, 'tracked.txt'), 'utf8');
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'create', 'blocked-create'], {MAX_WORKTREES: '1', FAKE_MERGED_BRANCH: 'cp-merged-preserve'});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /数量已达上限/);
    assert.equal(fixture.git('worktree', 'list', '--porcelain'), trees);
    assert.equal(fixture.git('show-ref', '--heads'), branches);
    assert.equal(readFileSync(join(wt, 'tracked.txt'), 'utf8'), tracked);
    if (state === 'dirty') assert.equal(readFileSync(join(wt, 'untracked.txt'), 'utf8'), 'untracked evidence\n');
  });
});
