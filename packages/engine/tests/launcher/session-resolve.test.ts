import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'os';

const WORKTREE_MANAGE = join(os.homedir(), '.claude', 'skills', 'dev', 'scripts', 'worktree-manage.sh');
const scriptExists = existsSync(WORKTREE_MANAGE);

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
  it.skipIf(!scriptExists)('env var 路径：CLAUDE_SESSION_ID 有值时直接返回', () => {
    const out = runResolve({ CLAUDE_SESSION_ID: 'env-test-uuid-12345' });
    expect(out).toBe('env-test-uuid-12345');
  });

  it.skipIf(!scriptExists)('env var 空串时退到 PPID fallback（CI 父链无 claude→空 / 本地主 claude 内→UUID）', () => {
    const out = runResolve({ CLAUDE_SESSION_ID: '' });
    // 鲁棒断言：CI vitest 父链无 claude --session-id → 空；本地主 claude 进程内 PPID 链能找到 → UUID
    // 两种都视为 fallback 路径正常运行（不是 SOURCE_FAIL/NO_FUNC）
    expect(out === '' || /^[a-f0-9-]{8,}$/.test(out)).toBe(true);
  });

  it.skipIf(!scriptExists)('env var 未设置时也走 fallback（CI 空 / 本地 UUID）', () => {
    // 单独设一个干净 env 去掉 CLAUDE_SESSION_ID
    const env = { ...process.env };
    delete env.CLAUDE_SESSION_ID;
    const bashScript = `source "${WORKTREE_MANAGE}" 2>/dev/null || { echo "SOURCE_FAIL"; exit 1; }
declare -f _resolve_claude_session_id >/dev/null || { echo "NO_FUNC"; exit 1; }
_resolve_claude_session_id
`;
    const out = execSync(`bash -c '${bashScript.replace(/'/g, `'"'"'`)}'`, { shell: '/bin/bash', env }).toString().trim();
    expect(out === '' || /^[a-f0-9-]{8,}$/.test(out)).toBe(true);
  });
});
