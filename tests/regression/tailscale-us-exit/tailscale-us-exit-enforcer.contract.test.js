import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const ENFORCER = join(REPO_ROOT, 'scripts/ops/tailscale-us-exit-enforcer.py');
const INSTALLER = join(REPO_ROOT, 'scripts/ops/install-tailscale-us-exit-enforcer.sh');
const tempDirs = [];

const PRIMARY = {
  ID: 'node-primary-us',
  HostName: 'perfect21',
  DNSName: 'mac-mini-m4-us.tailce7a8b.ts.net.',
  TailscaleIPs: ['100.71.151.105'],
  ExitNodeOption: true,
  Online: true,
};

const SECONDARY = {
  ID: 'node-secondary-us',
  HostName: 'sf-vps',
  DNSName: 'vps-us.tailce7a8b.ts.net.',
  TailscaleIPs: ['100.79.41.61'],
  ExitNodeOption: true,
  Online: true,
};

const HONG_KONG = {
  ID: 'node-hk',
  HostName: 'VM-0-8-ubuntu',
  DNSName: 'vps-hk.tailce7a8b.ts.net.',
  TailscaleIPs: ['100.86.118.99'],
  ExitNodeOption: true,
  Online: true,
};

const SPOOFED_PRIMARY = {
  ...PRIMARY,
  ID: 'node-spoofed-primary',
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeFixture({ peers, selected = '', allowLan = false, acceptDns = false, setFails = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'tailscale-us-exit-'));
  tempDirs.push(dir);
  const statusFile = join(dir, 'status.json');
  const runtimeFile = join(dir, 'runtime.json');
  const callsFile = join(dir, 'calls.log');
  const pfCallsFile = join(dir, 'pf-calls.log');
  const pfRulesFile = join(dir, 'pf-rules.txt');
  const fakeTailscale = join(dir, 'tailscale');
  const fakePfctl = join(dir, 'pfctl');

  writeFileSync(statusFile, JSON.stringify({
    Self: {
      ID: 'xian-m4',
      HostName: 'mac-mini-m4',
      TailscaleIPs: ['100.86.57.69'],
      Online: true,
    },
    Peer: Object.fromEntries(peers.map((peer) => [peer.ID, peer])),
  }));
  writeFileSync(runtimeFile, JSON.stringify({ selected, allowLan, acceptDns }));
  writeFileSync(fakeTailscale, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const statusFile = process.env.FAKE_STATUS_FILE;
const runtimeFile = process.env.FAKE_RUNTIME_FILE;
const callsFile = process.env.FAKE_CALLS_FILE;
const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
if (args[0] === 'status' && args[1] === '--json') {
  process.stdout.write(fs.readFileSync(statusFile, 'utf8'));
  process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'prefs') {
  process.stdout.write(JSON.stringify({
    ExitNodeID: runtime.selected,
    ExitNodeIP: '',
    ExitNodeAllowLANAccess: runtime.allowLan,
    CorpDNS: runtime.acceptDns,
    WantRunning: true,
  }));
  process.exit(0);
}
if (args[0] === 'set') {
  fs.appendFileSync(callsFile, args.slice(1).join(' ') + '\\n');
  if (process.env.FAKE_SET_FAILS === 'true') {
    process.stderr.write('forced set failure');
    process.exit(1);
  }
  const exitArg = args.find((arg) => arg.startsWith('--exit-node='));
  const target = exitArg ? exitArg.slice('--exit-node='.length).replace(/\\.$/, '') : '';
  const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  const peers = Object.values(status.Peer || {});
  if (target.includes('.') || peers.some((peer) => peer.ID === target)) {
    process.stderr.write('invalid value for --exit-node; must be IP or unique node name');
    process.exit(1);
  }
  const peer = peers.find((candidate) =>
    String(candidate.DNSName || '').replace(/\\.$/, '').split('.')[0] === target ||
    String(candidate.HostName || '') === target ||
    (candidate.TailscaleIPs || []).includes(target));
  if (!peer) {
    process.stderr.write('exit node not found: ' + target);
    process.exit(1);
  }
  runtime.selected = peer.ID;
  runtime.allowLan = args.includes('--exit-node-allow-lan-access=true');
  runtime.acceptDns = args.includes('--accept-dns=true');
  fs.writeFileSync(runtimeFile, JSON.stringify(runtime));
  process.exit(0);
}
process.stderr.write('unexpected fake tailscale args: ' + args.join(' '));
process.exit(9);
`);
  chmodSync(fakeTailscale, 0o755);
  writeFileSync(fakePfctl, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_PF_CALLS_FILE, args.join(' ') + '\\n');
if (args[0] === '-s' && args[1] === 'info') {
  process.stdout.write('Status: Enabled for 1 days\\n');
  process.exit(0);
}
if (args[0] === '-F' && args[1] === 'states') {
  process.exit(0);
}
if (args.includes('-f') && args.at(-1) === '-') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    fs.writeFileSync(process.env.FAKE_PF_RULES_FILE, input);
    process.exit(0);
  });
  return;
}
if (args.at(-1) === '-sr') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_PF_RULES_FILE, 'utf8'));
  process.exit(0);
}
process.stderr.write('unexpected fake pfctl args: ' + args.join(' '));
process.exit(9);
`);
  chmodSync(fakePfctl, 0o755);

  const env = {
    ...process.env,
    TAILSCALE_BIN: fakeTailscale,
    CECELIA_US_EXIT_PFCTL_BIN: fakePfctl,
    CECELIA_US_EXIT_TUN_INTERFACE: 'utun99',
    CECELIA_US_EXIT_TARGET_UID: '501',
    CECELIA_US_EXIT_ALLOW_UNPRIVILEGED_FIREWALL: 'true',
    CECELIA_US_EXIT_ALLOWED_SELF_IPS: '100.86.57.69,100.88.166.55',
    CECELIA_US_EXIT_PRIMARY_DNS: 'mac-mini-m4-us.tailce7a8b.ts.net',
    CECELIA_US_EXIT_SECONDARY_DNS: 'vps-us.tailce7a8b.ts.net',
    CECELIA_US_EXIT_PRIMARY_ID: 'node-primary-us',
    CECELIA_US_EXIT_SECONDARY_ID: 'node-secondary-us',
    CECELIA_US_EXIT_STATE_FILE: join(dir, 'state.json'),
    CECELIA_US_EXIT_LOCK_FILE: join(dir, 'lock'),
    FAKE_STATUS_FILE: statusFile,
    FAKE_RUNTIME_FILE: runtimeFile,
    FAKE_CALLS_FILE: callsFile,
    FAKE_PF_CALLS_FILE: pfCallsFile,
    FAKE_PF_RULES_FILE: pfRulesFile,
    FAKE_SET_FAILS: String(setFails),
  };

  return {
    run: () => spawnSync('/usr/bin/python3', [ENFORCER, '--once'], { env, encoding: 'utf8' }),
    calls: () => {
      try { return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean); }
      catch { return []; }
    },
    runtime: () => JSON.parse(readFileSync(runtimeFile, 'utf8')),
    pfRules: () => readFileSync(pfRulesFile, 'utf8'),
    pfCalls: () => readFileSync(pfCallsFile, 'utf8').trim().split('\n').filter(Boolean),
    stateFile: join(dir, 'state.json'),
    dir,
  };
}

