import assert from 'node:assert/strict';
import {describe, it, beforeEach, afterEach} from 'node:test';
import {writeFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {nativeWorktreeFixture, WORKTREE_MANAGE} from './fixtures/native-worktree-fixture.mjs';

describe('实际worktree session解析', () => {
  let fixture;
  beforeEach(() => {
    fixture = nativeWorktreeFixture();
    writeFileSync(join(fixture.bin, 'ps'), '#!/bin/sh\nif [ "$2" = "args=" ]; then printf "%s\\n" "$FIXTURE_PARENT_ARGS"; else echo 1; fi\n');
    chmodSync(join(fixture.bin, 'ps'), 0o755);
  });
  afterEach(() => fixture.dispose());
  function resolve(overrides) {
    const result = fixture.shell('source "$1"; _resolve_claude_session_id', [WORKTREE_MANAGE], overrides);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  it('显式session优先于父进程session', () => {
    assert.equal(resolve({CLAUDE_SESSION_ID: 'env-test-uuid-12345', FIXTURE_PARENT_ARGS: 'claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}), 'env-test-uuid-12345');
  });
  it('空session沿PPID解析真实参数中的UUID', () => {
    assert.equal(resolve({CLAUDE_SESSION_ID: '', FIXTURE_PARENT_ARGS: 'claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });
  it('session未设置且父链没有Claude时返回空', () => {
    const result = fixture.shell('unset CLAUDE_SESSION_ID; source "$1"; _resolve_claude_session_id', [WORKTREE_MANAGE], {FIXTURE_PARENT_ARGS: 'node fixture'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
  });
});
