import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { nativeWorktreeFixture, WORKTREE_MANAGE } from '../helpers/native-worktree-fixture';

describe('tracked _resolve_claude_session_id', () => {
  let fixture: ReturnType<typeof nativeWorktreeFixture>;
  beforeEach(() => {
    fixture = nativeWorktreeFixture();
    // PPID是外部输入；固定父链，真实解析函数完整运行，避免读取宿主Agent命令行。
    writeFileSync(join(fixture.bin, 'ps'), '#!/bin/sh\nif [ "$2" = "args=" ]; then printf "%s\\n" "$FIXTURE_PARENT_ARGS"; else echo 1; fi\n');
    chmodSync(join(fixture.bin, 'ps'), 0o755);
  });
  afterEach(() => { fixture.dispose(); });
  function resolve(overrides: Record<string, string>) {
    const result = fixture.run('bash', ['-c', 'source "$1"; _resolve_claude_session_id', 'fixture', WORKTREE_MANAGE], overrides);
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }
  it('显式session优先于父进程session', () => {
    expect(resolve({ CLAUDE_SESSION_ID: 'env-test-uuid-12345', FIXTURE_PARENT_ARGS: 'claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })).toBe('env-test-uuid-12345');
  });
  it('空session沿PPID解析真实参数中的UUID', () => {
    expect(resolve({ CLAUDE_SESSION_ID: '', FIXTURE_PARENT_ARGS: 'claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });
  it('session未设置且父链没有Claude时返回空', () => {
    const result = fixture.run('bash', ['-c', 'unset CLAUDE_SESSION_ID; source "$1"; _resolve_claude_session_id', 'fixture', WORKTREE_MANAGE], { FIXTURE_PARENT_ARGS: 'node vitest' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