describe('西安执行机美国 Exit Node 强制器', () => {
  it('出口为空时选择在线的美国主节点，并强制 Exit DNS 与 LAN 访问设置', () => {
    const fixture = makeFixture({ peers: [PRIMARY, SECONDARY, HONG_KONG] });

    const result = fixture.run();

    expect(result.status, result.stderr).toBe(0);
    expect(fixture.calls()).toEqual([
      '--exit-node=mac-mini-m4-us --exit-node-allow-lan-access=true --accept-dns=true',
    ]);
    expect(fixture.runtime()).toMatchObject({
      selected: 'node-primary-us',
      allowLan: true,
      acceptDns: true,
    });
  });

  it('美国主节点离线时只切美国备用节点，绝不选择在线的香港节点', () => {
    const fixture = makeFixture({
      peers: [{ ...PRIMARY, Online: false }, SECONDARY, HONG_KONG],
    });

    const result = fixture.run();

    expect(result.status, result.stderr).toBe(0);
    expect(fixture.runtime().selected).toBe('node-secondary-us');
    expect(fixture.calls()[0]).not.toContain('node-hk');
  });

  it('两个美国节点都离线时仍锁定美国主节点并返回 fail-closed 信号', () => {
    const fixture = makeFixture({
      peers: [{ ...PRIMARY, Online: false }, { ...SECONDARY, Online: false }, HONG_KONG],
    });

    const result = fixture.run();

    expect(result.status).toBe(2);
    expect(fixture.runtime().selected).toBe('node-primary-us');
    expect(result.stdout).toContain('fail_closed');
  });

  it('只发现香港 Exit Node 时拒绝配置，并先启用只允许 utun 出站的 fail-closed 防火墙', () => {
    const fixture = makeFixture({ peers: [HONG_KONG], selected: 'node-hk' });

    const result = fixture.run();

    expect(result.status).not.toBe(0);
    expect(fixture.calls()).toEqual([]);
    expect(fixture.runtime().selected).toBe('node-hk');
    expect(fixture.pfRules()).not.toContain('pass out quick on utun99');
    expect(fixture.pfRules()).toContain('block drop out quick proto { tcp udp } user 501');
    expect(fixture.pfCalls()).toContain('-s info');
    expect(fixture.pfCalls()).toContain('-F states');
  });

  it('从香港出口切换美国出口失败时保持 fail-closed 防火墙，不能退回普通公网', () => {
    const fixture = makeFixture({
      peers: [PRIMARY, SECONDARY, HONG_KONG],
      selected: 'node-hk',
      setFails: true,
    });

    const result = fixture.run();

    expect(result.status).not.toBe(0);
    expect(fixture.runtime().selected).toBe('node-hk');
    expect(fixture.pfRules()).not.toContain('pass out quick on utun99');
    expect(fixture.pfRules()).toContain('block drop out quick proto { tcp udp } user 501');
    expect(fixture.pfCalls()).toContain('-F states');
  });

  it('DNS 名相同但 Node ID 不匹配时拒绝伪装的美国节点', () => {
    const fixture = makeFixture({ peers: [SPOOFED_PRIMARY, HONG_KONG], selected: 'node-hk' });

    const result = fixture.run();

    expect(result.status).not.toBe(0);
    expect(fixture.calls()).toEqual([]);
    expect(fixture.pfRules()).not.toContain('pass out quick on utun99');
  });

  it('出口节点正确但 DNS 设置漂移时会自动纠正', () => {
    const fixture = makeFixture({
      peers: [PRIMARY, SECONDARY],
      selected: 'node-primary-us',
      allowLan: true,
      acceptDns: false,
    });

    const result = fixture.run();

    expect(result.status, result.stderr).toBe(0);
    expect(fixture.calls()).toHaveLength(1);
    expect(fixture.runtime().acceptDns).toBe(true);
  });

  it('预置旧的可预测状态临时文件符号链接也不能覆写链接目标', () => {
    const fixture = makeFixture({ peers: [PRIMARY, SECONDARY] });
    const victim = join(fixture.dir, 'victim');
    writeFileSync(victim, 'do-not-overwrite');
    symlinkSync(victim, `${fixture.stateFile}.tmp`);

    const result = fixture.run();

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(victim, 'utf8')).toBe('do-not-overwrite');
    expect(JSON.parse(readFileSync(fixture.stateFile, 'utf8')).exit_node_id).toBe('node-primary-us');
  });
});

