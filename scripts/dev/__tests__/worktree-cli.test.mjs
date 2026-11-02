import assert from 'node:assert/strict';
import {it} from 'node:test';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {nativeWorktreeFixture, WORKTREE_MANAGE, worktreePathFromOutput} from './fixtures/native-worktree-fixture.mjs';

it('create缺任务名必须失败并输出用法，不对Git增加worktree', () => {
  const fixture = nativeWorktreeFixture();
  try {
    const before = fixture.git('worktree', 'list', '--porcelain');
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'create']);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /task-name/);
    assert.equal(fixture.git('worktree', 'list', '--porcelain'), before);
  } finally { fixture.dispose(); }
});

it('list只读取私有真实Git仓库并输出该仓库worktree', () => {
  const fixture = nativeWorktreeFixture();
  try {
    const worktree = join(fixture.worktrees, 'listed-worktree');
    fixture.git('worktree', 'add', '-b', 'cp-list-fixture', worktree);
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'list']);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /cp-list-fixture/);
    assert.ok(fixture.git('worktree', 'list').includes(worktree));
  } finally { fixture.dispose(); }
});

it('skill实际init-or-check入口在主仓创建工作树并输出可读回的锁身份', () => {
  const fixture = nativeWorktreeFixture();
  try {
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'init-or-check', 'skill-entry']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const worktree = worktreePathFromOutput(result.stdout);
    assert.equal(worktree, join(fixture.worktrees, 'repo/skill-entry'));
    const locks = readdirSync(worktree).filter(name => name.startsWith('.dev-lock.'));
    assert.equal(locks.length, 1);
    const lock = JSON.parse(readFileSync(join(worktree, locks[0]), 'utf8'));
    assert.equal(lock.owner_session, 'native-fixture-session');
    assert.equal(lock.worktree_path, worktree);
    assert.equal(fixture.git('branch', '--show-current'), 'main');
  } finally { fixture.dispose(); }
});

it('skill实际init-or-check入口复用当前cp工作树且只补齐该工作树的lock', () => {
  const fixture = nativeWorktreeFixture();
  try {
    const worktree = join(fixture.worktrees, 'existing');
    fixture.git('worktree', 'add', '-b', 'cp-existing', worktree);
    const before = fixture.git('worktree', 'list', '--porcelain');
    const result = fixture.shell('cd "$2"; bash "$1" init-or-check existing', [WORKTREE_MANAGE, worktree]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lock = JSON.parse(readFileSync(join(worktree, '.dev-lock.cp-existing'), 'utf8'));
    assert.equal(lock.owner_session, 'native-fixture-session');
    assert.equal(lock.worktree_path, worktree);
    assert.equal(fixture.git('worktree', 'list', '--porcelain'), before);
    assert.equal(readdirSync(fixture.repo).some(name => name.startsWith('.dev-lock.')), false);
  } finally { fixture.dispose(); }
});
