import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCommandBoundary, SYNTHETIC_WEBHOOK } from './owned-command-boundary.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const KEEPALIVE = join(REPO_ROOT, 'scripts/ops/brain-keepalive-check.sh');
const tempDirs = [];
const boundaries = [];

beforeEach(() => {
  vi.stubEnv('FEISHU_BOT_WEBHOOK', 'https://inherited.invalid/must-not-be-used');
  vi.stubEnv('KEEPALIVE_TEST_FOREIGN_SECRET', 'synthetic-never-inherit');
});

afterEach(() => {
  try {
    for (const boundary of boundaries.splice(0)) {
      expect(readFileSync(boundary.denied, 'utf8')).toBe('');
    }
  } finally {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});

describe('Brain keepalive — OrbStack daemon 自愈', () => {
  it('docker 命令存在但 daemon 停止时，先启动 OrbStack，再恢复 Brain 容器', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-keepalive-orbstack-'));
    tempDirs.push(dir);
    const boundary = createCommandBoundary(dir, KEEPALIVE);
    boundaries.push(boundary);
    const binDir = join(dir, 'bin');
    const daemonState = join(dir, 'daemon-ready');
    const containerState = join(dir, 'container-running');
    const calls = join(dir, 'calls.log');
    mkdirSync(binDir);

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
        ...boundary.env,
        FEISHU_BOT_WEBHOOK: SYNTHETIC_WEBHOOK,
        OWN_ALLOW_NOTIFICATION: '1',
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
    const commands = callLog.trim().split('\n');
    const orbIndex = commands.indexOf('orbctl start');
    const composeIndex = commands.findIndex(command => command.startsWith('docker compose '));
    expect(orbIndex).toBeGreaterThan(0);
    expect(composeIndex).toBeGreaterThan(orbIndex);
    expect(commands[composeIndex]).toBe(`docker compose --env-file ${REPO_ROOT}/.env.docker -f ${REPO_ROOT}/docker-compose.yml up -d node-brain`);
    expect(commands.filter(command => command.startsWith('docker compose '))).toHaveLength(1);
    expect(commands.at(-1)).toBe('docker inspect cecelia-node-brain --format {{.State.Status}}');
    expect(readFileSync(daemonState, 'utf8')).toBe('');
    expect(readFileSync(containerState, 'utf8')).toBe('');
    expect(readFileSync(boundary.count, 'utf8')).toBe('curl\n');
    expect(readFileSync(boundary.target, 'utf8')).toBe(SYNTHETIC_WEBHOOK);
    expect(JSON.parse(readFileSync(boundary.body, 'utf8'))).toEqual({
      msg_type: 'text', content: { text: '✅ Brain 容器已自动重启恢复' },
    });
  });
});