// #4741 引入时缺平台守卫：LaunchDaemon/plutil/launchctl 全是 macOS 专属，
// ubuntu-latest CI runner 上 /usr/bin/plutil 不存在直接 127，把 required
// brain-unit 分片 3 拖红（本次案卷发现，与 task 31b93fd4 三修无关，顺手补）。
describe.runIf(process.platform === 'darwin')('LaunchAgent 安装器', () => {
  it('默认生成 root LaunchDaemon，并为 App Store CLI 注入脚本模式', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tailscale-us-exit-install-'));
    tempDirs.push(dir);
    const home = join(dir, 'home');
    const daemonDir = join(dir, 'LaunchDaemons');
    const libexecDir = join(dir, 'system-libexec');
    const stateDir = join(dir, 'system-state');
    const logDir = join(dir, 'system-log');
    const result = spawnSync('/bin/bash', [
      INSTALLER,
      '--home', home,
      '--system-plist-dir', daemonDir,
      '--system-libexec-dir', libexecDir,
      '--system-state-dir', stateDir,
      '--system-log-dir', logDir,
      '--no-load',
    ], {
      env: { ...process.env, CECELIA_US_EXIT_SOURCE: ENFORCER },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const plist = join(daemonDir, 'com.cecelia.tailscale-us-exit.plist');
    const lint = spawnSync('/usr/bin/plutil', ['-lint', plist], { encoding: 'utf8' });
    expect(lint.status, lint.stderr).toBe(0);
    const plistText = readFileSync(plist, 'utf8');
    expect(plistText).toContain(`${libexecDir}/tailscale-us-exit-enforcer.py`);
    expect(plistText).toContain(`<string>${stateDir}/tailscale-us-exit-state.json</string>`);
    expect(plistText).toContain(`<string>${logDir}/tailscale-us-exit.log</string>`);
    expect(plistText).not.toContain(`${home}/.local/libexec`);
    expect(plistText).not.toContain(`${home}/.config/cecelia`);
    expect(plistText).toContain('<key>TAILSCALE_BE_CLI</key>');
    expect(plistText).toContain('<key>CECELIA_US_EXIT_TARGET_UID</key>');
  });

  it('无 GUI 会话的执行机由 root LaunchDaemon 管理 PF，并携带目标用户上下文', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tailscale-us-exit-daemon-'));
    tempDirs.push(dir);
    const home = join(dir, 'home');
    const daemonDir = join(dir, 'LaunchDaemons');
    const libexecDir = join(dir, 'system-libexec');
    const stateDir = join(dir, 'system-state');
    const logDir = join(dir, 'system-log');
    const staleAgent = join(home, 'Library/LaunchAgents/com.cecelia.tailscale-us-exit.plist');
    mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
    writeFileSync(staleAgent, 'stale-user-agent');
    const result = spawnSync('/bin/bash', [
      INSTALLER,
      '--home', home,
      '--system',
      '--system-plist-dir', daemonDir,
      '--system-libexec-dir', libexecDir,
      '--system-state-dir', stateDir,
      '--system-log-dir', logDir,
      '--no-load',
    ], {
      env: { ...process.env, CECELIA_US_EXIT_SOURCE: ENFORCER },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const plist = join(daemonDir, 'com.cecelia.tailscale-us-exit.plist');
    const lint = spawnSync('/usr/bin/plutil', ['-lint', plist], { encoding: 'utf8' });
    expect(lint.status, lint.stderr).toBe(0);
    const plistText = readFileSync(plist, 'utf8');
    expect(plistText).not.toContain('<key>UserName</key>');
    expect(plistText).toContain('<string>/usr/bin/python3</string>');
    expect(plistText).not.toContain('<string>asuser</string>');
    expect(plistText).toContain(`<key>CECELIA_US_EXIT_TARGET_USER</key>`);
    expect(plistText).toContain(`<string>${process.env.USER}</string>`);
    expect(plistText).toContain('<key>HOME</key>');
    expect(plistText).toContain(`<string>${home}</string>`);
    expect(plistText).toContain('<key>USER</key>');
    expect(plistText).toContain('<key>TAILSCALE_BE_CLI</key>');
    expect(existsSync(staleAgent)).toBe(false);
  });

  it('加载前真实调用 enable system service，修复 launchd 持久化 disabled 状态', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tailscale-us-exit-launchctl-'));
    tempDirs.push(dir);
    const home = join(dir, 'home');
    const daemonDir = join(dir, 'LaunchDaemons');
    const launchctlLog = join(dir, 'launchctl.log');
    const fakeLaunchctl = join(dir, 'launchctl');
    const fakeSudo = join(dir, 'sudo');
    writeFileSync(fakeLaunchctl, `#!/bin/bash\necho "$*" >> "$FAKE_LAUNCHCTL_LOG"\nexit 0\n`);
    writeFileSync(fakeSudo, '#!/bin/bash\nexec "$@"\n');
    chmodSync(fakeLaunchctl, 0o755);
    chmodSync(fakeSudo, 0o755);

    const result = spawnSync('/bin/bash', [
      INSTALLER,
      '--home', home,
      '--system-plist-dir', daemonDir,
      '--system-libexec-dir', join(dir, 'system-libexec'),
      '--system-state-dir', join(dir, 'system-state'),
      '--system-log-dir', join(dir, 'system-log'),
    ], {
      env: {
        ...process.env,
        CECELIA_US_EXIT_SOURCE: ENFORCER,
        CECELIA_LAUNCHCTL_BIN: fakeLaunchctl,
        CECELIA_SUDO_BIN: fakeSudo,
        FAKE_LAUNCHCTL_LOG: launchctlLog,
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(launchctlLog, 'utf8');
    expect(calls).toContain('enable system/com.cecelia.tailscale-us-exit');
    expect(calls).toContain(`bootstrap system ${daemonDir}/com.cecelia.tailscale-us-exit.plist`);
  });
});

describe.runIf(process.platform === 'darwin')('PF 规则真实语法', () => {
  it('macOS pfctl 可以解析 fail-closed 规则', () => {
    const rules = [
      'pass out quick on lo0 proto { tcp udp } user 501 no state',
      'pass out quick inet proto { tcp udp } to { 10.0.0.0/8 100.64.0.0/10 172.16.0.0/12 192.168.0.0/16 } user 501 no state',
      'pass out quick inet6 proto { tcp udp } to fd7a:115c:a1e0::/48 user 501 no state',
      'pass out quick on utun99 proto { tcp udp } user 501 no state',
      'block drop out quick proto { tcp udp } user 501',
      '',
    ].join('\n');

    const result = spawnSync('/sbin/pfctl', ['-vnf', '-'], { input: rules, encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
  });
});
