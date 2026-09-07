import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const WATCHDOG = join(REPO_ROOT, 'scripts/ops/tailscale-login-watchdog.py');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// fake tailscale 二进制：按 fixture 返回 status/prefs，每次调用追加进 calls.log
function makeFixture({
  backendState,
  wantRunning = true,
  selfIps = ['100.71.151.105'],
  state = null,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-login-watchdog-'));
  tempDirs.push(dir);
  const statusFile = join(dir, 'status.json');
  const prefsFile = join(dir, 'prefs.json');
  const callsFile = join(dir, 'calls.log');
  const stateFile = join(dir, 'state.json');
  const fakeTailscale = join(dir, 'tailscale');

  writeFileSync(statusFile, JSON.stringify({
    BackendState: backendState,
    Self: { HostName: 'perfect21', TailscaleIPs: selfIps, Online: backendState === 'Running' },
    Peer: {},
  }));
  writeFileSync(prefsFile, JSON.stringify({ WantRunning: wantRunning, ExitNodeID: '', CorpDNS: true }));
  writeFileSync(callsFile, '');
  if (state) writeFileSync(stateFile, JSON.stringify(state));

  writeFileSync(fakeTailscale, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CALLS_FILE, args.join(' ') + '\\n');
if (process.env.FAKE_STATUS_FAILS === 'true' && args[0] === 'status') {
  process.stderr.write('failed to connect to local tailscaled');
  process.exit(1);
}
if (args[0] === 'status' && args[1] === '--json') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_STATUS_FILE, 'utf8'));
  process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'prefs') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_PREFS_FILE, 'utf8'));
  process.exit(0);
}
if (args[0] === 'set') {
  if (process.env.FAKE_SET_FAILS === 'true') {
    process.stderr.write('cannot advertise exit node');
    process.exit(1);
  }
  process.exit(0);
}
if (args[0] === 'up') {
  if (process.env.FAKE_UP_FAILS === 'true') {
    process.stderr.write('authkey expired');
    process.exit(1);
  }
  const s = JSON.parse(fs.readFileSync(process.env.FAKE_STATUS_FILE, 'utf8'));
  s.BackendState = 'Running';
  s.Self.Online = true;
  fs.writeFileSync(process.env.FAKE_STATUS_FILE, JSON.stringify(s));
  process.exit(0);
}
process.stderr.write('unexpected fake tailscale args: ' + args.join(' '));
process.exit(9);
`);
  chmodSync(fakeTailscale, 0o755);

  return { dir, statusFile, prefsFile, callsFile, stateFile, fakeTailscale };
}

function runWatchdog(fixture, env = {}) {
  const result = spawnSync('python3', [WATCHDOG, '--once'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TAILSCALE_BIN: fixture.fakeTailscale,
      FAKE_STATUS_FILE: fixture.statusFile,
      FAKE_PREFS_FILE: fixture.prefsFile,
      FAKE_CALLS_FILE: fixture.callsFile,
      CECELIA_TS_WATCHDOG_STATE_FILE: fixture.stateFile,
      CECELIA_TS_WATCHDOG_LOCK_FILE: join(fixture.dir, 'watchdog.lock'),
      CECELIA_TS_WATCHDOG_DISABLED_FILE: join(fixture.dir, 'DISABLED'),
      TAILSCALE_AUTHKEY: 'tskey-auth-FAKEKEYFORTESTS',
      ...env,
    },
  });
  return {
    ...result,
    calls: readFileSync(fixture.callsFile, 'utf8').trim().split('\n').filter(Boolean),
    emitted: result.stdout.trim().split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    }),
  };
}

describe('tailscale-login-watchdog', () => {
  // 复现 2026-09-06 真实故障：node key 过期后 BackendState=NeedsLogin，
  // 但 utun4 上的 100.71.151.105 仍然残留。
  // 旧 watchdog（pgrep -x Tailscale）在此完全无反应，slot1-10 全断。
  it('NeedsLogin 且 IP 仍残留时必须重认证（回归：2026-09-06 slot1-10 全断）', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin', selfIps: ['100.71.151.105'] });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up '))).toBe(true);
    expect(result.emitted.some((e) => e.action === 'reauth')).toBe(true);
    expect(result.status).toBe(0);
  });

  it('Running 时不得调用 up', () => {
    const fixture = makeFixture({ backendState: 'Running' });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'ok')).toBe(true);
    expect(result.status).toBe(0);
  });

  it('重认证时不得带会重置 exit-node/routes 的 flag', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture);

    const upCall = result.calls.find((c) => c.startsWith('up '));
    expect(upCall).toBeDefined();
    expect(upCall).not.toContain('--reset');
    expect(upCall).not.toContain('--exit-node');
    expect(upCall).not.toContain('--advertise-routes');
    expect(upCall).toContain('--hostname=');
  });
  it('status 命令失败时判为守护进程故障，不得当成重认证', () => {
    const fixture = makeFixture({ backendState: 'Running' });
    const result = runWatchdog(fixture, { FAKE_STATUS_FAILS: 'true' });

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'restart_daemon')).toBe(true);
  });

  it('冷却期内不得重试（防重认证风暴）', () => {
    const now = Math.floor(Date.now() / 1000);
    const fixture = makeFixture({
      backendState: 'NeedsLogin',
      state: { consecutive_failures: 2, last_attempt_ts: now - 10, last_ip: '100.71.151.105' },
    });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'backoff')).toBe(true);
  });

  it('安全闸存在时只告警不重认证', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    writeFileSync(join(fixture.dir, 'DISABLED'), 'incident-2026-09-06\n');
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'disabled')).toBe(true);
  });

  it('Stopped 且 WantRunning=false 视为人主动 down，尊重意图不重认证', () => {
    const fixture = makeFixture({ backendState: 'Stopped', wantRunning: false });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'ok')).toBe(true);
  });

  it('重认证失败时记录失败次数供退避使用', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture, { FAKE_UP_FAILS: 'true' });

    expect(result.status).not.toBe(0);
    const state = JSON.parse(readFileSync(fixture.stateFile, 'utf8'));
    expect(state.consecutive_failures).toBe(1);
  });

  // 9-07 案卷：restart_daemon / disabled 这两条路径既不清零也不落盘，
  // 计数只增不减地留在 state.json 里，下一次真需要重认证时直接从残留值起跳，
  // 退避阶梯一上来就是 1800 秒——本该 60 秒重试的故障被拖成半小时。
  it('restart_daemon 分支必须清零并持久化计数（回归：跨事故残留把退避拉到 30 分钟）', () => {
    const fixture = makeFixture({
      backendState: 'Running',
      state: { consecutive_failures: 51, last_attempt_ts: 1, last_ip: '100.71.151.105' },
    });
    const result = runWatchdog(fixture, { FAKE_STATUS_FAILS: 'true' });

    expect(result.emitted.some((e) => e.action === 'restart_daemon')).toBe(true);
    expect(JSON.parse(readFileSync(fixture.stateFile, 'utf8')).consecutive_failures).toBe(0);
  });

  it('disabled 分支同样清零并持久化计数', () => {
    const fixture = makeFixture({
      backendState: 'NeedsLogin',
      state: { consecutive_failures: 51, last_attempt_ts: 1 },
    });
    writeFileSync(join(fixture.dir, 'DISABLED'), 'incident\n');
    const result = runWatchdog(fixture);

    expect(result.emitted.some((e) => e.action === 'disabled')).toBe(true);
    expect(JSON.parse(readFileSync(fixture.stateFile, 'utf8')).consecutive_failures).toBe(0);
  });

  it('backoff 分支保留计数（它是重认证失败的延续），但仍要落盘', () => {
    const now = Math.floor(Date.now() / 1000);
    const fixture = makeFixture({
      backendState: 'NeedsLogin',
      state: { consecutive_failures: 2, last_attempt_ts: now - 10 },
    });
    const result = runWatchdog(fixture);

    expect(result.emitted.some((e) => e.action === 'backoff')).toBe(true);
    expect(JSON.parse(readFileSync(fixture.stateFile, 'utf8')).consecutive_failures).toBe(2);
  });

  // 9-06 watchdog 重认证之后 perfect21 的 ExitNodeOption 变成 False，
  // 西安执行机随即失去 primary 美国出口，只剩 sf-vps 备用节点扛着。
  // `tailscale up` 不能带 exit-node 相关 flag（会覆盖 prefs），只能事后补一刀。
  it('开启开关时重认证成功后补回 exit node 广播（回归：9-06 广播被冲掉）', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture, { CECELIA_LOGIN_WATCHDOG_ADVERTISE_EXIT: '1' });

    expect(result.emitted.some((e) => e.action === 'reauth')).toBe(true);
    expect(result.calls.some((c) => c === 'set --advertise-exit-node')).toBe(true);
    expect(result.status).toBe(0);
  });

  it('未开启开关时绝不动 exit node 广播（默认不改变现有 prefs）', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture);

    expect(result.emitted.some((e) => e.action === 'reauth')).toBe(true);
    expect(result.calls.some((c) => c.startsWith('set'))).toBe(false);
  });

  it('补广播失败只告警，不影响重认证本身的成功返回码', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture, {
      CECELIA_LOGIN_WATCHDOG_ADVERTISE_EXIT: '1',
      FAKE_SET_FAILS: 'true',
    });

    expect(result.status).toBe(0);
    expect(result.emitted.some((e) => e.action === 'reauth')).toBe(true);
    expect(result.emitted.some((e) => e.action === 'advertise_exit_failed')).toBe(true);
  });

  it('日志中绝不出现 authkey 明文', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture, { TAILSCALE_AUTHKEY: 'tskey-auth-SUPERSECRETVALUE123' });

    // 先证明它真的走到了重认证（否则脚本不存在时本用例会假绿，证明不了任何事）
    expect(result.calls.some((c) => c.startsWith('up '))).toBe(true);
    expect(result.stdout).not.toContain('SUPERSECRETVALUE123');
    expect(result.stderr).not.toContain('SUPERSECRETVALUE123');
  });

  // 这个安装器只能 sudo 装到 /usr/local/libexec，没法在 CI 里真跑；
  // 但开关不注入 plist，上面那条修复在 perfect21 上等于没做，
  // 所以至少守住"注入这件事没被顺手删掉"。
  it('安装器把 advertise 开关注入 plist（否则修复在 perfect21 上不生效）', () => {
    const installer = readFileSync(
      join(REPO_ROOT, 'scripts/ops/install-tailscale-login-watchdog.sh'), 'utf8');

    expect(installer).toContain('CECELIA_LOGIN_WATCHDOG_ADVERTISE_EXIT');
  });
});
