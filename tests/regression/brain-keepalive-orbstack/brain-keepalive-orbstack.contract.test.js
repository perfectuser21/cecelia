import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const KEEPALIVE = join(REPO_ROOT, 'scripts/ops/brain-keepalive-check.sh');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Brain keepalive — OrbStack daemon 自愈', () => {
  it('docker 命令存在但 daemon 停止时，先启动 OrbStack，再恢复 Brain 容器', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-keepalive-orbstack-'));
    tempDirs.push(dir);
    const binDir = join(dir, 'bin');
    const daemonState = join(dir, 'daemon-ready');
    const containerState = join(dir, 'container-running');
    const calls = join(dir, 'calls.log');
    spawnSync('/bin/mkdir', ['-p', binDir]);

    const docker = join(binDir, 'docker');
    writeFileSync(docker, `#!/bin/bash
echo "docker $*" >> "$FAKE_CALLS"
case "$1" in
  info)
    [[ -f "$FAKE_DAEMON_STATE" ]]
    ;;
  inspect)
    if [[ -f "$FAKE_CONTAINER_STATE" ]]; then echo running; exit 0; fi
    exit 1
    ;;
  compose)
    [[ -f "$FAKE_DAEMON_STATE" ]] || exit 1
    touch "$FAKE_CONTAINER_STATE"
    exit 0
    ;;
  *) exit 1 ;;
esac
`);
    chmodSync(docker, 0o755);

    const orbctl = join(binDir, 'orbctl');
    writeFileSync(orbctl, `#!/bin/bash
echo "orbctl $*" >> "$FAKE_CALLS"
[[ "$1" == "start" ]] || exit 1
touch "$FAKE_DAEMON_STATE"
`);
    chmodSync(orbctl, 0o755);

    const result = spawnSync('/bin/bash', [KEEPALIVE], {
      env: {
        ...process.env,
        BRAIN_KEEPALIVE_PATH: binDir,
        BRAIN_KEEPALIVE_ORBCTL: orbctl,
        BRAIN_KEEPALIVE_STATE_DIR: dir,
        BRAIN_KEEPALIVE_RESTART_WAIT_SECONDS: '0',
        BRAIN_KEEPALIVE_DAEMON_WAIT_SECONDS: '0',
        FAKE_CALLS: calls,
        FAKE_DAEMON_STATE: daemonState,
        FAKE_CONTAINER_STATE: containerState,
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const callLog = readFileSync(calls, 'utf8');
    expect(callLog).toContain('orbctl start');
    expect(callLog).toContain('docker compose');
    expect(result.stdout).toContain('AUTO-RESTARTED');
  });
});
