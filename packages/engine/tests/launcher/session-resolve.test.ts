import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const WORKTREE_MANAGE = resolve(__dirname, '../../../../packages/engine/skills/dev/scripts/worktree-manage.sh');

function runResolve(extraEnv: Record<string, string> = {}): string {
  const bashScript = `source "${WORKTREE_MANAGE}" 2>/dev/null || { echo "SOURCE_FAIL"; exit 1; }
if ! declare -f _resolve_claude_session_id >/dev/null; then echo "NO_FUNC"; exit 1; fi
_resolve_claude_session_id
`;
  const env = { ...process.env, ...extraEnv };
  return execSync(`bash -c '${bashScript.replace(/'/g, `'"'"'`)}'`, {
    shell: '/bin/bash',
    env,
  }).toString().trim();
}

describe('Phase 7.1 _resolve_claude_session_id', () => {
  it('env var 路径：CLAUDE_SESSION_ID 有值时直接返回', () => {
    const out = runResolve({ CLAUDE_SESSION_ID: 'env-test-uuid-12345' });
    expect(out).toBe('env-test-uuid-12345');
  });

  it('env var 空串时退到 PPID fallback（test 下父 claude 无 flag → 空）', () => {
    const out = runResolve({ CLAUDE_SESSION_ID: '' });
    // 父进程是 node（vitest），cmdline 不含 --session-id → 返回空
    expect(out).toBe('');
  });

  it('env var 未设置时也走 fallback 返回空（test 环境）', () => {
    // 单独设一个干净 env 去掉 CLAUDE_SESSION_ID
    const env = { ...process.env };
    delete env.CLAUDE_SESSION_ID;
    const bashScript = `source "${WORKTREE_MANAGE}" 2>/dev/null || { echo "SOURCE_FAIL"; exit 1; }
declare -f _resolve_claude_session_id >/dev/null || { echo "NO_FUNC"; exit 1; }
_resolve_claude_session_id
`;
    const out = execSync(`bash -c '${bashScript.replace(/'/g, `'"'"'`)}'`, { shell: '/bin/bash', env }).toString().trim();
    expect(out).toBe('');
  });
});
