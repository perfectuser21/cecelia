import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const actualGit = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
const realGit = execFileSync('/bin/bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

test('rescan fixture stays deterministic when remote main advances and forwards other git commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rescan-boundary-'));
  try {
    const bin = join(dir, 'bin'); mkdirSync(bin);
    const remoteCount = join(dir, 'remote-count'); const forwarded = join(dir, 'forwarded');
    const source = (name, text) => writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + text, { mode: 0o755 });
    source('git', `if [[ "$*" == 'ls-remote origin refs/heads/main' ]]; then
  n=0; [[ ! -f "$RESCAN_TEST_REMOTE_COUNT" ]] || n=$(cat "$RESCAN_TEST_REMOTE_COUNT")
  n=$((n+1)); printf '%s' "$n" > "$RESCAN_TEST_REMOTE_COUNT"
  sha=1111111111111111111111111111111111111111
  [[ "$n" == 1 ]] || sha=2222222222222222222222222222222222222222
  printf '%s\\trefs/heads/main\\n' "$sha"; exit 0
fi
printf '%s\\n' "$*" >> "$RESCAN_TEST_FORWARDED"
exec "$RESCAN_TEST_REAL_GIT" "$@"
`);
    const result = spawnSync('/bin/bash', ['scripts/__tests__/rescan-if-changed.test.sh'], {
      cwd: root, encoding: 'utf8', timeout: 45000,
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, TMPDIR: dir,
        GIT_EXEC_PATH: actualGit, RESCAN_TEST_REAL_GIT: realGit,
        RESCAN_TEST_REMOTE_COUNT: remoteCount, RESCAN_TEST_FORWARDED: forwarded,
        RESCAN_LOCK_DIR: join(dir, 'script.lock') },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /结果: PASS=12 FAIL=0/);
    assert.doesNotMatch(result.stdout, /离线环境|跳过行为用例/);
    assert.ok(existsSync(forwarded));
    assert.match(readFileSync(forwarded, 'utf8'), /rev-parse --show-toplevel/);
    assert.ok(!existsSync(remoteCount) || Number(readFileSync(remoteCount, 'utf8')) <= 1,
      'the fixture must not repeatedly observe mutable live remote state');
    // The production default still differs from the historical cron outer lock.
    // The fixture exercises only explicit private paths via the existing seam.
    const script = readFileSync(join(root, 'scripts/scan/rescan-if-changed.sh'), 'utf8');
    assert.match(script, /LOCK_DIR="\$\{RESCAN_LOCK_DIR:-\/tmp\/cecelia-rescan-script\.lock\}"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
