import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// TDD Red：证明「通道 1 脚本判据从标题换成 Brain 归属求证（fail-closed）」尚未实现。
// 当前 should-auto-merge.sh 仍按 PR 标题判定（arg2=title），完全不 curl Brain，故：
//   - Brain owned:true（#4755 类无 feat(harness): 前缀的 harness PR）会被误判 MERGE（应 SKIP）——红
//   - Brain 5xx 不会 fail-closed（应 SKIP）——红
// 该边（脚本↔Brain HTTP）在快验层用 PATH 注入 fake curl 覆盖；真 HTTP 边由 ## E2E 验收 打真 Brain。
const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const SCRIPT = join(REPO_ROOT, '.github/workflows/scripts/should-auto-merge.sh');

let fakeDir: string;

function fakeCurl(bodyThenCode: string, exitCode = 0): void {
  // 脚本约定 curl -w $'\n%{http_code}'：输出 body\n<code>
  const script =
    exitCode === 28
      ? '#!/usr/bin/env bash\nexit 28\n'
      : `#!/usr/bin/env bash\nprintf '%s' ${JSON.stringify(bodyThenCode)}\n`;
  writeFileSync(join(fakeDir, 'curl'), script);
  chmodSync(join(fakeDir, 'curl'), 0o755);
}

function runScript(branch: string, prNumber: string): string {
  const res = spawnSync('bash', [SCRIPT, branch, prNumber], {
    env: { ...process.env, PATH: `${fakeDir}:${process.env.PATH}`, BRAIN_URL: 'http://brain.local' },
    encoding: 'utf-8',
  });
  return `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
}

beforeAll(() => {
  fakeDir = mkdtempSync(join(tmpdir(), 'fakecurl-'));
});
afterAll(() => {
  rmSync(fakeDir, { recursive: true, force: true });
});

describe('通道 1 归属判据（should-auto-merge.sh）[BEHAVIOR]', () => {
  it('harness-owned(owned:true) 应 SKIP', () => {
    fakeCurl('{"owned":true,"run_id":"11111111-1111-4111-8111-111111111111","pr_number":4755,"reason":"x"}\n200');
    // #4755 分支 cp-08101107-04e4690d，标题 fix(orchestrator): —— 无 feat(harness): 前缀
    expect(runScript('cp-08101107-04e4690d', '4755')).toMatch(/^SKIP/);
  });

  it('Brain 5xx 应 fail-closed SKIP', () => {
    fakeCurl('{"error":"boom"}\n500');
    expect(runScript('cp-08101107-04e4690d', '4755')).toMatch(/^SKIP/);
  });

  it('not_owned 的 cp-* 应 MERGE 不回归 dev', () => {
    fakeCurl('{"owned":false,"run_id":null,"pr_number":123,"reason":"x"}\n200');
    expect(runScript('cp-manual-dev', '123')).toMatch(/MERGE/);
  });
});
