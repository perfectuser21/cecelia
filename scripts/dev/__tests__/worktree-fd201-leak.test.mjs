import assert from 'node:assert/strict';
import {describe, it, beforeEach, afterEach} from 'node:test';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {basename, join} from 'node:path';
import {nativeWorktreeFixture, WORKTREE_MANAGE, worktreePathFromOutput} from './fixtures/native-worktree-fixture.mjs';

describe('worktree FD201与真实guardian', () => {
  let fixture;
  beforeEach(() => { fixture = nativeWorktreeFixture(); });
  afterEach(() => fixture.dispose());
  function create(name, overrides = {}) {
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'create', name], overrides);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return worktreePathFromOutput(result.stdout);
  }
  it('显式WORKTREE_BASE不向隔离HOME的默认worktrees泄漏', () => {
    const path = create('first');
    assert.equal(path, join(fixture.worktrees, basename(fixture.repo), 'first'));
    assert.equal(existsSync(path), true);
    assert.equal(existsSync(join(fixture.home, 'worktrees')), false);
  });
  it('真实guardian存活时FD201已经释放，锁可重取且第二次create成功', () => {
    create('first');
    const lights = fixture.guardians();
    assert.equal(lights.length, 1);
    const owner = fixture.run('ps', ['-p', String(lights[0].guardian_pid), '-o', 'args=']);
    assert.equal(owner.status, 0, owner.stderr);
    assert.ok(owner.stdout.includes(join(fixture.repo, '.cecelia/hb.sh')));
    const relock = fixture.run('flock', ['-n', join(fixture.repo, '.git/worktree-create.lock'), 'true']);
    assert.equal(relock.status, 0, relock.stderr);
    assert.equal(create('second'), join(fixture.worktrees, basename(fixture.repo), 'second'));
    assert.equal(fixture.guardians().length, 2);
  });
  it('真实Python禁写bytecode，guardian退出前不重建HOME缓存', () => {
    const result = fixture.run('python3', ['-c', 'import json, sys; print(int(sys.dont_write_bytecode))']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '1');
    assert.equal(existsSync(join(fixture.home, 'Library/Caches/Python')), false);
  });
  it('create将服务端routing identity与session写进真实worktree锁', () => {
    const path = create('identity', {CLAUDE_SESSION_ID: 'private-owner', CECELIA_TASK_ID: 'task-1',
      CECELIA_ROUTING_RECEIPT_ID: 'receipt-1', CECELIA_RUN_ID: 'run-1', CECELIA_REPO: 'private-repo',
      CECELIA_BASE_SHA: fixture.git('rev-parse', 'HEAD')});
    const locks = readdirSync(path).filter(name => name.startsWith('.dev-lock.'));
    assert.equal(locks.length, 1);
    const lock = JSON.parse(readFileSync(join(path, locks[0]), 'utf8'));
    assert.equal(lock.owner_session, 'private-owner');
    assert.equal(lock.worktree_path, path);
    assert.equal(lock.task_id, 'task-1');
    assert.equal(lock.routing_receipt_id, 'receipt-1');
    assert.equal(lock.run_id, 'run-1');
    assert.equal(lock.base_sha, fixture.git('rev-parse', 'HEAD'));
    assert.match(lock.branch, /^cp-/);
  });
});
