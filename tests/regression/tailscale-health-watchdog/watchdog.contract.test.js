// 回归：2026-09-07 xian-m4 断网事故。macsys network-extension 内部死锁 27 分钟——
// 进程活着、GUI 显示已连接，但 localapi 完全不应答，`tailscale status` 全部超时。
// 当时没有任何东西会去动它，最后是 enforcer 判定 daemon_absent 超阈值 fail-closed
// 拉闸、整机断网，靠人工重启才恢复。
// 本 watchdog 的职责就是在 enforcer 拉闸之前把扩展救活：3 次探测失败（≈3 分钟）
// 先温和唤醒 GUI，仍不行再强杀扩展让 NE framework 重新拉起，并带冷却与停手保护
// 防止重启风暴。
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const WATCHDOG = join(REPO_ROOT, 'scripts/ops/tailscale-health-watchdog.py');
const INSTALLER = join(REPO_ROOT, 'scripts/ops/install-tailscale-health-watchdog.sh');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeFixture({
  backendState = 'Running',
  statusFails = false,
  hostName = 'mac-mini-m4',
  state = null,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-health-watchdog-'));
  tempDirs.push(dir);
  const statusFile = join(dir, 'status.json');
  const callsFile = join(dir, 'calls.log');
  const stateFile = join(dir, 'state.json');
  const fakeTailscale = join(dir, 'tailscale');
  const fakeOpen = join(dir, 'open');
  const fakePkill = join(dir, 'pkill');

  writeFileSync(statusFile, JSON.stringify({
    BackendState: backendState,
    Self: { HostName: hostName, TailscaleIPs: ['100.86.57.69'], Online: backendState === 'Running' },
    Peer: {},
  }));
  writeFileSync(callsFile, '');
  if (state) writeFileSync(stateFile, JSON.stringify(state));

  writeFileSync(fakeTailscale, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CALLS_FILE, 'tailscale ' + args.join(' ') + '\\n');
if (process.env.FAKE_STATUS_FAILS === 'true') {
  process.stderr.write('failed to connect to local tailscaled');
  process.exit(1);
}
if (args[0] === 'status' && args[1] === '--json') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_STATUS_FILE, 'utf8'));
  process.exit(0);
}
process.stderr.write('unexpected fake tailscale args: ' + args.join(' '));
process.exit(9);
`);
  const recorder = (name) => `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.FAKE_CALLS_FILE, '${name} ' + process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`;
  writeFileSync(fakeOpen, recorder('open'));
  writeFileSync(fakePkill, recorder('pkill'));
  for (const bin of [fakeTailscale, fakeOpen, fakePkill]) chmodSync(bin, 0o755);

  const env = {
    ...process.env,
    TAILSCALE_BIN: fakeTailscale,
    FAKE_STATUS_FILE: statusFile,
    FAKE_CALLS_FILE: callsFile,
    FAKE_STATUS_FAILS: String(statusFails),
    CECELIA_TS_HEALTH_STATE_FILE: stateFile,
    CECELIA_TS_HEALTH_LOCK_FILE: join(dir, 'watchdog.lock'),
    CECELIA_TS_HEALTH_DISABLED_FILE: join(dir, 'DISABLED'),
    CECELIA_TS_HEALTH_OPEN_BIN: fakeOpen,
    CECELIA_TS_HEALTH_PKILL_BIN: fakePkill,
  };

  return {
    dir,
    stateFile,
    env,
    run: (extraArgs = [], extraEnv = {}) => {
      const result = spawnSync('python3', [WATCHDOG, '--once', ...extraArgs], {
        encoding: 'utf8',
        env: { ...env, ...extraEnv },
      });
      return {
        ...result,
        calls: readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean),
        emitted: (result.stdout || '').trim().split('\n').filter(Boolean).map((line) => {
          try { return JSON.parse(line); } catch { return { raw: line }; }
        }),
      };
    },
    disable: (reason) => writeFileSync(join(dir, 'DISABLED'), reason),
    readState: () => JSON.parse(readFileSync(stateFile, 'utf8')),
  };
}

const now = () => Math.floor(Date.now() / 1000);

describe('tailscale-health-watchdog', () => {
  it('BackendState=Running 时判健康并清空所有失败/自愈计数', () => {
    const fixture = makeFixture({
      state: { fail_count: 2, restart_round: 2, last_restart_ts: now() - 100, last_ok_ts: 0 },
    });

    const result = fixture.run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.emitted.some((e) => e.action === 'healthy')).toBe(true);
    expect(result.calls.some((c) => c.startsWith('open') || c.startsWith('pkill'))).toBe(false);
    const state = fixture.readState();
    expect(state.fail_count).toBe(0);
    expect(state.restart_round).toBe(0);
    expect(state.last_ok_ts).toBeGreaterThan(now() - 120);
  });

  it('探测失败但未到阈值时只记 degraded，绝不动手重启', () => {
    const fixture = makeFixture({ statusFails: true });

    const result = fixture.run();

    expect(result.status).toBe(1);
    const degraded = result.emitted.find((e) => e.action === 'degraded');
    expect(degraded, result.stderr).toBeDefined();
    expect(degraded.fail_count).toBe(1);
    expect(result.calls.some((c) => c.startsWith('open') || c.startsWith('pkill'))).toBe(false);
  });

  it('BackendState 非 Running（扩展死锁但进程活着）同样计一次失败', () => {
    const fixture = makeFixture({ backendState: 'NoState' });

    const result = fixture.run();

    const degraded = result.emitted.find((e) => e.action === 'degraded');
    expect(degraded, result.stderr).toBeDefined();
    expect(degraded.fail_count).toBe(1);
  });

  it('连续第 3 次失败触发一级自愈：唤醒 GUI（open -gja Tailscale）', () => {
    const fixture = makeFixture({
      statusFails: true,
      state: { fail_count: 2, restart_round: 0, last_restart_ts: 0, last_ok_ts: now() - 300 },
    });

    const result = fixture.run();

    expect(result.status).toBe(1);
    const attempt = result.emitted.find((e) => e.action === 'restart_attempted');
    expect(attempt, result.stderr).toBeDefined();
    expect(attempt.round).toBe(1);
    expect(attempt.method).toBe('open');
    expect(result.calls.some((c) => c.startsWith('open') && c.includes('-gja') && c.includes('Tailscale'))).toBe(true);
    const state = fixture.readState();
    expect(state.restart_round).toBe(1);
    expect(state.fail_count).toBe(0);
    expect(state.last_restart_ts).toBeGreaterThan(now() - 120);
  });

  it('冷却期内即使再次达到阈值也不重复动手（防重启风暴）', () => {
    const fixture = makeFixture({
      statusFails: true,
      state: { fail_count: 2, restart_round: 1, last_restart_ts: now() - 10, last_ok_ts: 0 },
    });

    const result = fixture.run();

    expect(result.status).toBe(1);
    expect(result.emitted.some((e) => e.action === 'cooldown_wait')).toBe(true);
    expect(result.calls.some((c) => c.startsWith('open') || c.startsWith('pkill'))).toBe(false);
    expect(fixture.readState().restart_round).toBe(1);
  });

  it('冷却过后第二轮升级为强杀 network-extension（唤醒 GUI 救不回死锁）', () => {
    const fixture = makeFixture({
      statusFails: true,
      state: { fail_count: 2, restart_round: 1, last_restart_ts: now() - 700, last_ok_ts: 0 },
    });

    const result = fixture.run();

    const attempt = result.emitted.find((e) => e.action === 'restart_attempted');
    expect(attempt, result.stderr).toBeDefined();
    expect(attempt.round).toBe(2);
    expect(attempt.method).toBe('pkill');
    expect(result.calls.some((c) =>
      c.startsWith('pkill') && c.includes('io.tailscale.ipn.macsys.network-extension'))).toBe(true);
  });

  it('连续 3 轮自愈无效后停手，只告警不再重启', () => {
    const fixture = makeFixture({
      statusFails: true,
      state: { fail_count: 2, restart_round: 3, last_restart_ts: now() - 700, last_ok_ts: 0 },
    });

    const result = fixture.run();

    expect(result.status).toBe(2);
    expect(result.emitted.some((e) => e.action === 'stuck_gave_up')).toBe(true);
    expect(result.calls.some((c) => c.startsWith('open') || c.startsWith('pkill'))).toBe(false);
    expect(fixture.readState().restart_round).toBe(3);
  });

  it('安全闸文件存在时完全跳过，连探测都不做', () => {
    const fixture = makeFixture({ statusFails: true });
    fixture.disable('incident-2026-09-07\n');

    const result = fixture.run();

    expect(result.status).toBe(0);
    expect(result.emitted.some((e) => e.action === 'disabled')).toBe(true);
    expect(result.calls).toEqual([]);
  });

  it('--check-client 只放行白名单内的机器，不改任何状态', () => {
    const approved = makeFixture({ hostName: 'mac-mini-m4-xian' });
    const rejected = makeFixture({ hostName: 'perfect21' });

    const ok = approved.run(['--check-client']);
    const bad = rejected.run(['--check-client']);

    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.emitted.some((e) => e.action === 'client_approved')).toBe(true);
    expect(bad.status).not.toBe(0);
    expect(`${bad.stdout}${bad.stderr}`).toContain('unapproved_client');
    expect(existsSync(rejected.stateFile)).toBe(false);
  });

  it('白名单可经环境变量覆盖，便于新增目标机', () => {
    const fixture = makeFixture({ hostName: 'mac-mini-m1-us' });

    const result = fixture.run(['--check-client'], {
      CECELIA_TS_HEALTH_ALLOWED_HOSTS: 'mac-mini-m1-us',
    });

    expect(result.status, result.stderr).toBe(0);
  });

  it('阈值与冷却窗口均可经环境变量调参', () => {
    const fixture = makeFixture({ statusFails: true });

    const result = fixture.run([], { CECELIA_TS_HEALTH_FAIL_THRESHOLD: '1' });

    const attempt = result.emitted.find((e) => e.action === 'restart_attempted');
    expect(attempt, result.stderr).toBeDefined();
    expect(attempt.round).toBe(1);
  });
});

// LaunchDaemon / plutil / launchctl 全是 macOS 专属，ubuntu runner 上
// /usr/bin/plutil 不存在会直接 127（tailscale-us-exit 那组同样的守卫）。
describe.runIf(process.platform === 'darwin')('LaunchDaemon 安装器', () => {
  function installerDirs(fixture) {
    return {
      plistDir: join(fixture.dir, 'LaunchDaemons'),
      libexecDir: join(fixture.dir, 'system-libexec'),
      stateDir: join(fixture.dir, 'system-state'),
      logDir: join(fixture.dir, 'system-log'),
    };
  }

  function install(fixture, extraArgs = [], extraEnv = {}) {
    const dirs = installerDirs(fixture);
    const result = spawnSync('/bin/bash', [
      INSTALLER,
      '--system-plist-dir', dirs.plistDir,
      '--system-libexec-dir', dirs.libexecDir,
      '--system-state-dir', dirs.stateDir,
      '--system-log-dir', dirs.logDir,
      ...extraArgs,
    ], { env: { ...fixture.env, ...extraEnv }, encoding: 'utf8' });
    return { ...result, ...dirs };
  }

  it('本机身份不在目标机白名单时，在写入任何系统文件前拒绝安装', () => {
    // 这个 daemon 会强杀 network-extension，装错机器等于给别人断网。
    const fixture = makeFixture({ hostName: 'perfect21' });

    const result = install(fixture, ['--no-load']);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('unapproved_client');
    expect(existsSync(join(result.libexecDir, 'tailscale-health-watchdog.py'))).toBe(false);
    expect(existsSync(join(result.plistDir, 'com.cecelia.tailscale-health-watchdog.plist'))).toBe(false);
    expect(existsSync(result.stateDir)).toBe(false);
    expect(existsSync(result.logDir)).toBe(false);
  });

  it('生成合法的 root LaunchDaemon：每 60 秒跑一次 --once', () => {
    const fixture = makeFixture({ hostName: 'mac-mini-m4-xian' });

    const result = install(fixture, ['--no-load']);

    expect(result.status, result.stderr).toBe(0);
    const plist = join(result.plistDir, 'com.cecelia.tailscale-health-watchdog.plist');
    const lint = spawnSync('/usr/bin/plutil', ['-lint', plist], { encoding: 'utf8' });
    expect(lint.status, lint.stderr).toBe(0);
    const plistText = readFileSync(plist, 'utf8');
    expect(plistText).toContain('<string>com.cecelia.tailscale-health-watchdog</string>');
    expect(plistText).toContain(`${result.libexecDir}/tailscale-health-watchdog.py`);
    expect(plistText).toContain('<string>--once</string>');
    expect(plistText).toMatch(/<key>StartInterval<\/key>\s*<integer>60<\/integer>/);
    expect(plistText).toContain(`<string>${result.stateDir}/state.json</string>`);
    expect(plistText).toContain(`<string>${result.logDir}/tailscale-health-watchdog.log</string>`);
    expect(existsSync(join(result.libexecDir, 'tailscale-health-watchdog.py'))).toBe(true);
  });

  it('加载时先 bootout 旧 label 再 enable/bootstrap/kickstart', () => {
    const fixture = makeFixture({ hostName: 'mac-mini-m4-xian' });
    const launchctlLog = join(fixture.dir, 'launchctl.log');
    const fakeLaunchctl = join(fixture.dir, 'launchctl');
    const fakeSudo = join(fixture.dir, 'sudo');
    writeFileSync(fakeLaunchctl, '#!/bin/bash\necho "$*" >> "$FAKE_LAUNCHCTL_LOG"\nexit 0\n');
    writeFileSync(fakeSudo, '#!/bin/bash\nexec "$@"\n');
    chmodSync(fakeLaunchctl, 0o755);
    chmodSync(fakeSudo, 0o755);

    const result = install(fixture, [], {
      CECELIA_LAUNCHCTL_BIN: fakeLaunchctl,
      CECELIA_SUDO_BIN: fakeSudo,
      FAKE_LAUNCHCTL_LOG: launchctlLog,
    });

    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(launchctlLog, 'utf8');
    expect(calls).toContain('bootout system/com.cecelia.tailscale-health-watchdog');
    expect(calls).toContain('enable system/com.cecelia.tailscale-health-watchdog');
    expect(calls).toContain(
      `bootstrap system ${result.plistDir}/com.cecelia.tailscale-health-watchdog.plist`);
    expect(calls).toContain('kickstart -k system/com.cecelia.tailscale-health-watchdog');
  });

  it('脚本有语法错误时拒绝安装（别把坏脚本推上生产）', () => {
    const fixture = makeFixture({ hostName: 'mac-mini-m4-xian' });
    const brokenSource = join(fixture.dir, 'broken-watchdog.py');
    writeFileSync(brokenSource, 'def run_once(:\n    pass\n');

    const result = install(fixture, ['--no-load'], { CECELIA_TS_HEALTH_SOURCE: brokenSource });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(result.libexecDir, 'tailscale-health-watchdog.py'))).toBe(false);
  });
});
