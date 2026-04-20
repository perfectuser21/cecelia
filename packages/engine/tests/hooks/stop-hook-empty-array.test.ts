import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const STOP_SH = resolve(__dirname, '../../../../hooks/stop.sh');

describe('Phase 7.2 stop.sh 空数组 guard', () => {
  let emptyDir: string;

  beforeAll(() => {
    emptyDir = mkdtempSync(join(tmpdir(), 'stop-empty-'));
  });

  afterAll(() => {
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('非 git 目录下（git worktree list 返回空）stop.sh 不 crash with "unbound variable"', () => {
    const stdinJSON = JSON.stringify({
      session_id: 'test-session-uuid',
      transcript_path: '',
      cwd: emptyDir,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });
    const result = execSync(
      `cd "${emptyDir}" && echo '${stdinJSON}' | bash "${STOP_SH}" 2>&1; echo "EXIT=$?"`,
      { shell: '/bin/bash' },
    ).toString();
    expect(result).not.toContain('unbound variable');
    expect(result).not.toContain('_STOP_HOOK_WT_LIST[@]');
    // Exit code should be clean (0 = 放行) since no .dev-lock in empty dir
    expect(result).toContain('EXIT=0');
  });

  it('bash 空数组 guard 语法本身能在 set -u 下工作', () => {
    const out = execSync(`bash -c 'set -u; arr=(); for x in "\${arr[@]+\${arr[@]}}"; do echo "$x"; done; echo OK' 2>&1`, {
      shell: '/bin/bash',
    }).toString().trim();
    expect(out).toBe('OK');
  });
});
